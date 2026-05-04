import express from 'express';
import {
  bulkCreateLogs,
  createLog,
  getAlerts,
  getEndpoints,
  getLogs,
  getOps,
  getOverview,
  getServices,
  getTraces,
  getWorkspaces,
  rca
} from '../services/repository.js';

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function normalizeEnvironment(req) {
  return String(req.params.environment || req.query.environment || 'PROD').toUpperCase();
}

function normalizeWorkspace(req) {
  return String(req.params.workspace || req.query.workspace || 'fsbl-prod-ops');
}

function parseLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return {
      timestamp: parsed.timestamp || parsed.time || parsed['@timestamp'],
      severity: String(parsed.severity || parsed.level || 'INFO').toUpperCase(),
      trace_id: parsed.trace_id || parsed.traceId || parsed.correlationId || parsed.correlation_id,
      service_name: parsed.service_name || parsed.service || parsed.app || parsed.application,
      method: parsed.method,
      path: parsed.path || parsed.endpoint || parsed.uri,
      message: parsed.message || parsed.msg || trimmed,
      raw: parsed
    };
  } catch {
    const severity = trimmed.includes('ERROR') ? 'ERROR' : trimmed.includes('WARN') ? 'WARN' : 'INFO';
    const traceMatch = trimmed.match(/\b(?:TR|trace)[-_A-Za-z0-9]*\b/i);
    return {
      severity,
      trace_id: traceMatch ? traceMatch[0] : null,
      service_name: null,
      message: trimmed,
      raw: { line: trimmed }
    };
  }
}

router.get('/workspaces', asyncHandler(async (_req, res) => {
  res.json({ data: await getWorkspaces() });
}));

router.get('/:workspace/:environment/overview', asyncHandler(async (req, res) => {
  const data = await getOverview(normalizeWorkspace(req), normalizeEnvironment(req));
  if (!data) return res.status(404).json({ error: 'Environment not found' });
  res.json({ data });
}));

router.get('/:workspace/:environment/services', asyncHandler(async (req, res) => {
  res.json({ data: await getServices(normalizeWorkspace(req), normalizeEnvironment(req)) });
}));

router.get('/:workspace/:environment/endpoints', asyncHandler(async (req, res) => {
  res.json({ data: await getEndpoints(normalizeWorkspace(req), normalizeEnvironment(req)) });
}));

router.get('/:workspace/:environment/logs', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  res.json({ data: await getLogs(normalizeWorkspace(req), normalizeEnvironment(req), limit) });
}));

router.post('/:workspace/:environment/logs', asyncHandler(async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];
  const data = await bulkCreateLogs(normalizeWorkspace(req), normalizeEnvironment(req), payload);
  res.status(201).json({ inserted: data.length, data });
}));

router.post('/:workspace/:environment/logs/upload', express.text({ type: '*/*', limit: '10mb' }), asyncHandler(async (req, res) => {
  const lines = String(req.body || '').split(/\r?\n/).map(parseLogLine).filter(Boolean);
  const data = await bulkCreateLogs(normalizeWorkspace(req), normalizeEnvironment(req), lines);
  res.status(201).json({ inserted: data.length });
}));

router.get('/:workspace/:environment/traces', asyncHandler(async (req, res) => {
  res.json({ data: await getTraces(normalizeWorkspace(req), normalizeEnvironment(req)) });
}));

router.get('/:workspace/:environment/alerts', asyncHandler(async (req, res) => {
  res.json({ data: await getAlerts(normalizeWorkspace(req), normalizeEnvironment(req)) });
}));

router.get('/:workspace/:environment/ops', asyncHandler(async (req, res) => {
  res.json({ data: await getOps(normalizeWorkspace(req), normalizeEnvironment(req)) });
}));

router.post('/:workspace/:environment/rca', asyncHandler(async (req, res) => {
  res.json({ data: await rca(normalizeWorkspace(req), normalizeEnvironment(req), req.body?.query || '') });
}));

export default router;
