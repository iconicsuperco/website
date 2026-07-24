import crypto from "node:crypto";

const COOKIE_NAME = "kelenate_admin";
const SESSION_DURATION_SECONDS = 60 * 60 * 8;

const signingSecret = () =>
  process.env.ADMIN_SESSION_SECRET ||
  process.env.ADMIN_PASSWORD ||
  (process.env.NODE_ENV !== "production"
    ? "kelenate-admin-development-session"
    : null);

const configuredPassword = () => {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (process.env.NODE_ENV !== "production") return "kelenate-admin";
  return null;
};

const safeEqual = (left, right) => {
  const first = Buffer.from(String(left || ""));
  const second = Buffer.from(String(right || ""));
  return (
    first.length === second.length && crypto.timingSafeEqual(first, second)
  );
};

const parseCookies = (header = "") =>
  Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key]) => key)
      .map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]),
  );

const createToken = () => {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
      nonce: crypto.randomBytes(12).toString("hex"),
    }),
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", signingSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
};

const verifyToken = (token) => {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature || !signingSecret()) return false;
    const expected = crypto
      .createHmac("sha256", signingSecret())
      .update(payload)
      .digest("base64url");
    if (!safeEqual(signature, expected)) return false;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    return Number(decoded.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
};

const cookieOptions = (maxAge = SESSION_DURATION_SECONDS) => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=TOKEN; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
};

export const loginAdmin = (request, response) => {
  const password = configuredPassword();
  if (!password) {
    response.status(503).json({
      message: "Set ADMIN_PASSWORD before using the admin panel.",
    });
    return;
  }
  if (!safeEqual(request.body.password, password)) {
    response.status(401).json({ message: "Incorrect admin password." });
    return;
  }
  const token = createToken();
  response.header("Set-Cookie", cookieOptions().replace("TOKEN", token));
  response.json({ authenticated: true, name: "Store administrator" });
};

export const logoutAdmin = (_request, response) => {
  response.header("Set-Cookie", cookieOptions(0).replace("TOKEN", ""));
  response.json({ authenticated: false });
};

export const requireAdmin = (request, response, next) => {
  const cookies = parseCookies(request.headers.cookie);
  if (!verifyToken(cookies[COOKIE_NAME])) {
    response.status(401).json({ message: "Admin sign-in required." });
    return;
  }
  next();
};

export const adminSession = (request, response) => {
  const cookies = parseCookies(request.headers.cookie);
  response.json({
    authenticated: verifyToken(cookies[COOKIE_NAME]),
    name: "Store administrator",
  });
};
