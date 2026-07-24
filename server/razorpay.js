import crypto from "node:crypto";
import { HttpError } from "./http-error.js";

const DEFAULT_API_URL = "https://api.razorpay.com/v1";
const PROVIDER_TIMEOUT_MS = 6500;

const credentials = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new HttpError(
      503,
      "RAZORPAY_NOT_CONFIGURED",
      "Online payments are temporarily unavailable.",
      { expose: true },
    );
  }
  return { keyId, keySecret };
};

const apiUrl = (path) =>
  `${String(process.env.RAZORPAY_API_URL || DEFAULT_API_URL).replace(
    /\/$/,
    "",
  )}${path}`;

const authorizationHeader = () => {
  const { keyId, keySecret } = credentials();
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
};

const providerRequest = async (path, options = {}) => {
  let response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      headers: {
        Authorization: authorizationHeader(),
        Accept: "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    throw new HttpError(
      503,
      "RAZORPAY_UNAVAILABLE",
      "The payment provider could not be reached. Please try again.",
      { cause: error, expose: true },
    );
  }

  const text = await response.text();
  const payload = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text };
        }
      })()
    : {};
  return { response, payload };
};

const expectedAmount = (total) => {
  const amount = Math.round(Number(total) * 100);
  if (!Number.isSafeInteger(amount) || amount < 100) {
    throw new HttpError(
      500,
      "INVALID_ORDER_AMOUNT",
      "The order total could not be prepared for payment.",
    );
  }
  return amount;
};

const matchingProviderOrder = (order, { receipt, amount }) =>
  order?.receipt === receipt &&
  Number(order.amount) === amount &&
  order.currency === "INR" &&
  typeof order.id === "string";

const fetchOrderByReceipt = async ({ receipt, amount }) => {
  const { response, payload } = await providerRequest(
    `/orders?receipt=${encodeURIComponent(receipt)}&count=10`,
  );
  if (!response.ok) return null;
  const orders = Array.isArray(payload.items) ? payload.items : [];
  return (
    orders.find((order) => matchingProviderOrder(order, { receipt, amount })) ||
    null
  );
};

export const createRazorpayOrder = async ({ orderId, total }) => {
  const amount = expectedAmount(total);
  const requestBody = {
    amount,
    currency: "INR",
    receipt: orderId,
    notes: { storefront: "kelenate.in", internal_order_id: orderId },
  };

  let result;
  try {
    result = await providerRequest("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    if (error.code !== "RAZORPAY_UNAVAILABLE") throw error;
    const reconciled = await fetchOrderByReceipt({
      receipt: orderId,
      amount,
    }).catch(() => null);
    if (reconciled) return reconciled;
    throw error;
  }

  if (result.response.ok) {
    if (!matchingProviderOrder(result.payload, { receipt: orderId, amount })) {
      throw new HttpError(
        502,
        "INVALID_RAZORPAY_ORDER",
        "The payment provider returned an invalid order.",
      );
    }
    return result.payload;
  }

  const detail = JSON.stringify(result.payload).toLowerCase();
  const ambiguous =
    result.response.status >= 500 ||
    (result.response.status === 400 &&
      (detail.includes("receipt") || detail.includes("already")));
  if (ambiguous) {
    const reconciled = await fetchOrderByReceipt({
      receipt: orderId,
      amount,
    }).catch(() => null);
    if (reconciled) return reconciled;
  }

  const status = result.response.status >= 500 ? 503 : 502;
  throw new HttpError(
    status,
    "RAZORPAY_ORDER_FAILED",
    "The payment provider could not start this order.",
    { expose: true },
  );
};

export const fetchRazorpayPayment = async (paymentId) => {
  if (!/^pay_[A-Za-z0-9]+$/.test(String(paymentId || ""))) {
    throw new HttpError(
      400,
      "INVALID_PAYMENT_ID",
      "The payment reference is invalid.",
    );
  }
  const { response, payload } = await providerRequest(
    `/payments/${encodeURIComponent(paymentId)}`,
  );
  if (!response.ok) {
    throw new HttpError(
      response.status >= 500 ? 503 : 400,
      "PAYMENT_LOOKUP_FAILED",
      "The payment could not be confirmed with Razorpay.",
      { expose: true },
    );
  }
  return payload;
};

const safeDigestEqual = (supplied, expected) => {
  const suppliedText = String(supplied || "");
  if (!/^[a-f0-9]{64}$/i.test(suppliedText)) return false;
  const first = Buffer.from(suppliedText.toLowerCase(), "hex");
  const second = Buffer.from(expected.toLowerCase(), "hex");
  return first.length === second.length && crypto.timingSafeEqual(first, second);
};

export const verifyCheckoutSignature = ({
  razorpayOrderId,
  razorpayPaymentId,
  signature,
}) => {
  const { keySecret } = credentials();
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  return safeDigestEqual(signature, expected);
};

export const verifyWebhookSignature = ({ rawBody, signature }) => {
  const secrets = [
    process.env.RAZORPAY_WEBHOOK_SECRET,
    process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS,
  ].filter(Boolean);
  if (!secrets.length) {
    throw new HttpError(
      503,
      "WEBHOOK_NOT_CONFIGURED",
      "The payment webhook is not configured.",
    );
  }
  return secrets.some((secret) => {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    return safeDigestEqual(signature, expected);
  });
};

export const razorpayPublicKey = () => credentials().keyId;
