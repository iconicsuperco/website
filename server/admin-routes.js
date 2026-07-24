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
import { getOrders, updateOrderRecord } from "./order-store.js";
import {
  archiveProduct,
  createProduct,
  getProducts,
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

const allowedOrderStatuses = new Set([
  "payment_pending",
  "paid",
  "cod_confirmed",
  "shipment_pending",
  "shipment_created",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

const router = express.Router();

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
  const revenueStatuses = new Set([
    "paid",
    "shipment_pending",
    "shipment_created",
    "processing",
    "shipped",
    "delivered",
  ]);
  const pendingStatuses = new Set([
    "paid",
    "cod_confirmed",
    "shipment_pending",
    "shipment_created",
    "processing",
  ]);
  response.json({
    metrics: {
      totalOrders: orders.length,
      revenue: orders
        .filter((order) => revenueStatuses.has(order.status))
        .reduce((sum, order) => sum + Number(order.total || 0), 0),
      pendingOrders: orders.filter((order) => pendingStatuses.has(order.status))
        .length,
      activeProducts: products.filter((product) => product.active !== false)
        .length,
      lowStock: products.filter(
        (product) =>
          product.active !== false && Number(product.inventory || 0) <= 5,
      ).length,
    },
    recentOrders: orders.slice(0, 6),
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
  response.json({ orders: await getOrders() });
});

router.patch("/orders/:orderId", async (request, response) => {
  try {
    const status = String(request.body.status || "");
    if (!allowedOrderStatuses.has(status)) {
      throw new Error("Choose a valid order status.");
    }
    const order = await updateOrderRecord(request.params.orderId, {
      status,
      statusUpdatedAt: new Date().toISOString(),
    });
    response.json({ order });
  } catch (error) {
    response.status(400).json({ message: error.message });
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
