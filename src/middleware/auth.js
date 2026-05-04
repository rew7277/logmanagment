/**
 * API key authentication middleware for log ingestion endpoints.
 *
 * Set INGEST_API_KEY in Railway environment variables.
 * If the variable is not set the middleware is a no-op (safe for local dev,
 * but you should always set it in production).
 *
 * Clients must send:  Authorization: Bearer <key>
 *                 or: X-Api-Key: <key>
 */
export function requireApiKey(req, res, next) {
  const expectedKey = process.env.INGEST_API_KEY;
  if (!expectedKey) {
    // Not configured — allow all traffic (warn once so it shows in logs)
    if (!requireApiKey._warned) {
      console.warn('[auth] INGEST_API_KEY not set — ingest endpoints are unprotected. Set this variable in Railway.');
      requireApiKey._warned = true;
    }
    return next();
  }

  const authHeader = req.headers['authorization'] || '';
  const apiKeyHeader = req.headers['x-api-key'] || '';
  const provided = authHeader.replace(/^Bearer\s+/i, '') || apiKeyHeader;

  if (!provided || provided !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized. Provide a valid API key via Authorization: Bearer <key> or X-Api-Key header.' });
  }
  next();
}
requireApiKey._warned = false;
