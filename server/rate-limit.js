const stores = new Map();

const sweepExpired = (store, now) => {
  if (store.size < 500) return;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
};

export const createRateLimiter = ({
  name,
  windowMs,
  max,
  keyGenerator = (request) =>
    request.ip || request.socket?.remoteAddress || "unknown",
}) => {
  if (!stores.has(name)) stores.set(name, new Map());
  const store = stores.get(name);

  return (request, response, next) => {
    const now = Date.now();
    sweepExpired(store, now);
    const key = String(keyGenerator(request));
    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
    }
    entry.count += 1;
    store.set(key, entry);

    const remaining = Math.max(0, max - entry.count);
    response.header("RateLimit-Limit", String(max));
    response.header("RateLimit-Remaining", String(remaining));
    response.header(
      "RateLimit-Reset",
      String(Math.ceil(entry.resetAt / 1000)),
    );

    if (entry.count > max) {
      const retryAfter = Math.max(
        1,
        Math.ceil((entry.resetAt - now) / 1000),
      );
      response.header("Retry-After", String(retryAfter));
      response.status(429).json({
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait a moment and try again.",
      });
      return;
    }
    next();
  };
};

export const resetRateLimitStores = () => {
  stores.forEach((store) => store.clear());
};
