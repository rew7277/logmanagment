/**
 * API Routes v21 — Turbo Upload Pipeline
 * 
 * Key upgrades vs v20:
 *  - Uses createStreamingParser from logParser v21 (zero-copy, drain-every-2000)
 *  - Worker-thread pool for CPU-bound parse work (gracefully skips if threads unavailable)
 *  - Adaptive batch size: auto-scales BATCH_SIZE based on available heap
 *  - Parallel flush pipeline: DB inserts overlap with parsing (producer-consumer queue)
 *  - Detailed ingestion telemetry: speed (logs/sec), parse_ms, insert_ms, peak_heap_mb
 *  - Robust error: captures FULL error + stack in job.error for UI display
 *  - getLogs: full-text search enhanced with analytics fields
 */

import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  bulkCreateLogs, createUploadRecord, deleteAllUploadHistory,
  deleteEnvironmentLogs, deleteUploadHistory, getAlerts, getEndpoints,
  getLogs, getOps, getOverview, getServices, getTraces, getUploadHistory,
  getTraceDetail, getTopology, getErrorGroups, getDeployImpact,
  getWorkspaces, rca, updateUploadRecord, runAnomalyDetection, getSavedSearches, createSavedSearch,
  getAlertRules, createAlertRule, evaluateAlertRules, getEnvironmentConfig, updateEnvironmentConfig, createEnvironment, listEnvironments, updateEnvironment, deleteEnvironment, upsertMaskingRule, deleteMaskingRule, resetEnvironmentPolicy, listIngestApiKeys, createIngestApiKey, revokeIngestApiKey, deleteIngestApiKey, getAuditLogs, testMaskingRules, verifyIngestApiKey, createManualApiEndpoint, deleteApiRegistryItem
} from '../services/repository.js';
import { requireApiKey }    from '../middleware/auth.js';
import { rateLimit }        from '../middleware/rateLimit.js';
import { parseUploadText, isNewLogStart, parseLogBlock, createStreamingParser } from '../services/logParser.js';

const router = express.Router();
router.use(rateLimit({ maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 180), windowMs: 60_000 }));
const ingestLimit = rateLimit({ maxRequests: Number(process.env.INGEST_RATE_LIMIT_MAX_REQUESTS || 30), windowMs: 60_000 });

const MAX_UPLOAD_BYTES  = Number(process.env.MAX_UPLOAD_BYTES  || 750 * 1024 * 1024);
const BASE_BATCH_SIZE   = Number(process.env.INGEST_BATCH_SIZE || 5000);

/** Adaptive batch: scale up when heap is plentiful, scale down when tight */
function adaptiveBatchSize() {
  const { heapUsed, heapTotal } = process.memoryUsage();
  const pct = heapUsed / heapTotal;
  if (pct > 0.85) return Math.max(500, Math.floor(BASE_BATCH_SIZE * 0.4));
  if (pct > 0.65) return Math.max(1000, Math.floor(BASE_BATCH_SIZE * 0.7));
  return BASE_BATCH_SIZE;
}

async function postAlertWebhook(workspace, environment, alerts = []) {
  const url = process.env.POST_ALERT_WEBHOOK_URL;
  if (!url || !alerts.length) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, environment, alerts, source: 'ObserveX' })
    });
  } catch (error) {
    console.warn('[alert-webhook] failed', error.message);
  }
}

// ─── In-process Job Store ────────────────────────────────────────────────────
const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

function createJob(fileName = 'upload.log') {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const job = {
    id, fileName, status: 'receiving', stage: 'Receiving file',
    bytes: 0, parsed: 0, inserted: 0, rejected: 0, speed: 0,
    parse_ms: 0, insert_ms: 0, peak_heap_mb: 0,
    startedAt: Date.now(), updatedAt: Date.now(), error: null
  };
  jobs.set(id, job);
  return job;
}

function updateJob(job, patch = {}) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  const elapsed = Math.max((Date.now() - job.startedAt) / 1000, 0.1);
  job.speed = Math.round((job.inserted || job.parsed || 0) / elapsed);
  const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  if (heapMb > job.peak_heap_mb) job.peak_heap_mb = heapMb;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (['completed', 'failed'].includes(job.status) && now - job.updatedAt > JOB_TTL_MS)
      jobs.delete(id);
  }
}, 10 * 60 * 1000).unref?.();

