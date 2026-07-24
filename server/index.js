import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import adminRouter from "./admin-routes.js";
import {
  codCheckoutEnabled,
  onlineCheckoutEnabled,
  startCheckout,
  verifyCheckoutPayment,
} from "./commerce-service.js";
import { HttpError, asHttpError } from "./http-error.js";
import { getProducts } from "./product-store.js";
import { lookupIndianPincode } from "./pincode.js";
import { createRateLimiter } from "./rate-limit.js";
import { razorpayWebhookHandler } from "./razorpay-webhook.js";
import {
  getStoreSettings,
  publicStoreSettings,
} from "./store-settings.js";

const PORT = Number(process.env.PORT || 8787);
const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const projectRoot = path.resolve(currentDirectory, "..");
export const app = express();

if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((request, response, next) => {
  const requestId = crypto.randomUUID();
  request.requestId = requestId;
  response.header("X-Request-ID", requestId);
  response.header("X-Content-Type-Options", "nosniff");
  response.header("Referrer-Policy", "same-origin");
  response.header("X-Frame-Options", "DENY");
  response.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  next();
});

app.post(
  "/api/webhooks/razorpay",
  express.raw({ type: "application/json", limit: "256kb" }),
  razorpayWebhookHandler,
);

app.use(express.json({ limit: "100kb" }));
app.use((request, response, next) => {
  if (request.path.startsWith("/api/")) {
    response.header("Cache-Control", "no-store, max-age=0");
  }
  const allowedOrigin = process.env.STORE_ORIGIN;
  const requestOrigin = request.headers.origin;
  if (allowedOrigin && requestOrigin === allowedOrigin) {
    response.header("Access-Control-Allow-Origin", allowedOrigin);
    response.header("Access-Control-Allow-Credentials", "true");
    response.header("Vary", "Origin");
    response.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Idempotency-Key, If-Match, X-Order-Version",
    );
    response.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
  }
  if (request.method === "OPTIONS") {
    if (allowedOrigin && requestOrigin && requestOrigin !== allowedOrigin) {
      response.sendStatus(403);
      return;
    }
    response.sendStatus(204);
    return;
  }
  const stateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(
    request.method,
  );
  if (
    allowedOrigin &&
    requestOrigin &&
    requestOrigin !== allowedOrigin &&
    stateChanging
  ) {
    response.status(403).json({
      code: "ORIGIN_NOT_ALLOWED",
      message: "This request did not come from the configured storefront.",
    });
    return;
  }
  next();
});

const pincodeRateLimit = createRateLimiter({
  name: "pincode",
  windowMs: 60 * 1000,
  max: 60,
});
const checkoutRateLimit = createRateLimiter({
  name: "checkout-ip",
  windowMs: 10 * 60 * 1000,
  max: 12,
});
const checkoutPhoneRateLimit = createRateLimiter({
  name: "checkout-phone",
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (request) =>
    String(request.body?.customer?.phone || request.ip || "unknown"),
});
const verifyRateLimit = createRateLimiter({
  name: "payment-verify",
  windowMs: 10 * 60 * 1000,
  max: 30,
});
const adminLoginRateLimit = createRateLimiter({
  name: "admin-login",
  windowMs: 15 * 60 * 1000,
  max: 5,
});

const requireText = (
  value,
  field,
  { minimum = 1, maximum = 200 } = {},
) => {
  const normalized = String(value || "").trim();
  if (normalized.length < minimum) {
    throw new HttpError(
      400,
      "INVALID_CUSTOMER_DETAILS",
      `A valid ${field} is required.`,
    );
  }
  const hasDisallowedControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });
  if (
    normalized.length > maximum ||
    hasDisallowedControlCharacter
  ) {
    throw new HttpError(
      400,
      "INVALID_CUSTOMER_DETAILS",
      `${field} contains invalid or excessive text.`,
    );
  }
  return normalized;
};

const validateCustomer = (input = {}) => {
  const phone = requireText(input.phone, "mobile number", {
    minimum: 10,
    maximum: 10,
  });
  const email = requireText(input.email, "email", {
    minimum: 5,
    maximum: 254,
  }).toLowerCase();
  const pincode = requireText(input.pincode, "PIN code", {
    minimum: 6,
    maximum: 6,
  });
  if (!/^[6-9]\d{9}$/.test(phone)) {
    throw new HttpError(
      400,
      "INVALID_PHONE",
      "Enter a valid 10-digit Indian mobile number.",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(
      400,
      "INVALID_EMAIL",
      "Enter a valid email address.",
    );
  }
  if (!/^[1-9]\d{5}$/.test(pincode)) {
    throw new HttpError(
      400,
      "INVALID_PINCODE",
      "Enter a valid 6-digit Indian PIN code.",
    );
  }

  return {
    name: requireText(input.name, "name", {
      minimum: 2,
      maximum: 100,
    }),
    phone,
    email,
    address: requireText(input.address, "address", {
      minimum: 3,
      maximum: 180,
    }),
    area: requireText(input.area, "area", {
      minimum: 2,
      maximum: 120,
    }),
    city: requireText(input.city, "city", {
      minimum: 2,
      maximum: 80,
    }),
    state: requireText(input.state, "state", {
      minimum: 2,
      maximum: 80,
    }),
    pincode,
  };
};

const sendRouteError = (
  response,
  error,
  fallbackMessage,
  context,
) => {
  const normalized = asHttpError(error, fallbackMessage);
  if (normalized.status >= 500) {
    console.error(context, {
      requestId: response.getHeader("X-Request-ID"),
      code: normalized.code,
      cause: normalized.cause?.message,
    });
  }
  response.status(normalized.status).json({
    code: normalized.code,
    message: normalized.expose ? normalized.message : fallbackMessage,
  });
};

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    razorpay: Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
    ),
    razorpayWebhook: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    onlinePayment: onlineCheckoutEnabled(),
    shiprocket: Boolean(
      process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD,
    ),
    cod: codCheckoutEnabled(),
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
    capabilities: {
      onlinePayment: onlineCheckoutEnabled(),
      cod: codCheckoutEnabled(),
    },
  });
});

