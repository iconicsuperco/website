import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "./http-error.js";
import { PRODUCTS } from "../src/data/products.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(currentDirectory, "data");
const productsFile = process.env.PRODUCTS_DATA_FILE
  ? path.resolve(process.env.PRODUCTS_DATA_FILE)
  : path.join(dataDirectory, "products.json");
let productMutationQueue = Promise.resolve();

const seedProducts = () => {
  const timestamp = new Date().toISOString();
  return PRODUCTS.map((product) => ({
    ...product,
    inventory: 25,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
};

const readProductRecords = async () => {
  try {
    const value = JSON.parse(await fs.readFile(productsFile, "utf8"));
    if (!Array.isArray(value)) {
      throw new Error("The product store must contain a JSON array.");
    }
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return seedProducts();
    throw error;
  }
};

const writeProductRecords = async (products) => {
  await fs.mkdir(path.dirname(productsFile), { recursive: true });
  const temporaryFile = `${productsFile}.${process.pid}.${crypto
    .randomBytes(5)
    .toString("hex")}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(products, null, 2), {
    mode: 0o600,
  });
  await fs.rename(temporaryFile, productsFile);
};

const mutateProducts = (task) => {
  const mutation = productMutationQueue
    .catch(() => undefined)
    .then(async () => {
      const products = await readProductRecords();
      const result = await task(products);
      await writeProductRecords(products);
      return result;
    });
  productMutationQueue = mutation;
  return mutation;
};

const publicProduct = (product) => {
  const { _inventoryTransactions: _privateTransactions, ...publicFields } =
    product;
  return publicFields;
};

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

const normalizeHighlights = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeSpecs = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        Array.isArray(entry)
          ? [String(entry[0] || "").trim(), String(entry[1] || "").trim()]
          : null,
      )
      .filter((entry) => entry?.[0] && entry?.[1]);
  }
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.split(":").map((part) => part.trim()))
    .filter((entry) => entry.length >= 2 && entry[0] && entry[1])
    .map(([label, ...rest]) => [label, rest.join(": ")]);
};

const normalizeProduct = (input, existing = {}) => {
  const price = Number(input.price);
  const mrp = Number(input.mrp);
  const inventory = Number(input.inventory);
  const rating =
    input.rating === "" || input.rating == null ? null : Number(input.rating);
  const reviews = Number(input.reviews || 0);
  if (!Number.isSafeInteger(price) || price <= 0 || price > 10_000_000) {
    throw new Error("Selling price must be a whole rupee amount.");
  }
  if (
    !Number.isSafeInteger(mrp) ||
    mrp < price ||
    mrp > 10_000_000
  ) {
    throw new Error(
      "MRP must be a whole rupee amount equal to or above the selling price.",
    );
  }
  if (!Number.isInteger(inventory) || inventory < 0) {
    throw new Error("Inventory must be a whole number of zero or more.");
  }
  if (rating != null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) {
    throw new Error("Rating must be between 0 and 5.");
  }
  if (!Number.isSafeInteger(reviews) || reviews < 0) {
    throw new Error("Ratings count must be a whole number of zero or more.");
  }

  const name = requiredText(input.name, "Product name");
  return {
    ...existing,
    id: existing.id || slugify(input.id || name),
    asin: String(input.asin || "").trim(),
    name,
    sourceTitle: String(input.sourceTitle || name).trim(),
    category: requiredText(input.category, "Category"),
    price,
    mrp,
    rating,
    reviews,
    image: requiredText(input.image, "Product image"),
    badge: String(input.badge || "New").trim(),
    featured: Boolean(input.featured),
    short: requiredText(input.short, "Short description"),
    highlights: normalizeHighlights(input.highlights),
    specs: normalizeSpecs(input.specs),
    inventory,
    active: input.active !== false,
    updatedAt: new Date().toISOString(),
  };
};

export const getProducts = async ({ includeInactive = false } = {}) => {
  const products = await readProductRecords();
  const selected = includeInactive
    ? products
    : products.filter((product) => product.active !== false);
  return selected.map(publicProduct);
};

export const createProduct = (input) => mutateProducts((products) => {
  const product = normalizeProduct(input);
  if (!product.id) throw new Error("A valid product name is required.");
  if (products.some((entry) => entry.id === product.id)) {
    product.id = `${product.id}-${Date.now().toString().slice(-5)}`;
  }
  product.createdAt = product.updatedAt;
  products.unshift(product);
  return publicProduct(product);
});

export const updateProduct = (productId, input) => mutateProducts((products) => {
  const index = products.findIndex((product) => product.id === productId);
  if (index === -1) throw new Error("Product not found.");
  products[index] = normalizeProduct(input, products[index]);
  return publicProduct(products[index]);
});

export const archiveProduct = (productId) => mutateProducts((products) => {
  const index = products.findIndex((product) => product.id === productId);
  if (index === -1) throw new Error("Product not found.");
  products[index] = {
    ...products[index],
    active: false,
    updatedAt: new Date().toISOString(),
  };
  return publicProduct(products[index]);
});

const aggregateInventoryItems = (items) => {
  const quantities = new Map();
  for (const item of items || []) {
    const quantity = Number(item.quantity);
    if (!item.id || !Number.isInteger(quantity) || quantity < 1) {
      throw new HttpError(
        400,
        "INVALID_INVENTORY_ITEMS",
        "One or more inventory items are invalid.",
      );
    }
    quantities.set(item.id, (quantities.get(item.id) || 0) + quantity);
  }
  return [...quantities].map(([id, quantity]) => {
    const source = items.find((item) => item.id === id);
    return { ...source, id, quantity };
  });
};

const applyInventoryTransaction = (
  items,
  { transactionId, direction },
) =>
  mutateProducts((products) => {
    const aggregated = aggregateInventoryItems(items);
    const operationId = `${direction}:${transactionId}`;
    const operationStates = aggregated.map((item) => {
      const product = products.find((entry) => entry.id === item.id);
      return Boolean(product?._inventoryTransactions?.includes(operationId));
    });
    if (operationStates.every(Boolean)) {
      return { applied: false, transactionId };
    }
    if (operationStates.some(Boolean)) {
      throw new HttpError(
        409,
        "PARTIAL_INVENTORY_TRANSACTION",
        "Inventory needs manual reconciliation for this order.",
      );
    }

    for (const item of aggregated) {
      const product = products.find((entry) => entry.id === item.id);
      if (!product) {
        throw new HttpError(
          409,
          "PRODUCT_NOT_FOUND",
          `${item.name || "A product"} is no longer available.`,
        );
      }
      if (
        direction === "commit" &&
        Number(product.inventory || 0) < item.quantity
      ) {
        throw new HttpError(
          409,
          "INSUFFICIENT_STOCK",
          `${item.name} no longer has enough stock.`,
        );
      }
    }

    const updatedAt = new Date().toISOString();
    for (const item of aggregated) {
      const index = products.findIndex((entry) => entry.id === item.id);
      const current = products[index];
      products[index] = {
        ...current,
        inventory:
          Number(current.inventory || 0) +
          (direction === "release" ? item.quantity : -item.quantity),
        _inventoryTransactions: [
          ...(current._inventoryTransactions || []),
          operationId,
        ],
        updatedAt,
      };
    }
    return { applied: true, transactionId };
  });

export const decrementInventory = (items, { transactionId } = {}) => {
  if (!transactionId) {
    throw new HttpError(
      500,
      "INVENTORY_TRANSACTION_REQUIRED",
      "Inventory could not be updated safely.",
    );
  }
  return applyInventoryTransaction(items, {
    transactionId,
    direction: "commit",
  });
};

export const restoreInventory = (items, { transactionId } = {}) => {
  if (!transactionId) {
    throw new HttpError(
      500,
      "INVENTORY_TRANSACTION_REQUIRED",
      "Inventory could not be restored safely.",
    );
  }
  return applyInventoryTransaction(items, {
    transactionId,
    direction: "release",
  });
};
