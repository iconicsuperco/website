const API_ROOT = "/api/admin";

async function adminRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      credentials: "include",
      headers:
        options.body instanceof FormData
          ? options.headers
          : { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
  } catch {
    throw new Error(
      "The admin server is offline. Restart the project with npm run dev.",
    );
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      result.message ||
        (response.status >= 500
          ? "The admin server is offline. Restart the project with npm run dev."
          : "Admin request failed."),
    );
    error.status = response.status;
    throw error;
  }
  return result;
}

export const checkAdminSession = () => adminRequest("/session");

export const adminLogin = (password) =>
  adminRequest("/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });

export const adminLogout = () =>
  adminRequest("/logout", { method: "POST", body: "{}" });

export const getAdminDashboard = () => adminRequest("/dashboard");
export const getAdminOrders = () => adminRequest("/orders");
export const getAdminProducts = () => adminRequest("/products");
export const getAdminSettings = () => adminRequest("/settings");
export const saveAdminSettings = (settings) =>
  adminRequest("/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });

export const updateAdminOrder = (orderId, status) =>
  adminRequest(`/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

export const saveAdminProduct = (product, productId) =>
  adminRequest(
    productId
      ? `/products/${encodeURIComponent(productId)}`
      : "/products",
    {
      method: productId ? "PUT" : "POST",
      body: JSON.stringify(product),
    },
  );

export const archiveAdminProduct = (productId) =>
  adminRequest(`/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
  });

export const uploadAdminImage = (file) => {
  const form = new FormData();
  form.append("image", file);
  return adminRequest("/upload", { method: "POST", body: form });
};