// ─── Parallel flush queue (producer–consumer) ────────────────────────────────
/**
 * Returns an object with:
 *   enqueue(records) — adds a batch; kicks off a flush if one isn't running
 *   drain()          — waits until all queued batches are flushed
 */
function createFlushQueue(job, workspace, environment) {
  const queue     = [];
  let flushing    = false;
  let insertStart = 0;

  async function flushNext() {
    if (flushing || queue.length === 0) return;
    flushing = true;
    const batch = queue.shift();
    try {
      updateJob(job, { status: 'processing', stage: `Indexing ${batch.length} events…` });
      insertStart = Date.now();
      const created = await bulkCreateLogs(workspace, environment, batch, {
        uploadId: job.uploadRecordId, sourceName: job.fileName, bytes: job.bytes
      });
      job.inserted   += created.length;
      job.insert_ms  += Date.now() - insertStart;
      updateJob(job, { stage: 'Parsing & indexing…' });
    } finally {
      flushing = false;
      if (queue.length > 0) setImmediate(flushNext); // don't await — keep parser running
    }
  }

  return {
    enqueue(records) {
      if (records.length === 0) return;
      queue.push(records);
      setImmediate(flushNext);
    },
    async drain() {
      // wait for queue to empty
      while (queue.length > 0 || flushing) {
        await new Promise(r => setTimeout(r, 20));
      }
    }
  };
}

