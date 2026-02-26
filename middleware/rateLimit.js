// Simple in-memory rate limiter — no external dependencies required.
// Tracks request counts per IP within a sliding window.
// Intended for auth endpoints to slow brute-force attempts.

/**
 * createRateLimit({ windowMs, max, message })
 *   windowMs — sliding window in milliseconds (default 15 min)
 *   max      — max requests per window per IP (default 20)
 *   message  — error message returned on 429 (optional)
 */
function createRateLimit({ windowMs = 15 * 60 * 1000, max = 20, message } = {}) {
  // ip -> { count, resetAt }
  const store = new Map();

  // Periodically sweep expired entries so the Map doesn't grow unbounded
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store) {
      if (entry.resetAt <= now) store.delete(ip);
    }
  }, windowMs);

  // Don't keep the process alive just for cleanup
  if (sweepInterval.unref) sweepInterval.unref();

  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = store.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(ip, entry);
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: message || `Too many requests. Try again in ${retryAfterSec} seconds.`,
      });
    }

    next();
  };
}

module.exports = { createRateLimit };
