import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(currentDirectory, "data");
const settingsFile = path.join(dataDirectory, "settings.json");

export const DEFAULT_STORE_SETTINGS = {
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

const mergeDefaults = (settings = {}) => ({
  ...DEFAULT_STORE_SETTINGS,
  ...settings,
  shipping: {
    ...DEFAULT_STORE_SETTINGS.shipping,
    ...settings.shipping,
  },
  support: {
    ...DEFAULT_STORE_SETTINGS.support,
    ...settings.support,
  },
  returns: {
    ...DEFAULT_STORE_SETTINGS.returns,
    ...settings.returns,
  },
});

const wholeNumber = (value, label, minimum, maximum) => {
  const number = Number(value);
  if (
    !Number.isInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw new Error(
      `${label} must be a whole number between ${minimum} and ${maximum}.`,
    );
  }
  return number;
};

const requiredText = (value, label, maximumLength = 100) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximumLength) {
    throw new Error(`${label} is too long.`);
  }
  return normalized;
};

const normalizeSettings = (input, current) => {
  const combined = mergeDefaults({
    ...current,
    ...input,
    shipping: { ...current.shipping, ...input.shipping },
    support: { ...current.support, ...input.support },
    returns: { ...current.returns, ...input.returns },
  });
  const email = requiredText(combined.support.email, "Support email", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid support email.");
  }
  const phone = requiredText(combined.support.phone, "Support phone", 25);
  if (phone.replace(/\D/g, "").length < 10) {
    throw new Error("Enter a valid support phone number.");
  }
  const whatsapp = requiredText(
    combined.support.whatsapp,
    "WhatsApp number",
    20,
  ).replace(/\D/g, "");
  if (whatsapp.length < 10 || whatsapp.length > 15) {
    throw new Error("WhatsApp number must contain 10 to 15 digits.");
  }

  return {
    shipping: {
      freeThreshold: wholeNumber(
        combined.shipping.freeThreshold,
        "Free-shipping threshold",
        0,
        100000,
      ),
      standardFee: wholeNumber(
        combined.shipping.standardFee,
        "Standard shipping charge",
        0,
        10000,
      ),
    },
    support: {
      phone,
      whatsapp,
      email,
      hours: requiredText(combined.support.hours, "Support hours", 80),
    },
    returns: {
      windowDays: wholeNumber(
        combined.returns.windowDays,
        "Return window",
        1,
        30,
      ),
    },
    updatedAt: new Date().toISOString(),
  };
};

const readSettings = async () => {
  try {
    return mergeDefaults(
      JSON.parse(await fs.readFile(settingsFile, "utf8")),
    );
  } catch (error) {
    if (error.code === "ENOENT") return mergeDefaults();
    throw error;
  }
};

const writeSettings = async (settings) => {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${settingsFile}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(settings, null, 2));
  await fs.rename(temporaryFile, settingsFile);
};

export const getStoreSettings = readSettings;

export const updateStoreSettings = async (input = {}) => {
  const current = await readSettings();
  const settings = normalizeSettings(input, current);
  await writeSettings(settings);
  return settings;
};

export const publicStoreSettings = (settings) => ({
  shipping: settings.shipping,
  support: settings.support,
  returns: settings.returns,
});