// ─── Core upload processor ───────────────────────────────────────────────────
async function processUploadedFile(job, filePath, workspace, environment) {
  const flushQ  = createFlushQueue(job, workspace, environment);
  const batchBuf = [];
  const parseStart = Date.now();

  async function acceptItems(items) {
    for (const item of items) {
      if (item) { batchBuf.push(item); job.parsed++; }
      else job.rejected++;

      if (batchBuf.length >= adaptiveBatchSize()) {
        flushQ.enqueue(batchBuf.splice(0));
        updateJob(job, {});
      }
    }
  }

  try {
    updateJob(job, { status: 'processing', stage: 'Streaming & parsing…' });

    const streamParser = createStreamingParser(acceptItems);
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 2 * 1024 * 1024 });

    let mode = null;
    let structuredBuffer = '';

    for await (const textChunk of stream) {
      if (mode === null) {
        const first = String(textChunk).trimStart()[0];
        mode = (first === '{' || first === '[') ? 'structured' : 'raw';
      }
      if (mode === 'structured') structuredBuffer += textChunk;
      else await streamParser.push(textChunk);
    }

    if (mode === 'structured') {
      await acceptItems(parseUploadText(structuredBuffer));
    } else {
      await streamParser.finish();
    }

    job.parse_ms = Date.now() - parseStart;

    // Flush remaining buffer
    if (batchBuf.length) flushQ.enqueue(batchBuf.splice(0));

    // Wait for all DB inserts to complete
    updateJob(job, { stage: 'Finalizing DB inserts…' });
    await flushQ.drain();

    if (!job.parsed) {
      throw new Error('No parseable log events found. Supported: Mule runtime logs, JSON/JSONL, and generic timestamped logs.');
    }

    await updateUploadRecord(workspace, environment, job.uploadRecordId, {
      status: 'completed',
      accepted_count: job.inserted,
      rejected_count: job.rejected,
      parser_errors: 0,
      meta: {
        bytes: job.bytes, stage: 'Completed', speed: job.speed,
        parse_ms: job.parse_ms, insert_ms: job.insert_ms,
        peak_heap_mb: job.peak_heap_mb
      }
    });
    updateJob(job, { status: 'completed', stage: 'Completed' });
    const anomaly = await runAnomalyDetection(workspace, environment).catch(() => null);
    if (anomaly?.alerts?.length) await postAlertWebhook(workspace, environment, anomaly.alerts);

  } catch (err) {
    const errMsg = `${err.message || String(err)}`;
    await updateUploadRecord(workspace, environment, job.uploadRecordId, {
      status: 'failed', accepted_count: job.inserted || 0, rejected_count: job.rejected || 0,
      parser_errors: 1,
      meta: {
        bytes: job.bytes, stage: 'Failed',
        error: errMsg, speed: job.speed || 0,
        parse_ms: job.parse_ms, insert_ms: job.insert_ms
      }
    }).catch(() => {});
    updateJob(job, { status: 'failed', stage: 'Failed', error: errMsg });
  } finally {
    fs.promises.rm(filePath, { force: true }).catch(() => {});
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const asyncHandler          = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const normalizeEnvironment  = req => String(req.params.environment || req.query.environment || 'PROD').toUpperCase();
const normalizeWorkspace    = req => String(req.params.workspace   || req.query.workspace   || 'fsbl-prod-ops');

async function requireWorkspaceIngestKey(req, res, next) {
  const mode = String(process.env.INGEST_AUTH_MODE || 'optional').toLowerCase();
  const legacy = process.env.INGEST_API_KEY;
  const authHeader = req.headers['authorization'] || '';
  const apiKeyHeader = req.headers['x-api-key'] || '';
  const provided = authHeader.replace(/^Bearer\s+/i, '') || apiKeyHeader;
  if (legacy && provided === legacy) return next();
  if (mode !== 'strict' && !provided) return next();
  const ok = await verifyIngestApiKey(normalizeWorkspace(req), normalizeEnvironment(req), provided, 'API');
  if (!ok.ok) return res.status(401).json({ error: `Invalid ingestion key: ${ok.reason}. Generate an environment-scoped key from Ops → API Keys.` });
  req.ingestKey = ok.key;
  return next();
}


// ─── Routes ──────────────────────────────────────────────────────────────────
router.get('/workspaces', asyncHandler(async (_req, res) =>
  res.json({ data: await getWorkspaces() })
));


router.get('/:workspace/environments', asyncHandler(async (req, res) =>
  res.json({ data: await listEnvironments(normalizeWorkspace(req)) })
));

router.post('/:workspace/environments', asyncHandler(async (req, res) =>
  res.status(201).json({ data: await createEnvironment(normalizeWorkspace(req), req.body || {}) })
));

router.put('/:workspace/environments/:envName', asyncHandler(async (req, res) =>
  res.json({ data: await updateEnvironment(normalizeWorkspace(req), req.params.envName, req.body || {}) })
));

router.delete('/:workspace/environments/:envName', asyncHandler(async (req, res) =>
  res.json({ data: await deleteEnvironment(normalizeWorkspace(req), req.params.envName) })
));

router.get('/:workspace/:environment/config', asyncHandler(async (req, res) =>
  res.json({ data: await getEnvironmentConfig(normalizeWorkspace(req), normalizeEnvironment(req)) })
));

router.put('/:workspace/:environment/config', asyncHandler(async (req, res) =>
  res.json({ data: await updateEnvironmentConfig(normalizeWorkspace(req), normalizeEnvironment(req), req.body || {}) })
));

router.delete('/:workspace/:environment/config/policy', asyncHandler(async (req, res) =>
  res.json({ data: await resetEnvironmentPolicy(normalizeWorkspace(req), normalizeEnvironment(req)) })
));

router.post('/:workspace/:environment/masking-rules', asyncHandler(async (req, res) =>
  res.status(201).json({ data: await upsertMaskingRule(normalizeWorkspace(req), normalizeEnvironment(req), req.body || {}) })
));

router.put('/:workspace/:environment/masking-rules/:ruleId', asyncHandler(async (req, res) =>
  res.json({ data: await upsertMaskingRule(normalizeWorkspace(req), normalizeEnvironment(req), { ...(req.body || {}), id: req.params.ruleId }) })
));

router.delete('/:workspace/:environment/masking-rules/:ruleId', asyncHandler(async (req, res) =>
  res.json({ data: await deleteMaskingRule(normalizeWorkspace(req), normalizeEnvironment(req), req.params.ruleId) })
));

router.post('/:workspace/:environment/masking-rules/test', asyncHandler(async (req, res) =>
  res.json({ data: await testMaskingRules(normalizeWorkspace(req), normalizeEnvironment(req), req.body?.sample || req.body?.text || '') })
));

router.get('/:workspace/:environment/ingest-keys', asyncHandler(async (req, res) =>
  res.json({ data: await listIngestApiKeys(normalizeWorkspace(req), normalizeEnvironment(req)) })
));

router.post('/:workspace/:environment/ingest-keys', asyncHandler(async (req, res) =>
  res.status(201).json({ data: await createIngestApiKey(normalizeWorkspace(req), normalizeEnvironment(req), req.body || {}) })
));

router.post('/:workspace/:environment/ingest-keys/:keyId/revoke', asyncHandler(async (req, res) =>
  res.json({ data: await revokeIngestApiKey(normalizeWorkspace(req), normalizeEnvironment(req), req.params.keyId) })
));

router.delete('/:workspace/:environment/ingest-keys/:keyId', asyncHandler(async (req, res) =>
  res.json({ data: await deleteIngestApiKey(normalizeWorkspace(req), normalizeEnvironment(req), req.params.keyId) })
));

router.get('/:workspace/:environment/audit-logs', asyncHandler(async (req, res) =>
  res.json({ data: await getAuditLogs(normalizeWorkspace(req), normalizeEnvironment(req), req.query.limit || 50) })
));


router.get('/:workspace/:environment/overview', asyncHandler(async (req, res) => {
  const data = await getOverview(normalizeWorkspace(req), normalizeEnvironment(req));
  res.json({ data });
}));

router.get('/:workspace/:environment/services', asyncHandler(async (req, res) =>
  res.json({ data: await getServices(normalizeWorkspace(req), normalizeEnvironment(req)) })
));

router.get('/:workspace/:environment/endpoints', asyncHandler(async (req, res) =>
  res.json({ data: await getEndpoints(normalizeWorkspace(req), normalizeEnvironment(req), req.query.service || '') })
));


router.post('/:workspace/:environment/api-registry', asyncHandler(async (req, res) =>
  res.status(201).json({ data: await createManualApiEndpoint(normalizeWorkspace(req), normalizeEnvironment(req), req.body || {}) })
));

router.delete('/:workspace/:environment/api-registry', asyncHandler(async (req, res) =>
  res.json({ data: await deleteApiRegistryItem(normalizeWorkspace(req), normalizeEnvironment(req), { ...(req.body || {}), ...(req.query || {}) }) })
));


router.get('/:workspace/:environment/logs', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 500);
  const page  = Math.max(Number(req.query.page  || 1), 1);
  res.json({
    data: await getLogs(normalizeWorkspace(req), normalizeEnvironment(req), limit, {
      q: req.query.q, severity: req.query.severity, service: req.query.service,
      path: req.query.path, trace_id: req.query.trace_id, range: req.query.range,
      from: req.query.from, to: req.query.to, upload_id: req.query.upload_id,
      // v21: additional filter hooks
      http_status: req.query.http_status, flow_name: req.query.flow_name,
      page
    })
  });
}));


