const API_URL = import.meta.env.VITE_COMMERCE_API_URL?.replace(/\/$/, "");

export const commerceConfigured = Boolean(API_URL);

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
    return {
      preview: true,
      orderId: `KEL-DEMO-${Date.now().toString().slice(-6)}`,
      message:
        "Preview order created locally. Add the commerce API URL and server credentials to accept live orders.",
    };
  }

  const response = await fetch(`${API_URL}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer, items, totals, paymentMethod }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      detail.message || "We could not start checkout. Please try again.",
    );
  }

  const order = await response.json();

  if (paymentMethod === "cod") {
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

          resolve(await verification.json());
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
