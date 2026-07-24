import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { CATEGORIES } from "../src/data/products.js";
import {
  adminSession,
  loginAdmin,
  logoutAdmin,
  requireAdmin,
} from "./admin-auth.js";
import { asHttpError, HttpError } from "./http-error.js";
import { withKeyedLock } from "./keyed-lock.js";
import {
  evolveOrder,
  ORDER_STATUSES,
  orderWithAdminTransitions,
  transitionOrderForAdmin,
} from "./order-lifecycle.js";
import {
  findOrder,
  getOrders,
  mutateOrderRecord,
} from "./order-store.js";
import {
  archiveProduct,
  createProduct,
  getProducts,
  restoreInventory,
  updateProduct,
} from "./product-store.js";
import {
  getStoreSettings,
  updateStoreSettings,
} from "./store-settings.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..");
const uploadDirectory = path.join(projectRoot, "public", "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_request, file, callback) => {
      const extension =
        file.mimetype === "image/png"
          ? ".png"
          : file.mimetype === "image/webp"
            ? ".webp"
            : ".jpg";
      callback(null, `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${extension}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new Error("Upload a JPG, PNG or WebP image."));
      return;
    }
    callback(null, true);
  },
});

const allowedOrderStatuses = new Set(ORDER_STATUSES);

const router = express.Router();

const orderVersionFromRequest = (request) => {
  const rawVersion = request.body?.version ?? request.get("If-Match");
  const normalized = String(rawVersion ?? "")
    .replace(/^W\//, "")
    .replace(/^"|"$/g, "");
  const version = Number(normalized);
  if (!Number.isInteger(version) || version < 1) {
    throw new HttpError(
      428,
      "ORDER_VERSION_REQUIRED",
      "Refresh this order before changing its status.",
    );
  }
  return version;
};

const capturedRevenue = (order) => {
  if (order.paymentStatus !== "paid") return 0;
  const total = Number(order.total || 0);
  const processedRefund = Number(order.refundedAmount || 0) / 100;
  if (order.refundStatus === "processed" && processedRefund === 0) return 0;
  return Math.max(0, total - processedRefund);
};

const orderNeedsAction = (order) => {
  if (order.inventoryStatus === "attention") return true;
  if (order.refundStatus === "failed") return true;
  if (
    ["cancelled", "shipped", "delivered"].includes(order.fulfillmentStatus) ||
    order.refundStatus === "processed"
  ) {
    return false;
  }
  return (
    ["paid", "cod_due"].includes(order.paymentStatus) &&
    ["unfulfilled", "packed"].includes(order.fulfillmentStatus)
  );
};

const adminSettingsPayload = async (savedSettings) => {
  const [products, storeSettings] = await Promise.all([
    getProducts({ includeInactive: true }),
    savedSettings ? Promise.resolve(savedSettings) : getStoreSettings(),
  ]);
  return {
    ...storeSettings,
    categories: [
      ...new Set([
        ...CATEGORIES.slice(1),
        ...products.map((product) => product.category),
      ]),
    ],
    developmentPassword:
      !process.env.ADMIN_PASSWORD && process.env.NODE_ENV !== "production",
    integrations: {
      razorpay: Boolean(
        process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
      ),
      razorpayWebhook: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
      shiprocket: Boolean(
        process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD,
      ),
    },
  };
};

router.post("/login", loginAdmin);
router.post("/logout", logoutAdmin);
router.get("/session", adminSession);

router.use(requireAdmin);

router.get("/dashboard", async (_request, response) => {
  const [orders, products] = await Promise.all([
    getOrders(),
    getProducts({ includeInactive: true }),
  ]);
  response.json({
    metrics: {
      totalOrders: orders.length,
      revenue: orders.reduce(
        (sum, order) => sum + capturedRevenue(order),
        0,
      ),
      pendingOrders: orders.filter(orderNeedsAction).length,
      activeProducts: products.filter((product) => product.active !== false)
        .length,
      lowStock: products.filter(
        (product) =>
          product.active !== false && Number(product.inventory || 0) <= 5,
      ).length,
    },
    recentOrders: orders.slice(0, 6).map(orderWithAdminTransitions),
    lowStockProducts: products
      .filter(
        (product) =>
          product.active !== false && Number(product.inventory || 0) <= 5,
      )
      .slice(0, 6),
    integrations: {
      razorpay: Boolean(
        process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
      ),
      razorpayWebhook: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
      shiprocket: Boolean(
        process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD,
      ),
      measurements: Boolean(
        process.env.SHIPROCKET_DEFAULT_WEIGHT_KG &&
          process.env.SHIPROCKET_DEFAULT_LENGTH_CM &&
          process.env.SHIPROCKET_DEFAULT_BREADTH_CM &&
          process.env.SHIPROCKET_DEFAULT_HEIGHT_CM,
      ),
    },
  });
});

router.get("/orders", async (_request, response) => {
  const orders = await getOrders();
  response.json({ orders: orders.map(orderWithAdminTransitions) });
});

router.patch("/orders/:orderId", async (request, response) => {
  try {
    const status = String(request.body?.status || "");
    if (!allowedOrderStatuses.has(status)) {
      throw new HttpError(
        400,
        "INVALID_ORDER_STATUS",
        "Choose a valid order status.",
      );
    }
    const expectedVersion = orderVersionFromRequest(request);
    const order = await withKeyedLock(
      `order:${request.params.orderId}`,
      async () => {
        if (status !== "cancelled") {
          return mutateOrderRecord(request.params.orderId, (current) =>
            transitionOrderForAdmin(current, status, expectedVersion),
          );
        }

        const current = await findOrder(request.params.orderId);
        if (!current) {
          throw new HttpError(
            404,
            "ORDER_NOT_FOUND",
            "Order record not found.",
          );
        }
        transitionOrderForAdmin(current, status, expectedVersion);
        const shouldReleaseInventory =
          current.inventoryStatus === "committed" &&
          !["shipped", "delivered"].includes(current.fulfillmentStatus);
        if (shouldReleaseInventory) {
          await restoreInventory(current.items, {
            transactionId: current.orderId,
          });
        }

        return mutateOrderRecord(request.params.orderId, (latest) => {
          let updated = transitionOrderForAdmin(
            latest,
            status,
            expectedVersion,
          );
          if (shouldReleaseInventory) {
            updated = evolveOrder(
              updated,
              {
                inventoryStatus: "released",
                inventoryReleasedAt: new Date().toISOString(),
              },
              {
                event: "inventory.released",
                source: "admin",
              },
            );
          }
          return updated;
        });
      },
    );
    response.json({
      order: orderWithAdminTransitions(order),
    });
  } catch (error) {
    const httpError = asHttpError(error, "The order could not be updated.");
    if (httpError.status >= 500) {
      console.error("Admin order update failed", {
        orderId: request.params.orderId,
        code: httpError.code,
      });
    }
    response.status(httpError.status).json({
      code: httpError.code,
      message: httpError.expose
        ? httpError.message
        : "The order could not be updated.",
    });
  }
});

router.get("/products", async (_request, response) => {
  const products = await getProducts({ includeInactive: true });
  response.json({
    products,
    categories: [
      ...new Set([
        ...CATEGORIES.slice(1),
        ...products.map((product) => product.category),
      ]),
    ],
  });
});

router.post("/products", async (request, response) => {
  try {
    response.status(201).json({ product: await createProduct(request.body) });
  } catch (error) {
    response.status(400).json({ message: error.message });
  }
});

router.put("/products/:productId", async (request, response) => {
  try {
    response.json({
      product: await updateProduct(request.params.productId, request.body),
    });
  } catch (error) {
    response.status(400).json({ message: error.message });
  }
});

router.delete("/products/:productId", async (request, response) => {
  try {
    response.json({
      product: await archiveProduct(request.params.productId),
      message: "Product archived.",
    });
  } catch (error) {
    response.status(400).json({ message: error.message });
  }
});

router.post(
  "/upload",
  (request, response, next) => {
    upload.single("image")(request, response, (error) => {
      if (error) {
        response.status(400).json({ message: error.message });
        return;
      }
      next();
    });
  },
  (request, response) => {
    if (!request.file) {
      response.status(400).json({ message: "Choose an image to upload." });
      return;
    }
    response.status(201).json({ url: `/uploads/${request.file.filename}` });
  },
);

router.get("/settings", async (_request, response) => {
  response.json(await adminSettingsPayload());
});

router.put("/settings", async (request, response) => {
  try {
    const settings = await updateStoreSettings(request.body);
    response.json(await adminSettingsPayload(settings));
  } catch (error) {
    response.status(400).json({ message: error.message });
  }
});

export default router;