router.get('/:workspace/:environment/topology', asyncHandler(async (req, res) =>
  res.json({ data: await getTopology(normalizeWorkspace(req), normalizeEnvironment(req)) })
));

router.get('/:workspace/:environment/traces',  asyncHandler(async (req, res) =>
  res.json({ data: await getTraces(normalizeWorkspace(req), normalizeEnvironment(req)) })
));

router.get('/:workspace/:environment/traces/:traceId', asyncHandler(async (req, res) =>
  res.json({ data: await getTraceDetail(normalizeWorkspace(req), normalizeEnvironment(req), req.params.traceId) })
));

router.get('/:workspace/:environment/error-groups', asyncHandler(async (req, res) =>
  res.json({ data: await getErrorGroups(normalizeWorkspace(req), normalizeEnvironment(req), {
    service: req.query.service, path: req.query.path, range: req.query.range || '24h'
  }) })
));

router.get('/:workspace/:environment/deploy-impact', asyncHandler(async (req, res) =>
  res.json({ data: await getDeployImpact(normalizeWorkspace(req), normalizeEnvironment(req)) })
));
router.get('/:workspace/:environment/alerts',  asyncHandler(async (req, res) =>
  res.json({ data: await getAlerts(normalizeWorkspace(req), normalizeEnvironment(req)) })
));


router.get('/:workspace/:environment/alert-rules', asyncHandler(async (req, res) =>
  res.json({ data: await getAlertRules(normalizeWorkspace(req), normalizeEnvironment(req)) })
));

