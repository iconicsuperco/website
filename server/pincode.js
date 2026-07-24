const lookupCache = new Map();
const LOOKUP_TIMEOUT_MS = 4500;
const SUCCESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND_CACHE_TTL_MS = 60 * 60 * 1000;

const cachedLookup = (pincode) => {
  const cached = lookupCache.get(pincode);
  const cacheTtl =
    cached?.value === null ? NOT_FOUND_CACHE_TTL_MS : SUCCESS_CACHE_TTL_MS;
  if (!cached || Date.now() - cached.savedAt > cacheTtl) {
    lookupCache.delete(pincode);
    return undefined;
  }
  return cached.value;
};

export async function lookupIndianPincode(pincode) {
  const normalized = String(pincode || "").trim();
  if (!/^[1-9]\d{5}$/.test(normalized)) {
    const error = new Error("Enter a valid 6-digit Indian PIN code.");
    error.code = "INVALID_PINCODE";
    throw error;
  }

  const cached = cachedLookup(normalized);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(
      `https://api.postalpincode.in/pincode/${normalized}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`Postal lookup returned ${response.status}.`);
    }

    const payload = await response.json();
    const result = Array.isArray(payload) ? payload[0] : null;
    const offices = Array.isArray(result?.PostOffice)
      ? result.PostOffice
      : [];

    if (result?.Status !== "Success" || offices.length === 0) {
      lookupCache.set(normalized, { value: null, savedAt: Date.now() });
      return null;
    }

    const office =
      offices.find((entry) => entry.DeliveryStatus === "Delivery") ||
      offices[0];
    const value = {
      pincode: normalized,
      city: String(office.District || office.Block || office.Name || "").trim(),
      district: String(office.District || "").trim(),
      state: String(office.State || "").trim(),
      area: String(office.Name || "").trim(),
      deliveryPostOffices: offices.filter(
        (entry) => entry.DeliveryStatus === "Delivery",
      ).length,
    };
    lookupCache.set(normalized, { value, savedAt: Date.now() });
    return value;
  } catch (error) {
    if (error.code === "INVALID_PINCODE") throw error;
    const unavailable = new Error(
      "PIN lookup is temporarily unavailable. Enter city and state manually.",
    );
    unavailable.code = "PINCODE_LOOKUP_UNAVAILABLE";
    throw unavailable;
  }
}
