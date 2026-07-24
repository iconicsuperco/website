import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "./http-error.js";
import { normalizeOrderLifecycle } from "./order-lifecycle.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(currentDirectory, "data");
const defaultOrdersFile = process.env.ORDERS_DATA_FILE
  ? path.resolve(process.env.ORDERS_DATA_FILE)
  : path.join(dataDirectory, "orders.json");

export const createOrderStore = ({ ordersFile = defaultOrdersFile } = {}) => {
  let mutationQueue = Promise.resolve();

  const readOrders = async () => {
    try {
      const value = JSON.parse(await fs.readFile(ordersFile, "utf8"));
      if (!Array.isArray(value)) {
        throw new Error("The order store must contain a JSON array.");
      }
      return value.map(normalizeOrderLifecycle);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  };

  const writeOrders = async (orders) => {
    await fs.mkdir(path.dirname(ordersFile), {
      recursive: true,
      mode: 0o700,
    });
    const temporaryFile = `${ordersFile}.${process.pid}.${crypto
      .randomBytes(5)
      .toString("hex")}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(orders, null, 2), {
      mode: 0o600,
    });
    await fs.rename(temporaryFile, ordersFile);
    await fs.chmod(ordersFile, 0o600).catch(() => undefined);
  };

  const mutateOrders = (task) => {
    const mutation = mutationQueue
      .catch(() => undefined)
      .then(async () => {
        const orders = await readOrders();
        const result = await task(orders);
        await writeOrders(orders);
        return result;
      });
    mutationQueue = mutation;
    return mutation;
  };

  const createOrderRecord = (order) =>
    mutateOrders((orders) => {
      const normalized = normalizeOrderLifecycle(order);
      if (orders.some((entry) => entry.orderId === normalized.orderId)) {
        throw new HttpError(
          409,
          "DUPLICATE_ORDER_ID",
          "This order reference already exists.",
        );
      }
      if (
        normalized.idempotencyKey &&
        orders.some(
          (entry) => entry.idempotencyKey === normalized.idempotencyKey,
        )
      ) {
        throw new HttpError(
          409,
          "DUPLICATE_IDEMPOTENCY_KEY",
          "This checkout request has already been received.",
        );
      }
      orders.push(normalized);
      return normalized;
    });

  const findOrder = async (orderId) => {
    const orders = await readOrders();
    return orders.find((order) => order.orderId === orderId) || null;
  };

  const findOrderByIdempotencyKey = async (idempotencyKey) => {
    const orders = await readOrders();
    return (
      orders.find((order) => order.idempotencyKey === idempotencyKey) || null
    );
  };

  const findOrderByRazorpayOrderId = async (razorpayOrderId) => {
    const orders = await readOrders();
    return (
      orders.find((order) => order.razorpayOrderId === razorpayOrderId) || null
    );
  };

  const findOrderByRazorpayPaymentId = async (razorpayPaymentId) => {
    const orders = await readOrders();
    return (
      orders.find((order) => order.razorpayPaymentId === razorpayPaymentId) ||
      null
    );
  };

  const getOrders = async () => {
    const orders = await readOrders();
    return orders.sort(
      (first, second) =>
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime(),
    );
  };

  const mutateOrderRecord = (orderId, updater) =>
    mutateOrders((orders) => {
      const index = orders.findIndex((order) => order.orderId === orderId);
      if (index === -1) {
        throw new HttpError(404, "ORDER_NOT_FOUND", "Order record not found.");
      }
      const current = normalizeOrderLifecycle(orders[index]);
      const updated = normalizeOrderLifecycle(updater(current));
      orders[index] = updated;
      return updated;
    });

  const updateOrderRecord = (orderId, changes) =>
    mutateOrderRecord(orderId, (order) => ({
      ...order,
      ...changes,
      version: order.version + 1,
      updatedAt: new Date().toISOString(),
    }));

  return {
    createOrderRecord,
    findOrder,
    findOrderByIdempotencyKey,
    findOrderByRazorpayOrderId,
    findOrderByRazorpayPaymentId,
    getOrders,
    mutateOrderRecord,
    updateOrderRecord,
  };
};

const defaultStore = createOrderStore();

export const createOrderRecord = defaultStore.createOrderRecord;
export const findOrder = defaultStore.findOrder;
export const findOrderByIdempotencyKey =
  defaultStore.findOrderByIdempotencyKey;
export const findOrderByRazorpayOrderId =
  defaultStore.findOrderByRazorpayOrderId;
export const findOrderByRazorpayPaymentId =
  defaultStore.findOrderByRazorpayPaymentId;
export const getOrders = defaultStore.getOrders;
export const mutateOrderRecord = defaultStore.mutateOrderRecord;
export const updateOrderRecord = defaultStore.updateOrderRecord;
