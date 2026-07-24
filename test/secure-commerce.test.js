import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test, { after, before } from "node:test";
import { setImmediate } from "node:timers";

let temporaryDirectory;
let ordersFile;
let productsFile;
let webhookEventsFile;
let originalFetch;

let aggregateRequestedItems;
let confirmCapturedPayment;
let createOrderStore;
let findOrder;
let findOrderByIdempotencyKey;
let getProducts;
let initializeOrderLifecycle;
let evolveOrder;
let mutateOrderRecord;
let razorpayWebhookHandler;
let recordRefundEvent;
let startCheckout;
let transitionOrderForAdmin;
let verifyCheckoutPayment;

const providerCalls = [];
const providerOrders = new Map();
const providerPayments = new Map();
const scheduledOrderIds = new Set();
let providerOrderSequence = 0;

const customer = Object.freeze({
  name: "Test Customer",
  phone: "9876543210",
  email: "test.customer@example.com",
  address: "12 Test Street",
  area: "Test Colony",
  city: "New Delhi",
  state: "Delhi",
  pincode: "110001",
});

const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const mockProviderFetch = async (input, options = {}) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL
      ? input
      : input.url,
  );
  const method = String(options.method || "GET").toUpperCase();
  providerCalls.push({ method, url: url.toString() });

  if (url.origin !== "https://razorpay.test") {
    throw new Error(`Unexpected external request: ${method} ${url}`);
  }

  if (url.pathname === "/v1/orders" && method === "POST") {
    const request = JSON.parse(String(options.body || "{}"));
    const existing = providerOrders.get(request.receipt);
    if (existing) {
      return jsonResponse(
        {
          error: {
            code: "BAD_REQUEST_ERROR",
            description: "receipt has already been used",
          },
        },
        400,
      );
    }
    const order = {
      id: `order_Test${String(++providerOrderSequence).padStart(6, "0")}`,
      amount: request.amount,
      currency: request.currency,
      receipt: request.receipt,
      status: "created",
    };
    providerOrders.set(request.receipt, order);
    return jsonResponse(order);
  }

  if (url.pathname === "/v1/orders" && method === "GET") {
    const receipt = url.searchParams.get("receipt");
    const order = providerOrders.get(receipt);
    return jsonResponse({ items: order ? [order] : [] });
  }

  if (url.pathname.startsWith("/v1/payments/") && method === "GET") {
    const paymentId = decodeURIComponent(
      url.pathname.slice("/v1/payments/".length),
    );
    const payment = providerPayments.get(paymentId);
    return payment
      ? jsonResponse(payment)
      : jsonResponse(
          {
            error: {
              code: "BAD_REQUEST_ERROR",
              description: "payment not found",
            },
          },
          404,
        );
  }

  throw new Error(`Unexpected Razorpay request: ${method} ${url}`);
};

const readJson = async (file) =>
  JSON.parse(await fs.readFile(file, "utf8"));

const inventoryFor = async (productId) => {
  const products = await getProducts({ includeInactive: true });
  return products.find((product) => product.id === productId)?.inventory;
};

const hmac = (secret, value) =>
  crypto.createHmac("sha256", secret).update(value).digest("hex");

const checkoutSignature = (razorpayOrderId, razorpayPaymentId) =>
  hmac(
    process.env.RAZORPAY_KEY_SECRET,
    `${razorpayOrderId}|${razorpayPaymentId}`,
  );

