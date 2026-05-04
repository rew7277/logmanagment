/**
 * Lightweight in-memory rate limiter — no extra dependencies required.
 *
 * Uses a sliding-window counter per IP.  For multi-instance deployments
 * replace this with redis-backed rate limiting (e.g. rate-limiter-flexible).
 */

const windows = new Map(); // ip → { count, resetAt }

/**
 * @param {number} maxRequests  Allowed requests per window
 * @param {number} windowMs     Window duration in milliseconds
 */
export function rateLimit({ maxRequests = 60, windowMs = 60_000 } = {}) {
  // Purge stale entries every 5 minutes to avoid memory leak
  setInterval(() => {
    const now = Date.now();
    for (const [key, win] of windows) {
      if (win.resetAt < now) windows.delete(key);
    }
  }, 300_000).unref();

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const win = windows.get(ip);

    if (!win || win.resetAt < now) {
      windows.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    win.count += 1;
    if (win.count > maxRequests) {
      const retryAfter = Math.ceil((win.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests. Please slow down.',
        retry_after_seconds: retryAfter
      });
    }

    next();
  };
}
