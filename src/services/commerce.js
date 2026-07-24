const configuredApiUrl =
  import.meta.env.VITE_COMMERCE_API_URL?.replace(/\/$/, "");
const API_URL = configuredApiUrl || "/api";
const CHECKOUT_ATTEMPTS_KEY = "kelenate-checkout-attempts-v1";
const MAX_CHECKOUT_ATTEMPTS = 12;

export const commercePreview = import.meta.env.DEV && !configuredApiUrl;
export const commerceConfigured = !commercePreview;

let inMemoryAttempts = [];

const canonicalCheckoutRequest = ({ customer, items, paymentMethod }) => {
  const canonicalCustomer = Object.fromEntries(
    Object.entries(customer || {})
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([field, value]) => [field, String(value || "").trim()]),
  );
  const quantities = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const id = String(item?.id || "").trim();
    if (!id) return;
    quantities.set(id, (quantities.get(id) || 0) + Number(item.quantity || 0));
  });
  const canonicalItems = [...quantities]
    .map(([id, quantity]) => ({ id, quantity }))
    .sort((first, second) => first.id.localeCompare(second.id));

  return JSON.stringify({
    customer: canonicalCustomer,
    items: canonicalItems,
    paymentMethod: String(paymentMethod || ""),
  });
};

const fallbackFingerprint = (value) => {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charCodeAt(index);
    first = Math.imul(first ^ character, 16777619);
    second = Math.imul(second ^ character, 3266489917);
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
};

const checkoutFingerprint = async (request) => {
  const canonical = canonicalCheckoutRequest(request);
  if (!globalThis.crypto?.subtle) return fallbackFingerprint(canonical);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const readCheckoutAttempts = () => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(CHECKOUT_ATTEMPTS_KEY));
    if (Array.isArray(stored)) {
      inMemoryAttempts = stored.filter(
        (attempt) =>
          typeof attempt?.fingerprint === "string" &&
          typeof attempt?.key === "string",
      );
    }
  } catch {
    // In-memory attempts still keep retries stable if storage is unavailable.
  }
  return inMemoryAttempts;
};

const writeCheckoutAttempts = (attempts) => {
  inMemoryAttempts = attempts
    .sort(
      (first, second) =>
        Number(first.createdAt || 0) - Number(second.createdAt || 0),
    )
    .slice(-MAX_CHECKOUT_ATTEMPTS);
  try {
    sessionStorage.setItem(
      CHECKOUT_ATTEMPTS_KEY,
      JSON.stringify(inMemoryAttempts),
    );
  } catch {
    // Checkout remains usable when browser storage is unavailable.
  }
};

const createIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) {
    return `checkout:${globalThis.crypto.randomUUID()}`;
  }
  const randomValues = new Uint32Array(4);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(randomValues);
  } else {
    randomValues.set(
      [...randomValues].map(() => Math.floor(Math.random() * 2 ** 32)),
    );
  }
  return `checkout:${Date.now().toString(36)}:${[...randomValues]
    .map((value) => value.toString(36))
    .join("")}`;
};

const checkoutAttemptFor = async (request) => {
  const fingerprint = await checkoutFingerprint(request);
  const attempts = readCheckoutAttempts();
  const existing = attempts.find(
    (attempt) => attempt.fingerprint === fingerprint,
  );
  if (existing) return existing;

  const attempt = {
    fingerprint,
    key: createIdempotencyKey(),
    createdAt: Date.now(),
  };
  writeCheckoutAttempts([...attempts, attempt]);
  return attempt;
};

const clearCheckoutAttempt = (completedAttempt) => {
  writeCheckoutAttempts(
    readCheckoutAttempts().filter(
      (attempt) =>
        attempt.fingerprint !== completedAttempt.fingerprint ||
        attempt.key !== completedAttempt.key,
    ),
  );
};

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve(true);
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = reject;
    document.body.appendChild(script);
  });

export async function submitCheckout({ customer, items, totals, paymentMethod }) {
  if (!commerceConfigured) {
    if (!commercePreview) {
      throw new Error(
        "Checkout is not configured for this storefront. Please contact support.",
      );
    }
    return {
      preview: true,
      terminal: true,
      orderId: `KEL-DEMO-${Date.now().toString().slice(-6)}`,
      message:
        "Preview order created locally. Add the commerce API URL and server credentials to accept live orders.",
    };
  }

  const checkoutRequest = { customer, items, paymentMethod };
  const attempt = await checkoutAttemptFor(checkoutRequest);
  const response = await fetch(`${API_URL}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": attempt.key,
    },
    body: JSON.stringify({ customer, items, totals, paymentMethod }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    if (
      ["IDEMPOTENCY_CONFLICT", "ORDER_CANCELLED", "ORDER_REFUND_PENDING"].includes(
        detail.code,
      )
    ) {
      clearCheckoutAttempt(attempt);
    }
    const error = new Error(
      detail.message || "We could not start checkout. Please try again.",
    );
    error.code = detail.code;
    throw error;
  }

  const order = await response.json();

  if (paymentMethod === "cod") {
    clearCheckoutAttempt(attempt);
    return { ...order, pending: false, terminal: true };
  }
  if (order.paymentConfirmed) {
    clearCheckoutAttempt(attempt);
    return order;
  }

  await loadScript("https://checkout.razorpay.com/v1/checkout.js");

  return new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error("Razorpay could not be loaded."));
      return;
    }

    const razorpay = new window.Razorpay({
      key: order.razorpayKeyId,
      amount: order.amount,
      currency: "INR",
      name: "Kelenate",
      description: `Order ${order.orderId}`,
      order_id: order.razorpayOrderId,
      prefill: {
        name: customer.name,
        email: customer.email,
        contact: customer.phone,
      },
      theme: { color: "#071842" },
      handler: async (payment) => {
        try {
          const verification = await fetch(`${API_URL}/checkout/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId: order.orderId,
              ...payment,
            }),
          });

          if (!verification.ok) {
            const detail = await verification.json().catch(() => ({}));
            throw new Error(detail.message || "Payment verification failed.");
          }

          const result = await verification.json();
          const pending =
            verification.status === 202 ||
            result.status === "payment_processing";
          if (!pending) clearCheckoutAttempt(attempt);
          resolve({ ...result, pending, terminal: !pending });
        } catch (error) {
          reject(error);
        }
      },
      modal: {
        ondismiss: () => reject(new Error("Payment was cancelled.")),
      },
    });

    razorpay.open();
  });
}
