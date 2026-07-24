import crypto from "node:crypto";
import { HttpError } from "./http-error.js";
import { withKeyedLock } from "./keyed-lock.js";
import {
  evolveOrder,
  initializeOrderLifecycle,
  normalizeOrderLifecycle,
} from "./order-lifecycle.js";
import {
  createOrderRecord,
  findOrder,
  findOrderByIdempotencyKey,
  findOrderByRazorpayOrderId,
  findOrderByRazorpayPaymentId,
  mutateOrderRecord,
} from "./order-store.js";
import {
  decrementInventory,
  getProducts,
  restoreInventory,
} from "./product-store.js";
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  razorpayPublicKey,
  verifyCheckoutSignature,
} from "./razorpay.js";
import { createShiprocketShipment } from "./shiprocket.js";
import { getStoreSettings } from "./store-settings.js";

const MAX_CART_LINES = 20;
const MAX_QUANTITY_PER_PRODUCT = 10;
const MAX_TOTAL_QUANTITY = 50;

export const onlineCheckoutEnabled = () =>
  Boolean(
    process.env.RAZORPAY_KEY_ID &&
      process.env.RAZORPAY_KEY_SECRET &&
      process.env.RAZORPAY_WEBHOOK_SECRET,
  );

export const codCheckoutEnabled = () =>
  process.env.ENABLE_COD === "true" &&
  Boolean(
    process.env.SHIPROCKET_EMAIL &&
      process.env.SHIPROCKET_PASSWORD &&
      process.env.SHIPROCKET_PICKUP_LOCATION &&
      process.env.SHIPROCKET_DEFAULT_WEIGHT_KG &&
      process.env.SHIPROCKET_DEFAULT_LENGTH_CM &&
      process.env.SHIPROCKET_DEFAULT_BREADTH_CM &&
      process.env.SHIPROCKET_DEFAULT_HEIGHT_CM,
  );

export const validateIdempotencyKey = (value) => {
  const key = String(value || "").trim();
  if (
    key.length < 16 ||
    key.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(key)
  ) {
    throw new HttpError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Restart checkout and try again.",
    );
  }
  return key;
};

export const aggregateRequestedItems = (requestedItems = []) => {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    throw new HttpError(400, "EMPTY_CART", "Your cart is empty.");
  }
  if (requestedItems.length > MAX_CART_LINES) {
    throw new HttpError(
      400,
      "TOO_MANY_CART_LINES",
      "Your cart contains too many separate items.",
    );
  }

  const quantities = new Map();
  requestedItems.forEach((requested) => {
    const id = String(requested?.id || "").trim();
    const quantity = Number(requested?.quantity);
    if (!id || !Number.isInteger(quantity) || quantity < 1) {
      throw new HttpError(
        400,
        "INVALID_CART_ITEM",
        "One or more cart items are invalid.",
      );
    }
    quantities.set(id, (quantities.get(id) || 0) + quantity);
  });

  const aggregated = [...quantities]
    .map(([id, quantity]) => ({ id, quantity }))
    .sort((first, second) => first.id.localeCompare(second.id));
  if (
    aggregated.some(
      (item) => item.quantity > MAX_QUANTITY_PER_PRODUCT,
    ) ||
    aggregated.reduce((sum, item) => sum + item.quantity, 0) >
      MAX_TOTAL_QUANTITY
  ) {
    throw new HttpError(
      400,
      "CART_QUANTITY_LIMIT",
      "Reduce the quantity in your cart and try again.",
    );
  }
  return aggregated;
};

const priceOrder = async (requestedItems) => {
  const products = await getProducts();
  const items = requestedItems.map((requested) => {
    const product = products.find((entry) => entry.id === requested.id);
    if (!product) {
      throw new HttpError(
        409,
        "PRODUCT_UNAVAILABLE",
        "One or more cart items are no longer available.",
      );
    }
    if (Number(product.inventory || 0) < requested.quantity) {
      throw new HttpError(
        409,
        "INSUFFICIENT_STOCK",
        `${product.name} does not have enough stock.`,
      );
    }
    const price = Number(product.price);
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new HttpError(
        500,
        "INVALID_CATALOG_PRICE",
        "A product price needs administrator attention.",
      );
    }
    return {
      id: product.id,
      asin: product.asin || product.id,
      name: product.name,
      price,
      quantity: requested.quantity,
    };
  });

  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const storeSettings = await getStoreSettings();
  const shipping =
    subtotal >= storeSettings.shipping.freeThreshold
      ? 0
      : storeSettings.shipping.standardFee;
  const total = subtotal + shipping;
  if (![subtotal, shipping, total].every(Number.isSafeInteger)) {
    throw new HttpError(
      500,
      "INVALID_ORDER_TOTAL",
      "The order total could not be calculated safely.",
    );
  }
  return { items, subtotal, shipping, total };
};

