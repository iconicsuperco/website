import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import adminRouter from "./admin-routes.js";
import {
  createOrderRecord,
  findOrder,
  updateOrderRecord,
} from "./order-store.js";
import { decrementInventory, getProducts } from "./product-store.js";
import { createShiprocketShipment } from "./shiprocket.js";
import {
  getStoreSettings,
  publicStoreSettings,
} from "./store-settings.js";

const PORT = Number(process.env.PORT || 8787);
const app = express();
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..");

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use((request, response, next) => {
  const allowedOrigin = process.env.STORE_ORIGIN;
  if (allowedOrigin && request.headers.origin === allowedOrigin) {
    response.header("Access-Control-Allow-Origin", allowedOrigin);
    response.header("Access-Control-Allow-Credentials", "true");
    response.header("Vary", "Origin");
    response.header("Access-Control-Allow-Headers", "Content-Type");
    response.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
  }
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});

const requireText = (value, field, minLength = 1) => {
  const normalized = String(value || "").trim();
  if (normalized.length < minLength) {
    throw new Error(`A valid ${field} is required.`);
  }
  return normalized;
};

const validateCustomer = (input = {}) => {
  const phone = requireText(input.phone, "mobile number", 10);
  const pincode = requireText(input.pincode, "PIN code", 6);
  if (!/^\d{10}$/.test(phone)) throw new Error("Mobile number must be 10 digits.");
  if (!/^\d{6}$/.test(pincode)) throw new Error("PIN code must be 6 digits.");

  return {
    name: requireText(input.name, "name", 2),
    phone,
    email: requireText(input.email, "email", 5),
    address: requireText(input.address, "address", 3),
    area: requireText(input.area, "area", 2),
    city: requireText(input.city, "city", 2),
    state: requireText(input.state, "state", 2),
    pincode,
  };
};

const priceOrder = async (requestedItems = []) => {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    throw new Error("Your cart is empty.");
  }

  const products = await getProducts();
  const items = requestedItems.map((requested) => {
    const product = products.find((entry) => entry.id === requested.id);
    const quantity = Number(requested.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new Error("One or more cart items are invalid.");
    }
    if (Number(product.inventory || 0) < quantity) {
      throw new Error(`${product.name} does not have enough stock.`);
    }
    return {
      id: product.id,
      asin: product.asin,
      name: product.name,
      price: product.price,
      quantity,
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
  return { items, subtotal, shipping, total: subtotal + shipping };
};

const createRazorpayOrder = async ({ orderId, total }) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured.");
  }

  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: total * 100,
      currency: "INR",
      receipt: orderId,
      notes: { storefront: "kelenate.in" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Razorpay order error:", response.status, detail);
    throw new Error("The payment provider could not start this order.");
  }
  return response.json();
};

const internalOrderId = () => {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `KEL-${date}-${suffix}`;
};

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    razorpay: Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
    ),
    shiprocket: Boolean(
      process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD,
    ),
  });
});

app.get("/api/catalog", async (_request, response) => {
  const [products, storeSettings] = await Promise.all([
    getProducts(),
    getStoreSettings(),
  ]);
  response.json({
    products,
    settings: publicStoreSettings(storeSettings),
  });
});

app.use("/api/admin", adminRouter);

app.post("/api/checkout", async (request, response) => {
  try {
    const customer = validateCustomer(request.body.customer);
    const totals = await priceOrder(request.body.items);
    const paymentMethod =
      request.body.paymentMethod === "cod" ? "cod" : "online";
    const orderId = internalOrderId();

    const order = await createOrderRecord({
      orderId,
      customer,
      ...totals,
      paymentMethod,
      status: paymentMethod === "cod" ? "cod_confirmed" : "payment_pending",
      createdAt: new Date().toISOString(),
    });

    if (paymentMethod === "cod") {
      await decrementInventory(order.items);
      const shipment = await createShiprocketShipment(order);
      await updateOrderRecord(orderId, {
        shipment,
        status: shipment.created ? "shipment_created" : "shipment_pending",
      });
      response.json({
        orderId,
        status: shipment.created ? "confirmed" : "shipment_pending",
        message: shipment.created
          ? "Your cash-on-delivery order is confirmed."
          : "Your order is confirmed and is waiting for courier allocation.",
      });
      return;
    }

    const razorpayOrder = await createRazorpayOrder({
      orderId,
      total: totals.total,
    });
    await updateOrderRecord(orderId, {
      razorpayOrderId: razorpayOrder.id,
    });
    response.json({
      orderId,
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      amount: razorpayOrder.amount,
    });
  } catch (error) {
    console.error("Checkout error:", error);
    response.status(400).json({
      message: error.message || "Checkout could not be started.",
    });
  }
});

app.post("/api/checkout/verify", async (request, response) => {
  try {
    const {
      orderId,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature,
    } = request.body;
    const order = await findOrder(orderId);
    if (!order || order.razorpayOrderId !== razorpayOrderId) {
      throw new Error("This order could not be verified.");
    }
    if (order.razorpayPaymentId === razorpayPaymentId) {
      response.json({
        orderId,
        status: "confirmed",
        message: "Payment received and your order is confirmed.",
      });
      return;
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");
    const supplied = Buffer.from(String(razorpaySignature || ""));
    const expected = Buffer.from(expectedSignature);
    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      throw new Error("Payment signature verification failed.");
    }

    await decrementInventory(order.items);
    const paidOrder = await updateOrderRecord(orderId, {
      razorpayPaymentId,
      paidAt: new Date().toISOString(),
      status: "paid",
    });
    const shipment = await createShiprocketShipment(paidOrder);
    await updateOrderRecord(orderId, {
      shipment,
      status: shipment.created ? "shipment_created" : "shipment_pending",
    });
    response.json({
      orderId,
      status: shipment.created ? "confirmed" : "shipment_pending",
      message: shipment.created
        ? "Payment received and your order is confirmed."
        : "Payment received. Your order is confirmed and awaiting courier allocation.",
    });
  } catch (error) {
    console.error("Verification error:", error);
    response.status(400).json({
      message: error.message || "Payment could not be verified.",
    });
  }
});

app.use("/uploads", express.static(path.join(projectRoot, "public", "uploads")));
app.use(express.static(path.join(projectRoot, "dist")));
app.get("/{*splat}", (_request, response) => {
  response.sendFile(path.join(projectRoot, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Kelenate commerce server listening on http://localhost:${PORT}`);
});