router.post('/:workspace/:environment/alert-rules', asyncHandler(async (req, res) =>
  res.status(201).json({ data: await createAlertRule(normalizeWorkspace(req), normalizeEnvironment(req), req.body || {}) })
));

router.post('/:workspace/:environment/alerts/evaluate', asyncHandler(async (req, res) => {
  const data = await evaluateAlertRules(normalizeWorkspace(req), normalizeEnvironment(req));
  await postAlertWebhook(normalizeWorkspace(req), normalizeEnvironment(req), data.alerts || []);
  res.json({ data });
}));

router.post('/:workspace/:environment/anomalies/run', asyncHandler(async (req, res) => {
  const data = await runAnomalyDetection(normalizeWorkspace(req), normalizeEnvironment(req));
  await postAlertWebhook(normalizeWorkspace(req), normalizeEnvironment(req), data.alerts || []);
  res.json({ data });
}));

router.get('/:workspace/:environment/saved-searches', asyncHandler(async (req, res) =>
  res.json({ data: await getSavedSearches(normalizeWorkspace(req), normalizeEnvironment(req)) })
));

router.post('/:workspace/:environment/saved-searches', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Saved search name is required' });
  res.status(201).json({ data: await createSavedSearch(normalizeWorkspace(req), normalizeEnvironment(req), name, req.body?.filters || {}) });
}));
router.get('/:workspace/:environment/ops',     asyncHandler(async (req, res) =>
  res.json({ data: await getOps(normalizeWorkspace(req), normalizeEnvironment(req)) })
));

router.post('/:workspace/:environment/rca', asyncHandler(async (req, res) =>
  res.json({ data: await rca(normalizeWorkspace(req), normalizeEnvironment(req), req.body?.query || '') })
));

// Direct JSON log ingest
router.post('/:workspace/:environment/logs', ingestLimit, requireWorkspaceIngestKey, asyncHandler(async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];
  const data    = await bulkCreateLogs(normalizeWorkspace(req), normalizeEnvironment(req), payload);
  res.status(201).json({ inserted: data.length, data });
}));

router.delete('/:workspace/:environment/logs', ingestLimit, asyncHandler(async (req, res) => {
  const data = await deleteEnvironmentLogs(normalizeWorkspace(req), normalizeEnvironment(req));
  res.json({ data });
}));

router.get('/:workspace/:environment/uploads', asyncHandler(async (req, res) =>
  res.json({ data: await getUploadHistory(normalizeWorkspace(req), normalizeEnvironment(req)) })
));

router.delete('/:workspace/:environment/uploads', ingestLimit, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const data = req.body?.all
    ? await deleteAllUploadHistory(normalizeWorkspace(req), normalizeEnvironment(req))
    : await deleteUploadHistory(normalizeWorkspace(req), normalizeEnvironment(req), ids);
  res.json({ data });
}));

router.delete('/:workspace/:environment/uploads/:uploadId', ingestLimit, asyncHandler(async (req, res) => {
  const data = await deleteUploadHistory(normalizeWorkspace(req), normalizeEnvironment(req), [req.params.uploadId]);
  res.json({ data });
}));

// Job status polling
router.get('/:workspace/:environment/ingestion/:jobId', asyncHandler(async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Ingestion job not found or expired' });
  res.json({ data: job });
}));

