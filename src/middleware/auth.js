/**
 * Ingestion authentication.
 *
 * SaaS recommendation:
 * - For production API/customer integrations set INGEST_AUTH_MODE=strict and INGEST_API_KEY.
 * - For early UI testing/demo leave INGEST_AUTH_MODE=optional so browser uploads work without a key.
 */
export function requireApiKey(req, res, next) {
  const expectedKey = process.env.INGEST_API_KEY;
  const mode = String(process.env.INGEST_AUTH_MODE || 'optional').toLowerCase();

  if (!expectedKey || mode !== 'strict') {
    if (!requireApiKey._warned) {
      console.warn('[auth] ingest auth is optional. Set INGEST_AUTH_MODE=strict and INGEST_API_KEY to protect ingestion APIs.');
      requireApiKey._warned = true;
    }
    return next();
  }

  const authHeader = req.headers['authorization'] || '';
  const apiKeyHeader = req.headers['x-api-key'] || '';
  const provided = authHeader.replace(/^Bearer\s+/i, '') || apiKeyHeader;

  if (!provided || provided !== expectedKey) {
    return res.status(401).json({
      error: 'Upload is protected. Enter the valid ingest API key in Upload Settings, or set INGEST_AUTH_MODE=optional for UI testing.'
    });
  }
  next();
}
requireApiKey._warned = false;
