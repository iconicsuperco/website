import { HttpError } from "./http-error.js";

export const ORDER_STATUSES = [
  "payment_pending",
  "paid",
  "cod_confirmed",
  "shipment_pending",
  "shipment_created",
  "processing",
  "shipped",
  "delivered",
  "inventory_attention",
  "cancelled",
  "refunded",
];

const ADMIN_TRANSITIONS = {
  payment_pending: ["cancelled"],
  paid: ["processing", "cancelled"],
  cod_confirmed: ["processing", "cancelled"],
  shipment_pending: ["processing", "cancelled"],
  shipment_created: ["processing", "shipped", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  inventory_attention: ["cancelled"],
  cancelled: [],
  refunded: [],
};

const inferPaymentStatus = (order) => {
  if (order.paymentStatus) return order.paymentStatus;
  if (order.paymentMethod === "cod") return "cod_due";
  if (
    order.razorpayPaymentId ||
    order.paidAt ||
    [
      "paid",
      "shipment_pending",
      "shipment_created",
      "processing",
      "shipped",
      "delivered",
      "inventory_attention",
      "refunded",
    ].includes(order.status)
  ) {
    return "paid";
  }
  return "pending";
};

const inferFulfillmentStatus = (order) => {
  if (order.fulfillmentStatus) return order.fulfillmentStatus;
  if (order.status === "cancelled") return "cancelled";
  if (order.status === "delivered") return "delivered";
  if (order.status === "shipped") return "shipped";
  if (order.status === "processing") return "packed";
  return "unfulfilled";
};

const inferRefundStatus = (order) => {
  if (order.refundStatus) return order.refundStatus;
  return order.status === "refunded" ? "processed" : "none";
};

export const projectOrderStatus = (order) => {
  if (order.refundStatus === "processed") return "refunded";
  if (order.fulfillmentStatus === "cancelled") return "cancelled";
  if (order.inventoryStatus === "attention") return "inventory_attention";
  if (order.fulfillmentStatus === "delivered") return "delivered";
  if (order.fulfillmentStatus === "shipped") return "shipped";
  if (order.fulfillmentStatus === "packed") return "processing";
  if (order.shipment?.created) return "shipment_created";
  if (order.shipmentAttemptedAt || order.shipment) return "shipment_pending";
  if (order.paymentMethod === "online" && order.paymentStatus === "paid") {
    return "paid";
  }
  if (
    order.paymentMethod === "cod" &&
    order.inventoryStatus === "committed"
  ) {
    return "cod_confirmed";
  }
  return "payment_pending";
};

export const normalizeOrderLifecycle = (order) => {
  const normalized = {
    ...order,
    paymentStatus: inferPaymentStatus(order),
    fulfillmentStatus: inferFulfillmentStatus(order),
    refundStatus: inferRefundStatus(order),
    inventoryStatus:
      order.inventoryStatus ||
      (order.inventoryCommittedAt ? "committed" : "pending"),
    version: Number.isInteger(order.version) ? order.version : 1,
    statusHistory: Array.isArray(order.statusHistory)
      ? order.statusHistory
      : [],
    updatedAt: order.updatedAt || order.statusUpdatedAt || order.createdAt,
  };
  normalized.status = projectOrderStatus(normalized);
  return normalized;
};

export const initializeOrderLifecycle = (order) => {
  const createdAt = order.createdAt || new Date().toISOString();
  const initialized = normalizeOrderLifecycle({
    ...order,
    createdAt,
    updatedAt: createdAt,
    paymentStatus: order.paymentMethod === "cod" ? "cod_due" : "pending",
    fulfillmentStatus: "unfulfilled",
    refundStatus: "none",
    inventoryStatus: "pending",
    version: 1,
    statusHistory: [],
  });
  initialized.statusHistory = [
    {
      event: "order.created",
      source: "checkout",
      status: initialized.status,
      paymentStatus: initialized.paymentStatus,
      fulfillmentStatus: initialized.fulfillmentStatus,
      at: createdAt,
    },
  ];
  return initialized;
};

export const evolveOrder = (
  order,
  changes,
  { event, source = "system", detail, at = new Date().toISOString() },
) => {
  const current = normalizeOrderLifecycle(order);
  const next = normalizeOrderLifecycle({
    ...current,
    ...changes,
    updatedAt: at,
    version: current.version + 1,
  });
  next.status = projectOrderStatus(next);
  if (next.status !== current.status) next.statusUpdatedAt = at;
  next.statusHistory = [
    ...current.statusHistory,
    {
      event,
      source,
      status: next.status,
      paymentStatus: next.paymentStatus,
      fulfillmentStatus: next.fulfillmentStatus,
      ...(detail ? { detail } : {}),
      at,
    },
  ].slice(-100);
  return next;
};

export const allowedAdminTransitions = (order) => {
  const current = normalizeOrderLifecycle(order);
  let transitions = ADMIN_TRANSITIONS[current.status] || [];
  if (current.refundStatus !== "none") {
    transitions = transitions.filter((status) => status === "cancelled");
  }
  const shipmentOutcomeIsKnownSafe =
    current.shipment?.created === false &&
    ["credentials_missing", "measurements_missing", "api_error"].includes(
      current.shipment.reason,
    );
  const shipmentCancellationIsUnsafe =
    current.shipment?.created === true ||
    (Boolean(current.shipmentAttemptedAt) && !shipmentOutcomeIsKnownSafe);
  if (shipmentCancellationIsUnsafe) {
    transitions = transitions.filter((status) => status !== "cancelled");
  }
  return transitions;
};

export const transitionOrderForAdmin = (
  order,
  targetStatus,
  expectedVersion,
) => {
  const current = normalizeOrderLifecycle(order);
  if (
    expectedVersion != null &&
    Number(expectedVersion) !== Number(current.version)
  ) {
    throw new HttpError(
      409,
      "STALE_ORDER_VERSION",
      "This order changed after you opened it. Refresh and try again.",
    );
  }
  if (!allowedAdminTransitions(current).includes(targetStatus)) {
    throw new HttpError(
      409,
      "INVALID_ORDER_TRANSITION",
      `A ${current.status.replaceAll("_", " ")} order cannot move directly to ${String(
        targetStatus,
      ).replaceAll("_", " ")}.`,
    );
  }

  const changes = {};
  if (targetStatus === "processing") changes.fulfillmentStatus = "packed";
  if (targetStatus === "shipped") changes.fulfillmentStatus = "shipped";
  if (targetStatus === "delivered") {
    changes.fulfillmentStatus = "delivered";
  }
  if (targetStatus === "cancelled") {
    changes.fulfillmentStatus = "cancelled";
    if (current.paymentMethod === "online" && current.paymentStatus === "paid") {
      changes.refundStatus = "pending";
    }
  }

  return evolveOrder(current, changes, {
    event: `order.${targetStatus}`,
    source: "admin",
  });
};

export const orderWithAdminTransitions = (order) => {
  const normalized = normalizeOrderLifecycle(order);
  return {
    ...normalized,
    allowedTransitions: allowedAdminTransitions(normalized),
  };
};