const requestFingerprint = ({ customer, items, paymentMethod }) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify({ customer, items, paymentMethod }))
    .digest("hex");

const internalOrderId = () => {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `KEL-${date}-${suffix}`;
};

const publicCheckoutOrder = (order, message) => ({
  orderId: order.orderId,
  status: order.status,
  message,
});

const onlineCheckoutOrder = (order) => ({
  orderId: order.orderId,
  razorpayOrderId: order.razorpayOrderId,
  razorpayKeyId: razorpayPublicKey(),
  amount: Number(order.total) * 100,
});

const resumedPaidOrder = (order) => ({
  orderId: order.orderId,
  status: order.status,
  paymentConfirmed: true,
  pending: false,
  terminal: true,
  message:
    order.inventoryStatus === "attention"
      ? "Payment is confirmed. Our team will contact you because stock needs manual review."
      : "Payment received and your order is confirmed.",
});

const persistProviderOrder = async (order) => {
  if (order.razorpayOrderId) return order;
  const providerOrder = await createRazorpayOrder({
    orderId: order.orderId,
    total: order.total,
  });
  return mutateOrderRecord(order.orderId, (current) =>
    evolveOrder(
      current,
      {
        razorpayOrderId: providerOrder.id,
        razorpayOrderAmount: providerOrder.amount,
        razorpayOrderStatus: providerOrder.status,
      },
      {
        event: "payment.order_created",
        source: "razorpay",
      },
    ),
  );
};

const commitInventoryForOrder = async (order) => {
  const current = normalizeOrderLifecycle(order);
  if (current.inventoryStatus === "committed") return current;
  try {
    await decrementInventory(current.items, {
      transactionId: current.orderId,
    });
    return mutateOrderRecord(current.orderId, (latest) =>
      evolveOrder(
        latest,
        {
          inventoryStatus: "committed",
          inventoryCommittedAt:
            latest.inventoryCommittedAt || new Date().toISOString(),
        },
        {
          event: "inventory.committed",
          source: "system",
        },
      ),
    );
  } catch (error) {
    if (current.paymentMethod === "online" && current.paymentStatus === "paid") {
      return mutateOrderRecord(current.orderId, (latest) =>
        evolveOrder(
          latest,
          {
            inventoryStatus: "attention",
            inventoryErrorCode: error.code || "INVENTORY_COMMIT_FAILED",
          },
          {
            event: "inventory.attention_required",
            source: "system",
          },
        ),
      );
    }
    throw error;
  }
};

export const attemptShipmentForOrder = async (orderId) =>
  withKeyedLock(`order:${orderId}`, async () => {
    let order = await findOrder(orderId);
    if (!order) return null;
    order = normalizeOrderLifecycle(order);
    if (
      order.shipment?.created ||
      order.fulfillmentStatus === "cancelled" ||
      order.inventoryStatus !== "committed"
    ) {
      return order;
    }
    if (order.shipmentAttemptedAt) return order;

    order = await mutateOrderRecord(orderId, (current) =>
      evolveOrder(
        current,
        { shipmentAttemptedAt: new Date().toISOString() },
        { event: "shipment.requested", source: "system" },
      ),
    );
    const shipment = await createShiprocketShipment(order);
    return mutateOrderRecord(orderId, (current) => {
      if (current.fulfillmentStatus === "cancelled") return current;
      return evolveOrder(
        current,
        { shipment },
        {
          event: shipment.created
            ? "shipment.created"
            : "shipment.pending",
          source: "shiprocket",
          detail: shipment.reason,
        },
      );
    });
  });

const scheduleShipment = (orderId) => {
  setImmediate(() => {
    attemptShipmentForOrder(orderId).catch((error) => {
      console.error("Shipment scheduling failed", {
        orderId,
        code: error.code || "SHIPMENT_FAILED",
      });
    });
  });
};

const resumeCodOrder = async (order) =>
  withKeyedLock(`order:${order.orderId}`, async () => {
    const latest = await findOrder(order.orderId);
    if (!latest || latest.fulfillmentStatus === "cancelled") {
      throw new HttpError(
        409,
        "ORDER_CANCELLED",
        "This checkout attempt was cancelled. Start a new checkout.",
      );
    }
    const committed = await commitInventoryForOrder(latest);
    scheduleShipment(committed.orderId);
    return publicCheckoutOrder(
      committed,
      "Your COD request has been received and is awaiting courier confirmation.",
    );
  });

