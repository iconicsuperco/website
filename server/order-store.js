import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(currentDirectory, "data");
const ordersFile = path.join(dataDirectory, "orders.json");

const readOrders = async () => {
  try {
    return JSON.parse(await fs.readFile(ordersFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const writeOrders = async (orders) => {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${ordersFile}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(orders, null, 2));
  await fs.rename(temporaryFile, ordersFile);
};

export const createOrderRecord = async (order) => {
  const orders = await readOrders();
  orders.push(order);
  await writeOrders(orders);
  return order;
};

export const findOrder = async (orderId) => {
  const orders = await readOrders();
  return orders.find((order) => order.orderId === orderId) || null;
};

export const getOrders = async () => {
  const orders = await readOrders();
  return orders.sort(
    (first, second) =>
      new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime(),
  );
};

export const updateOrderRecord = async (orderId, changes) => {
  const orders = await readOrders();
  const index = orders.findIndex((order) => order.orderId === orderId);
  if (index === -1) throw new Error("Order record not found.");
  orders[index] = { ...orders[index], ...changes };
  await writeOrders(orders);
  return orders[index];
};
