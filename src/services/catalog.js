const catalogEndpoint = () => {
  const configured = import.meta.env.VITE_COMMERCE_API_URL?.replace(/\/$/, "");
  return `${configured || "/api"}/catalog`;
};

export const DEFAULT_STOREFRONT_SETTINGS = {
  shipping: {
    freeThreshold: 500,
    standardFee: 49,
  },
  support: {
    phone: "+91 98991 07642",
    whatsapp: "919899107642",
    email: "sales@kelenate.in",
    hours: "Mon–Sat · 10am–5pm",
  },
  returns: {
    windowDays: 7,
  },
};

const withDefaults = (settings = {}) => ({
  ...DEFAULT_STOREFRONT_SETTINGS,
  ...settings,
  shipping: {
    ...DEFAULT_STOREFRONT_SETTINGS.shipping,
    ...settings.shipping,
  },
  support: {
    ...DEFAULT_STOREFRONT_SETTINGS.support,
    ...settings.support,
  },
  returns: {
    ...DEFAULT_STOREFRONT_SETTINGS.returns,
    ...settings.returns,
  },
});

export async function loadCatalog() {
  const response = await fetch(catalogEndpoint(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Live catalog is unavailable.");
  const result = await response.json();
  if (!Array.isArray(result.products)) {
    throw new Error("Catalog response is invalid.");
  }
  return {
    products: result.products,
    settings: withDefaults(result.settings),
  };
}
