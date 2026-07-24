const pincodeEndpoint = (pincode) => {
  const configured = import.meta.env.VITE_COMMERCE_API_URL?.replace(/\/$/, "");
  return `${configured || "/api"}/pincode/${encodeURIComponent(pincode)}`;
};

export async function lookupPincode(pincode, { signal } = {}) {
  const response = await fetch(pincodeEndpoint(pincode), {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      payload.message || "PIN lookup could not be completed.",
    );
    error.code = response.status === 404 ? "PINCODE_NOT_FOUND" : "LOOKUP_FAILED";
    throw error;
  }

  return payload;
}