app.get(
  "/api/pincode/:pincode",
  pincodeRateLimit,
  async (request, response) => {
    try {
      const result = await lookupIndianPincode(request.params.pincode);
      if (!result) {
        response.status(404).json({
          valid: false,
          code: "PINCODE_NOT_FOUND",
          message: "We could not find that PIN code. Check the six digits.",
        });
        return;
      }
      response.json({ valid: true, ...result });
    } catch (error) {
      const status =
        error.code === "INVALID_PINCODE"
          ? 400
          : error.code === "PINCODE_LOOKUP_UNAVAILABLE"
            ? 503
            : 500;
      response.status(status).json({
        valid: status >= 500 ? null : false,
        code: error.code || "PINCODE_LOOKUP_FAILED",
        message:
          status >= 500
            ? "PIN lookup is temporarily unavailable."
            : error.message,
      });
    }
  },
);

app.use("/api/admin/login", adminLoginRateLimit);
app.use("/api/admin", adminRouter);

app.post(
  "/api/checkout",
  checkoutRateLimit,
  checkoutPhoneRateLimit,
  async (request, response) => {
    try {
      let customer = validateCustomer(request.body.customer);
      const paymentMethod = String(request.body.paymentMethod || "");
      try {
        const postalRecord = await lookupIndianPincode(customer.pincode);
        if (!postalRecord) {
          throw new HttpError(
            400,
            "PINCODE_NOT_FOUND",
            "We could not find that PIN code in the postal directory.",
          );
        }
        customer = {
          ...customer,
          city: postalRecord.city || customer.city,
          state: postalRecord.state || customer.state,
        };
        if (
          paymentMethod === "cod" &&
          Number(postalRecord.deliveryPostOffices || 0) === 0
        ) {
          throw new HttpError(
            409,
            "COD_PIN_UNAVAILABLE",
            "COD could not be verified for this PIN code. Choose online payment or contact support.",
          );
        }
      } catch (pincodeError) {
        if (pincodeError.code !== "PINCODE_LOOKUP_UNAVAILABLE") {
          throw pincodeError;
        }
        if (paymentMethod === "cod") {
          throw new HttpError(
            503,
            "COD_PIN_LOOKUP_UNAVAILABLE",
            "COD PIN verification is temporarily unavailable. Choose online payment or try again shortly.",
            { expose: true },
          );
        }
        // A postal-directory outage should not block a manually verified address.
      }

      const order = await startCheckout({
        customer,
        requestedItems: request.body.items,
        paymentMethod,
        idempotencyKey: request.get("Idempotency-Key"),
      });
      response.status(201).json(order);
    } catch (error) {
      sendRouteError(
        response,
        error,
        "Checkout could not be started.",
        "Checkout failed",
      );
    }
  },
);

app.post(
  "/api/checkout/verify",
  verifyRateLimit,
  async (request, response) => {
    try {
      const result = await verifyCheckoutPayment({
        orderId: String(request.body.orderId || ""),
        razorpayPaymentId: String(
          request.body.razorpay_payment_id || "",
        ),
        signature: String(request.body.razorpay_signature || ""),
      });
      response.status(result.pending ? 202 : 200).json({
        orderId: result.order.orderId,
        status: result.pending
          ? "payment_processing"
          : result.order.status,
        message: result.message,
      });
    } catch (error) {
      sendRouteError(
        response,
        error,
        "Payment could not be verified.",
        "Payment verification failed",
      );
    }
  },
);

app.use("/uploads", express.static(path.join(projectRoot, "public", "uploads")));
app.use(express.static(path.join(projectRoot, "dist")));
app.get("/{*splat}", (_request, response) => {
  response.sendFile(path.join(projectRoot, "dist", "index.html"));
});

export const startServer = (port = PORT) =>
  app.listen(port, () => {
    console.log(`Kelenate commerce server listening on http://localhost:${port}`);
  });

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  startServer();
}
