const SHIPROCKET_API = "https://apiv2.shiprocket.in/v1/external";

const credentialsAvailable = () =>
  Boolean(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);

const shipmentMeasurements = (order) => {
  const unitWeight = Number(process.env.SHIPROCKET_DEFAULT_WEIGHT_KG);
  const length = Number(process.env.SHIPROCKET_DEFAULT_LENGTH_CM);
  const breadth = Number(process.env.SHIPROCKET_DEFAULT_BREADTH_CM);
  const height = Number(process.env.SHIPROCKET_DEFAULT_HEIGHT_CM);
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  if (![unitWeight, length, breadth, height].every((value) => value > 0)) {
    return null;
  }
  return { weight: unitWeight * quantity, length, breadth, height };
};

const authenticate = async () => {
  const response = await fetch(`${SHIPROCKET_API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }),
  });
  if (!response.ok) throw new Error("Shiprocket authentication failed.");
  const result = await response.json();
  return result.token;
};

const customerNames = (name) => {
  const parts = name.trim().split(/\s+/);
  return {
    first: parts.shift(),
    last: parts.join(" ") || "-",
  };
};

export const createShiprocketShipment = async (order) => {
  if (!credentialsAvailable()) {
    return { created: false, reason: "credentials_missing" };
  }
  const measurements = shipmentMeasurements(order);
  if (!measurements) {
    return { created: false, reason: "measurements_missing" };
  }

  try {
    const token = await authenticate();
    const names = customerNames(order.customer.name);
    const response = await fetch(`${SHIPROCKET_API}/orders/create/adhoc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order_id: order.orderId,
        order_date: order.createdAt.slice(0, 19).replace("T", " "),
        pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION,
        billing_customer_name: names.first,
        billing_last_name: names.last,
        billing_address: order.customer.address,
        billing_address_2: order.customer.area,
        billing_city: order.customer.city,
        billing_pincode: order.customer.pincode,
        billing_state: order.customer.state,
        billing_country: "India",
        billing_email: order.customer.email,
        billing_phone: order.customer.phone,
        shipping_is_billing: true,
        order_items: order.items.map((item) => ({
          name: item.name,
          sku: item.asin,
          units: item.quantity,
          selling_price: item.price,
        })),
        payment_method: order.paymentMethod === "cod" ? "COD" : "Prepaid",
        shipping_charges: order.shipping,
        sub_total: order.subtotal,
        ...measurements,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Shiprocket order error:", response.status, result);
      return { created: false, reason: "api_error", detail: result.message };
    }
    return {
      created: true,
      shiprocketOrderId: result.order_id,
      shipmentId: result.shipment_id,
      status: result.status,
    };
  } catch (error) {
    console.error("Shiprocket connection error:", error.message);
    return { created: false, reason: "connection_error", detail: error.message };
  }
};