export const startCheckout = async ({
  customer,
  requestedItems,
  paymentMethod,
  idempotencyKey,
}) => {
  const method = String(paymentMethod || "");
  if (!["online", "cod"].includes(method)) {
    throw new HttpError(
      400,
      "INVALID_PAYMENT_METHOD",
      "Choose online payment or cash on delivery.",
    );
  }
  if (method === "cod" && !codCheckoutEnabled()) {
    throw new HttpError(
      503,
      "COD_NOT_ENABLED",
      "Cash on delivery is temporarily unavailable. Choose online payment.",
      { expose: true },
    );
  }
  if (method === "online" && !onlineCheckoutEnabled()) {
    throw new HttpError(
      503,
      "ONLINE_PAYMENT_NOT_ENABLED",
      "Online payment is temporarily unavailable. Please contact support.",
      { expose: true },
    );
  }
  const key = validateIdempotencyKey(idempotencyKey);
  const aggregatedItems = aggregateRequestedItems(requestedItems);
  const fingerprint = requestFingerprint({
    customer,
    items: aggregatedItems,
    paymentMethod: method,
  });

  return withKeyedLock(`checkout:${key}`, async () => {
    let order = await findOrderByIdempotencyKey(key);
    if (order) {
      if (order.requestHash !== fingerprint) {
        throw new HttpError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Checkout details changed during this attempt. Restart checkout.",
        );
      }
      if (order.fulfillmentStatus === "cancelled") {
        throw new HttpError(
          409,
          order.paymentStatus === "paid"
            ? "ORDER_REFUND_PENDING"
            : "ORDER_CANCELLED",
          order.paymentStatus === "paid"
            ? "This payment reached a cancelled order. Keep the order reference; our team must reconcile the refund before you retry."
            : "This checkout attempt was cancelled. Start a new checkout.",
        );
      }
      if (method === "cod") return resumeCodOrder(order);
      if (order.paymentStatus === "paid") return resumedPaidOrder(order);
      order = await persistProviderOrder(order);
      return onlineCheckoutOrder(order);
    }

    const totals = await priceOrder(aggregatedItems);
    const createdAt = new Date().toISOString();
    order = initializeOrderLifecycle({
      orderId: internalOrderId(),
      idempotencyKey: key,
      requestHash: fingerprint,
      customer,
      ...totals,
      paymentMethod: method,
      createdAt,
    });
    order = await createOrderRecord(order);

    if (method === "cod") return resumeCodOrder(order);
    order = await persistProviderOrder(order);
    return onlineCheckoutOrder(order);
  });
};

const validateCapturedPayment = (order, payment) => {
  if (
    payment?.id == null ||
    payment.order_id !== order.razorpayOrderId ||
    Number(payment.amount) !== Number(order.total) * 100 ||
    payment.currency !== "INR" ||
    payment.status !== "captured"
  ) {
    throw new HttpError(
      409,
      "PAYMENT_NOT_CAPTURED",
      "The payment has not been captured for this order.",
    );
  }
};

export const confirmCapturedPayment = async ({
  orderId,
  payment,
  source,
  eventId,
}) =>
  withKeyedLock(`order:${orderId}`, async () => {
    let order = await findOrder(orderId);
    if (!order || order.paymentMethod !== "online") {
      throw new HttpError(
        404,
        "ORDER_NOT_FOUND",
        "This payment does not match an online order.",
      );
    }
    validateCapturedPayment(order, payment);
    if (
      order.razorpayPaymentId &&
      order.razorpayPaymentId !== payment.id
    ) {
      throw new HttpError(
        409,
        "PAYMENT_CONFLICT",
        "A different payment is already attached to this order.",
      );
    }

    if (
      order.paymentStatus !== "paid" ||
      !order.razorpayPaymentId ||
      (eventId && order.lastPaymentWebhookEventId !== eventId)
    ) {
      const providerCreatedAt = Number(payment.created_at);
      const paidAt =
        Number.isFinite(providerCreatedAt) && providerCreatedAt > 0
          ? new Date(providerCreatedAt * 1000).toISOString()
          : new Date().toISOString();
      order = await mutateOrderRecord(orderId, (current) =>
        evolveOrder(
          current,
          {
            paymentStatus: "paid",
            razorpayPaymentId: payment.id,
            razorpayPaymentMethod: payment.method,
            razorpayPaymentStatus: payment.status,
            paidAt,
            ...(eventId ? { lastPaymentWebhookEventId: eventId } : {}),
          },
          {
            event: "payment.captured",
            source,
          },
        ),
      );
    }

    if (
      order.fulfillmentStatus === "cancelled" ||
      ["pending", "partial", "processed"].includes(order.refundStatus)
    ) {
      if (order.refundStatus === "none") {
        order = await mutateOrderRecord(orderId, (current) =>
          evolveOrder(
            current,
            { refundStatus: "pending" },
            {
              event: "refund.required_after_late_payment",
              source,
            },
          ),
        );
      }
      return order;
    }

    order = await commitInventoryForOrder(order);
    if (order.inventoryStatus === "committed") scheduleShipment(order.orderId);
    return order;
  });