const invokeWebhook = async ({
  payload,
  eventId,
  signature = "valid",
}) => {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const suppliedSignature =
    signature === "valid"
      ? hmac(process.env.RAZORPAY_WEBHOOK_SECRET, rawBody)
      : signature;
  const headers = new Map([
    ["x-razorpay-event-id", eventId],
    ["x-razorpay-signature", suppliedSignature],
  ]);
  const request = {
    body: rawBody,
    get(name) {
      return headers.get(String(name).toLowerCase());
    },
  };
  const result = {
    statusCode: 200,
    body: undefined,
  };
  const response = {
    status(statusCode) {
      result.statusCode = statusCode;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };

  await razorpayWebhookHandler(request, response);
  return result;
};

const waitForScheduledShipment = async (orderId) => {
  scheduledOrderIds.add(orderId);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const order = await findOrder(orderId);
    if (order?.shipment) return order;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Shipment scheduling did not settle for ${orderId}.`);
};

before(async () => {
  temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "kelenate-secure-commerce-"),
  );
  ordersFile = path.join(temporaryDirectory, "orders.json");
  productsFile = path.join(temporaryDirectory, "products.json");
  webhookEventsFile = path.join(temporaryDirectory, "webhook-events.json");

  await Promise.all([
    fs.writeFile(ordersFile, "[]"),
    fs.writeFile(webhookEventsFile, "[]"),
    fs.writeFile(
      productsFile,
      JSON.stringify(
        [
          {
            id: "sku-a",
            asin: "TEST-SKU-A",
            name: "Test Product A",
            category: "Testing",
            price: 120,
            mrp: 150,
            image: "/test-a.jpg",
            short: "Test product A",
            inventory: 50,
            active: true,
          },
          {
            id: "sku-b",
            asin: "TEST-SKU-B",
            name: "Test Product B",
            category: "Testing",
            price: 80,
            mrp: 100,
            image: "/test-b.jpg",
            short: "Test product B",
            inventory: 40,
            active: true,
          },
          {
            id: "sku-c",
            asin: "TEST-SKU-C",
            name: "Limited Test Product",
            category: "Testing",
            price: 100,
            mrp: 125,
            image: "/test-c.jpg",
            short: "Limited test product",
            inventory: 5,
            active: true,
          },
        ],
        null,
        2,
      ),
    ),
  ]);

  process.env.NODE_ENV = "test";
  process.env.ORDERS_DATA_FILE = ordersFile;
  process.env.PRODUCTS_DATA_FILE = productsFile;
  process.env.WEBHOOK_EVENTS_FILE = webhookEventsFile;
  process.env.RAZORPAY_API_URL = "https://razorpay.test/v1";
  process.env.RAZORPAY_KEY_ID = "rzp_test_automated";
  process.env.RAZORPAY_KEY_SECRET = "checkout-test-secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-test-secret";
  delete process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS;
  delete process.env.ENABLE_COD;
  delete process.env.SHIPROCKET_EMAIL;
  delete process.env.SHIPROCKET_PASSWORD;
  delete process.env.SHIPROCKET_PICKUP_LOCATION;
  delete process.env.SHIPROCKET_DEFAULT_WEIGHT_KG;
  delete process.env.SHIPROCKET_DEFAULT_LENGTH_CM;
  delete process.env.SHIPROCKET_DEFAULT_BREADTH_CM;
  delete process.env.SHIPROCKET_DEFAULT_HEIGHT_CM;

  originalFetch = globalThis.fetch;
  globalThis.fetch = mockProviderFetch;

  const commerce = await import("../server/commerce-service.js");
  const orderStore = await import("../server/order-store.js");
  const productStore = await import("../server/product-store.js");
  const lifecycle = await import("../server/order-lifecycle.js");
  const webhook = await import("../server/razorpay-webhook.js");

  ({
    aggregateRequestedItems,
    confirmCapturedPayment,
    recordRefundEvent,
    startCheckout,
    verifyCheckoutPayment,
  } = commerce);
  ({
    createOrderStore,
    findOrder,
    findOrderByIdempotencyKey,
    mutateOrderRecord,
  } = orderStore);
  ({ getProducts } = productStore);
  ({
    evolveOrder,
    initializeOrderLifecycle,
    transitionOrderForAdmin,
  } = lifecycle);
  ({ razorpayWebhookHandler } = webhook);
});

after(async () => {
  for (const orderId of scheduledOrderIds) {
    await waitForScheduledShipment(orderId).catch(() => undefined);
  }
  globalThis.fetch = originalFetch;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

test("duplicate cart lines aggregate deterministically before quantity checks", () => {
  assert.deepEqual(
    aggregateRequestedItems([
      { id: "sku-b", quantity: 2 },
      { id: "sku-a", quantity: 3 },
      { id: "sku-b", quantity: 4 },
    ]),
    [
      { id: "sku-a", quantity: 3 },
      { id: "sku-b", quantity: 6 },
    ],
  );

  assert.throws(
    () =>
      aggregateRequestedItems([
        { id: "sku-a", quantity: 6 },
        { id: "sku-a", quantity: 5 },
      ]),
    (error) => error.code === "CART_QUANTITY_LIMIT",
  );
  assert.throws(
    () =>
      aggregateRequestedItems(
        Array.from({ length: 17 }, (_, index) => ({
          id: `unique-${index}`,
          quantity: 3,
        })),
      ),
    (error) => error.code === "CART_QUANTITY_LIMIT",
  );
  assert.throws(
    () =>
      aggregateRequestedItems(
        Array.from({ length: 21 }, () => ({
          id: "sku-a",
          quantity: 1,
        })),
      ),
    (error) => error.code === "TOO_MANY_CART_LINES",
  );
});

test("the order store serializes concurrent records without losing writes", async () => {
  const concurrentOrdersFile = path.join(
    temporaryDirectory,
    "concurrent-orders.json",
  );
  const store = createOrderStore({ ordersFile: concurrentOrdersFile });
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      store.createOrderRecord({
        orderId: `KEL-CONCURRENT-${String(index).padStart(2, "0")}`,
        paymentMethod: "online",
        createdAt: new Date(2026, 6, 24, 0, 0, index).toISOString(),
      }),
    ),
  );
  const orders = await store.getOrders();
  assert.equal(orders.length, 25);
  assert.equal(new Set(orders.map((order) => order.orderId)).size, 25);
});

test("the same idempotency key reuses one order while changed input conflicts", async () => {
  const idempotencyKey = "checkout-reuse-key-0001";
  const checkout = {
    customer,
    requestedItems: [{ id: "sku-a", quantity: 2 }],
    paymentMethod: "online",
    idempotencyKey,
  };
  const postCallsBefore = providerCalls.filter(
    (call) => call.method === "POST" && call.url.includes("/v1/orders"),
  ).length;

  const [first, concurrentReplay] = await Promise.all([
    startCheckout(checkout),
    startCheckout(checkout),
  ]);
  const laterReplay = await startCheckout(checkout);

  assert.deepEqual(concurrentReplay, first);
  assert.deepEqual(laterReplay, first);
  assert.equal(
    providerCalls.filter(
      (call) => call.method === "POST" && call.url.includes("/v1/orders"),
    ).length,
    postCallsBefore + 1,
  );
  assert.equal(
    (await findOrderByIdempotencyKey(idempotencyKey)).orderId,
    first.orderId,
  );

  await assert.rejects(
    startCheckout({
      ...checkout,
      requestedItems: [{ id: "sku-a", quantity: 3 }],
    }),
    (error) => error.status === 409 && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("concurrent and replayed payment confirmation decrements inventory once", async () => {
  const order = await findOrderByIdempotencyKey("checkout-reuse-key-0001");
  const paymentId = "pay_Concurrent0001";
  const payment = {
    id: paymentId,
    order_id: order.razorpayOrderId,
    amount: order.total * 100,
    currency: "INR",
    status: "captured",
    method: "card",
    created_at: Math.floor(Date.now() / 1000),
  };
  providerPayments.set(paymentId, payment);
  const signature = checkoutSignature(order.razorpayOrderId, paymentId);
  const inventoryBefore = await inventoryFor("sku-a");

  const confirmations = await Promise.all([
    verifyCheckoutPayment({
      orderId: order.orderId,
      razorpayPaymentId: paymentId,
      signature,
    }),
    verifyCheckoutPayment({
      orderId: order.orderId,
      razorpayPaymentId: paymentId,
      signature,
    }),
  ]);

  assert.ok(confirmations.every((confirmation) => !confirmation.pending));
  assert.equal(await inventoryFor("sku-a"), inventoryBefore - 2);

  await confirmCapturedPayment({
    orderId: order.orderId,
    payment,
    source: "razorpay_webhook",
    eventId: "evt_payment_replay_0001",
  });
  assert.equal(await inventoryFor("sku-a"), inventoryBefore - 2);

  const storedOrder = await findOrder(order.orderId);
  assert.equal(storedOrder.paymentStatus, "paid");
  assert.equal(storedOrder.inventoryStatus, "committed");
  assert.equal(storedOrder.razorpayPaymentId, paymentId);
  const resumed = await startCheckout({
    customer,
    requestedItems: [{ id: "sku-a", quantity: 2 }],
    paymentMethod: "online",
    idempotencyKey: "checkout-reuse-key-0001",
  });
  assert.equal(resumed.paymentConfirmed, true);
  assert.equal(resumed.orderId, order.orderId);
  await waitForScheduledShipment(order.orderId);
});

test("a late payment on a cancelled order requires refund without consuming stock", async () => {
  const checkout = await startCheckout({
    customer,
    requestedItems: [{ id: "sku-a", quantity: 1 }],
    paymentMethod: "online",
    idempotencyKey: "checkout-late-payment-key-0001",
  });
  let order = await findOrder(checkout.orderId);
  order = await mutateOrderRecord(order.orderId, (current) =>
    transitionOrderForAdmin(current, "cancelled", current.version),
  );
  const inventoryBefore = await inventoryFor("sku-a");
  const payment = {
    id: "pay_LateCancelled0001",
    order_id: order.razorpayOrderId,
    amount: order.total * 100,
    currency: "INR",
    status: "captured",
    method: "upi",
    created_at: Math.floor(Date.now() / 1000),
  };

  const confirmed = await confirmCapturedPayment({
    orderId: order.orderId,
    payment,
    source: "razorpay_webhook",
    eventId: "evt_late_cancelled_0001",
  });

  assert.equal(await inventoryFor("sku-a"), inventoryBefore);
  assert.equal(confirmed.paymentStatus, "paid");
  assert.equal(confirmed.fulfillmentStatus, "cancelled");
  assert.equal(confirmed.refundStatus, "pending");
  assert.equal(confirmed.inventoryStatus, "pending");
  await assert.rejects(
    startCheckout({
      customer,
      requestedItems: [{ id: "sku-a", quantity: 1 }],
      paymentMethod: "online",
      idempotencyKey: "checkout-late-payment-key-0001",
    }),
    (error) => error.code === "ORDER_REFUND_PENDING",
  );
});

test("a full refund cancels unshipped fulfilment and restores inventory once", async () => {
  const checkout = await startCheckout({
    customer,
    requestedItems: [{ id: "sku-b", quantity: 2 }],
    paymentMethod: "online",
    idempotencyKey: "checkout-refund-key-0001",
  });
  const order = await findOrder(checkout.orderId);
  const inventoryBefore = await inventoryFor("sku-b");
  const payment = {
    id: "pay_Refunded0001",
    order_id: order.razorpayOrderId,
    amount: order.total * 100,
    currency: "INR",
    status: "captured",
    method: "card",
    created_at: Math.floor(Date.now() / 1000),
  };
  await confirmCapturedPayment({
    orderId: order.orderId,
    payment,
    source: "checkout_callback",
  });
  assert.equal(await inventoryFor("sku-b"), inventoryBefore - 2);

  const refund = {
    id: "rfnd_Full0001",
    payment_id: payment.id,
    amount: order.total * 100,
    status: "processed",
  };
  await recordRefundEvent({
    eventType: "refund.processed",
    refund,
    eventId: "evt_refund_0001",
  });
  const replayed = await recordRefundEvent({
    eventType: "refund.processed",
    refund,
    eventId: "evt_refund_0002",
  });

  assert.equal(await inventoryFor("sku-b"), inventoryBefore);
  assert.equal(replayed.status, "refunded");
  assert.equal(replayed.refundStatus, "processed");
  assert.equal(replayed.fulfillmentStatus, "cancelled");
  assert.equal(replayed.inventoryStatus, "released");
});

test("simultaneous captured payments never drive limited inventory negative", async () => {
  const checkouts = await Promise.all(
    ["checkout-limited-key-0001", "checkout-limited-key-0002"].map(
      (idempotencyKey) =>
        startCheckout({
          customer,
          requestedItems: [{ id: "sku-c", quantity: 4 }],
          paymentMethod: "online",
          idempotencyKey,
        }),
    ),
  );
  const orders = await Promise.all(
    checkouts.map((checkout) => findOrder(checkout.orderId)),
  );
  const payments = orders.map((order, index) => ({
    id: `pay_Limited000${index + 1}`,
    order_id: order.razorpayOrderId,
    amount: order.total * 100,
    currency: "INR",
    status: "captured",
    method: "upi",
    created_at: Math.floor(Date.now() / 1000),
  }));

  const confirmed = await Promise.all(
    orders.map((order, index) =>
      confirmCapturedPayment({
        orderId: order.orderId,
        payment: payments[index],
        source: "razorpay_webhook",
        eventId: `evt_limited_000${index + 1}`,
      }),
    ),
  );

  assert.equal(await inventoryFor("sku-c"), 1);
  assert.equal(
    confirmed.filter((order) => order.inventoryStatus === "committed").length,
    1,
  );
  assert.equal(
    confirmed.filter((order) => order.inventoryStatus === "attention").length,
    1,
  );
  const committed = confirmed.find(
    (order) => order.inventoryStatus === "committed",
  );
  await waitForScheduledShipment(committed.orderId);
});

test("webhooks reject invalid signatures and deduplicate duplicate and distinct success events", async () => {
  const checkout = await startCheckout({
    customer,
    requestedItems: [{ id: "sku-b", quantity: 3 }],
    paymentMethod: "online",
    idempotencyKey: "checkout-webhook-key-0001",
  });
  const order = await findOrder(checkout.orderId);
  const payment = {
    id: "pay_Webhook0001",
    order_id: order.razorpayOrderId,
    amount: order.total * 100,
    currency: "INR",
    status: "captured",
    method: "upi",
    created_at: Math.floor(Date.now() / 1000),
  };
  const inventoryBefore = await inventoryFor("sku-b");
  const orderPaidPayload = {
    entity: "event",
    event: "order.paid",
    payload: {
      payment: { entity: payment },
      order: {
        entity: {
          id: order.razorpayOrderId,
          status: "paid",
        },
      },
    },
  };

  const invalid = await invokeWebhook({
    payload: orderPaidPayload,
    eventId: "evt_invalid_signature_0001",
    signature: "0".repeat(64),
  });
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.body.code, "INVALID_WEBHOOK_SIGNATURE");
  assert.equal(await inventoryFor("sku-b"), inventoryBefore);

  const first = await invokeWebhook({
    payload: orderPaidPayload,
    eventId: "evt_order_paid_0001",
  });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, { received: true });
  assert.equal(await inventoryFor("sku-b"), inventoryBefore - 3);

  const duplicate = await invokeWebhook({
    payload: orderPaidPayload,
    eventId: "evt_order_paid_0001",
  });
  assert.equal(duplicate.statusCode, 200);
  assert.deepEqual(duplicate.body, { received: true, duplicate: true });
  assert.equal(await inventoryFor("sku-b"), inventoryBefore - 3);

  const capturedPayload = {
    entity: "event",
    event: "payment.captured",
    payload: {
      payment: { entity: payment },
    },
  };
  const distinctSuccess = await invokeWebhook({
    payload: capturedPayload,
    eventId: "evt_payment_captured_0001",
  });
  assert.equal(distinctSuccess.statusCode, 200);
  assert.deepEqual(distinctSuccess.body, { received: true });
  assert.equal(await inventoryFor("sku-b"), inventoryBefore - 3);

  const storedEvents = await readJson(webhookEventsFile);
  assert.equal(
    storedEvents.some(
      (event) => event.eventId === "evt_invalid_signature_0001",
    ),
    false,
  );
  assert.equal(
    storedEvents.find((event) => event.eventId === "evt_order_paid_0001")
      ?.status,
    "processed",
  );
  assert.equal(
    storedEvents.find(
      (event) => event.eventId === "evt_payment_captured_0001",
    )?.status,
    "processed",
  );

  const storedOrder = await findOrder(order.orderId);
  assert.equal(storedOrder.paymentStatus, "paid");
  assert.equal(storedOrder.inventoryStatus, "committed");
  assert.equal(storedOrder.razorpayPaymentId, payment.id);
  await waitForScheduledShipment(order.orderId);
});

test("invalid and stale lifecycle transitions are rejected", () => {
  const pending = initializeOrderLifecycle({
    orderId: "KEL-TEST-LIFECYCLE",
    paymentMethod: "online",
    total: 120,
    createdAt: "2026-07-24T00:00:00.000Z",
  });
  const paid = evolveOrder(
    pending,
    { paymentStatus: "paid" },
    {
      event: "payment.captured",
      source: "test",
      at: "2026-07-24T00:01:00.000Z",
    },
  );

  assert.throws(
    () => transitionOrderForAdmin(pending, "shipped", pending.version),
    (error) => error.status === 409 && error.code === "INVALID_ORDER_TRANSITION",
  );
  assert.throws(
    () => transitionOrderForAdmin(paid, "delivered", paid.version),
    (error) => error.status === 409 && error.code === "INVALID_ORDER_TRANSITION",
  );
  assert.throws(
    () => transitionOrderForAdmin(paid, "processing", paid.version - 1),
    (error) => error.status === 409 && error.code === "STALE_ORDER_VERSION",
  );
});
