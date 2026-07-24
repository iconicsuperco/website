import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTS } from "../src/data/products.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(currentDirectory, "data");
const productsFile = path.join(dataDirectory, "products.json");

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
    return JSON.parse(await fs.readFile(productsFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return seedProducts();
    throw error;
  }
};

const writeProductRecords = async (products) => {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${productsFile}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(products, null, 2));
  await fs.rename(temporaryFile, productsFile);
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
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("A valid selling price is required.");
  }
  if (!Number.isFinite(mrp) || mrp < price) {
    throw new Error("MRP must be equal to or higher than the selling price.");
  }
  if (!Number.isInteger(inventory) || inventory < 0) {
    throw new Error("Inventory must be a whole number of zero or more.");
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
    rating:
      input.rating === "" || input.rating == null ? null : Number(input.rating),
    reviews: Number(input.reviews || 0),
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
  return includeInactive
    ? products
    : products.filter((product) => product.active !== false);
};

export const createProduct = async (input) => {
  const products = await readProductRecords();
  const product = normalizeProduct(input);
  if (!product.id) throw new Error("A valid product name is required.");
  if (products.some((entry) => entry.id === product.id)) {
    product.id = `${product.id}-${Date.now().toString().slice(-5)}`;
  }
  product.createdAt = product.updatedAt;
  products.unshift(product);
  await writeProductRecords(products);
  return product;
};

export const updateProduct = async (productId, input) => {
  const products = await readProductRecords();
  const index = products.findIndex((product) => product.id === productId);
  if (index === -1) throw new Error("Product not found.");
  products[index] = normalizeProduct(input, products[index]);
  await writeProductRecords(products);
  return products[index];
};

export const archiveProduct = async (productId) => {
  const products = await readProductRecords();
  const index = products.findIndex((product) => product.id === productId);
  if (index === -1) throw new Error("Product not found.");
  products[index] = {
    ...products[index],
    active: false,
    updatedAt: new Date().toISOString(),
  };
  await writeProductRecords(products);
  return products[index];
};

export const decrementInventory = async (items) => {
  const products = await readProductRecords();
  for (const item of items) {
    const product = products.find((entry) => entry.id === item.id);
    if (!product || Number(product.inventory || 0) < item.quantity) {
      throw new Error(`${item.name} no longer has enough stock.`);
    }
  }
  const updatedAt = new Date().toISOString();
  for (const item of items) {
    const index = products.findIndex((entry) => entry.id === item.id);
    products[index] = {
      ...products[index],
      inventory: Number(products[index].inventory || 0) - item.quantity,
      updatedAt,
    };
  }
  await writeProductRecords(products);
};