export const verifyCheckoutPayment = async ({
  orderId,
  razorpayPaymentId,
  signature,
}) => {
  const order = await findOrder(orderId);
  if (!order || !order.razorpayOrderId) {
    throw new HttpError(
      404,
      "ORDER_NOT_FOUND",
      "This order could not be verified.",
    );
  }
  if (
    !razorpayPaymentId ||
    !signature ||
    !verifyCheckoutSignature({
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId,
      signature,
    })
  ) {
    throw new HttpError(
      400,
      "INVALID_PAYMENT_SIGNATURE",
      "Payment signature verification failed.",
    );
  }

  const payment = await fetchRazorpayPayment(razorpayPaymentId);
  if (
    payment.order_id !== order.razorpayOrderId ||
    Number(payment.amount) !== Number(order.total) * 100 ||
    payment.currency !== "INR"
  ) {
    throw new HttpError(
      409,
      "PAYMENT_MISMATCH",
      "The payment details do not match this order.",
    );
  }
  if (payment.status !== "captured") {
    return {
      order,
      pending: true,
      message:
        "Payment was received and is still being confirmed by Razorpay.",
    };
  }

  const confirmed = await confirmCapturedPayment({
    orderId: order.orderId,
    payment,
    source: "checkout_callback",
  });
  return {
    order: confirmed,
    pending: false,
    message:
      confirmed.inventoryStatus === "attention"
        ? "Payment is confirmed. Our team will contact you because stock needs manual review."
        : "Payment received and your order is confirmed.",
  };
};

export const recordFailedPayment = async ({
  razorpayOrderId,
  payment,
  eventId,
}) => {
  const order = await findOrderByRazorpayOrderId(razorpayOrderId);
  if (!order) return null;
  return withKeyedLock(`order:${order.orderId}`, () =>
    mutateOrderRecord(order.orderId, (current) =>
      evolveOrder(
        current,
        {
          lastPaymentFailure: {
            paymentId: payment?.id,
            code: payment?.error_code,
            reason: payment?.error_reason,
            at: new Date().toISOString(),
          },
          ...(eventId ? { lastPaymentWebhookEventId: eventId } : {}),
        },
        {
          event: "payment.failed",
          source: "razorpay_webhook",
        },
      ),
    ),
  );
};

export const recordRefundEvent = async ({
  eventType,
  refund,
  eventId,
}) => {
  const order = await findOrderByRazorpayPaymentId(refund?.payment_id);
  if (!order) return null;
  return withKeyedLock(`order:${order.orderId}`, async () => {
    let updated = await mutateOrderRecord(order.orderId, (current) => {
      const refunds = [
        ...(Array.isArray(current.refunds) ? current.refunds : []).filter(
          (entry) => entry.id !== refund.id,
        ),
        {
          id: refund.id,
          amount: Number(refund.amount || 0),
          status: refund.status,
          eventType,
          at: new Date().toISOString(),
        },
      ];
      const processedAmount = refunds
        .filter((entry) => entry.status === "processed")
        .reduce((sum, entry) => sum + entry.amount, 0);
      const refundStatus =
        eventType === "refund.failed"
          ? "failed"
          : processedAmount >= Number(current.total) * 100
            ? "processed"
            : eventType === "refund.processed"
              ? "partial"
              : "pending";
      return evolveOrder(
        current,
        {
          refunds,
          refundedAmount: processedAmount,
          refundStatus,
          ...(eventId ? { lastRefundWebhookEventId: eventId } : {}),
        },
        {
          event: eventType,
          source: "razorpay_webhook",
        },
      );
    });

    if (
      updated.refundStatus === "processed" &&
      !["shipped", "delivered"].includes(updated.fulfillmentStatus)
    ) {
      if (updated.fulfillmentStatus !== "cancelled") {
        updated = await mutateOrderRecord(updated.orderId, (current) =>
          evolveOrder(
            current,
            { fulfillmentStatus: "cancelled" },
            {
              event: "order.cancelled_after_refund",
              source: "razorpay_webhook",
            },
          ),
        );
      }
      updated = await releaseCancelledOrderInventory(updated);
    }
    return updated;
  });
};

export const releaseCancelledOrderInventory = async (order) => {
  const current = normalizeOrderLifecycle(order);
  if (
    current.inventoryStatus !== "committed" ||
    ["shipped", "delivered"].includes(current.fulfillmentStatus)
  ) {
    return current;
  }
  await restoreInventory(current.items, { transactionId: current.orderId });
  return mutateOrderRecord(current.orderId, (latest) =>
    evolveOrder(
      latest,
      {
        inventoryStatus: "released",
        inventoryReleasedAt: new Date().toISOString(),
      },
      {
        event: "inventory.released",
        source: "admin",
      },
    ),
  );
};