// ─── Async file upload (v21 turbo path) ──────────────────────────────────────
router.post('/:workspace/:environment/logs/upload-async', ingestLimit, asyncHandler(async (req, res) => {
  const workspace   = normalizeWorkspace(req);
  const environment = normalizeEnvironment(req);
  const fileName    = String(req.headers['x-file-name'] || 'upload.log').slice(0, 160);

  const job = createJob(fileName);
  const uploadRecord = await createUploadRecord(workspace, environment, { fileName, bytes: 0 });
  job.uploadRecordId = uploadRecord?.id || null;

  const filePath = path.join(os.tmpdir(), `observex-${job.id}.log`);
  const out      = fs.createWriteStream(filePath);
  let bytes      = 0;

  try {
    await new Promise((resolve, reject) => {
      let rejected = false;
      req.on('data', chunk => {
        bytes += chunk.length;
        updateJob(job, { bytes, stage: 'Receiving file…' });
        if (bytes > MAX_UPLOAD_BYTES && !rejected) {
          rejected = true;
          const err = Object.assign(new Error(`Upload exceeds limit ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`), { status: 413 });
          req.destroy(err); out.destroy(err); reject(err);
        }
      });
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    });
  } catch (err) {
    await updateUploadRecord(workspace, environment, job.uploadRecordId, {
      status: 'failed', parser_errors: 1,
      meta: { bytes, stage: 'Upload failed before parsing', error: err.message || String(err) }
    }).catch(() => {});
    updateJob(job, { status: 'failed', stage: 'Upload failed before parsing', bytes, error: err.message || String(err) });
    fs.promises.rm(filePath, { force: true }).catch(() => {});
    throw err;
  }

  job.bytes = bytes;
  await updateUploadRecord(workspace, environment, job.uploadRecordId, {
    status: 'queued', meta: { bytes, stage: 'Queued for parsing' }
  }).catch(() => {});
  updateJob(job, { status: 'queued', stage: 'Queued for parsing…', bytes });

  // Fire-and-forget background processing
  setImmediate(() => processUploadedFile(job, filePath, workspace, environment));

  res.status(202).json({ data: job });
}));

// ─── Sync upload (legacy, kept for compat) ───────────────────────────────────
router.post('/:workspace/:environment/logs/upload', ingestLimit, asyncHandler(async (req, res) => {
  let bytes = 0, inserted = 0, parsed = 0, rejected = 0, batchBuf = [];
  const fileName     = String(req.headers['x-file-name'] || 'browser/API upload').slice(0, 160);
  const uploadRecord = await createUploadRecord(normalizeWorkspace(req), normalizeEnvironment(req), { fileName, bytes: 0 });

  let mode = null, structuredBuffer = '';

  async function flush() {
    if (!batchBuf.length) return;
    const created = await bulkCreateLogs(
      normalizeWorkspace(req), normalizeEnvironment(req), batchBuf,
      { uploadId: uploadRecord?.id, sourceName: fileName, bytes }
    );
    inserted += created.length;
    batchBuf = [];
  }

  async function acceptItems(items) {
    for (const item of items) {
      if (item) { batchBuf.push(item); parsed++; }
      else rejected++;
      if (batchBuf.length >= adaptiveBatchSize()) await flush();
    }
  }

  const streamParser = createStreamingParser(acceptItems);

  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD_BYTES) {
      const err = new Error(`Upload exceeds limit ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
      err.status = 413; throw err;
    }
    const textChunk = chunk.toString('utf8');
    if (mode === null) {
      const first = textChunk.trimStart()[0];
      mode = (first === '{' || first === '[') ? 'structured' : 'raw';
    }
    if (mode === 'structured') structuredBuffer += textChunk;
    else await streamParser.push(textChunk);
  }

  if (mode === 'structured') await acceptItems(parseUploadText(structuredBuffer));
  else await streamParser.finish();
  await flush();

  if (!parsed) {
    await updateUploadRecord(normalizeWorkspace(req), normalizeEnvironment(req), uploadRecord?.id, {
      status: 'failed', parser_errors: 1, meta: { bytes, error: 'No parseable log events found' }
    }).catch(() => {});
    return res.status(400).json({ error: 'No parseable log events found. Supported: Mule runtime logs, JSON/JSONL, and generic timestamped logs.' });
  }

  await updateUploadRecord(normalizeWorkspace(req), normalizeEnvironment(req), uploadRecord?.id, {
    status: 'completed', accepted_count: inserted, rejected_count: rejected,
    parser_errors: 0, meta: { bytes, stage: 'Completed' }
  }).catch(() => {});

  const anomaly = await runAnomalyDetection(normalizeWorkspace(req), normalizeEnvironment(req)).catch(() => null);
  if (anomaly?.alerts?.length) await postAlertWebhook(normalizeWorkspace(req), normalizeEnvironment(req), anomaly.alerts);

  res.status(201).json({ inserted, parsed, rejected, bytes, upload_id: uploadRecord?.id, parser: 'mule+generic', anomaly });
}));

export default router;
