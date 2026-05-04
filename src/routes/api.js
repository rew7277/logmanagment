import express from 'express';
import { bulkCreateLogs, getAlerts, getEndpoints, getLogs, getOps, getOverview, getServices, getTraces, getWorkspaces, rca } from '../services/repository.js';
import { requireApiKey } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();
router.use(rateLimit({ maxRequests: 180, windowMs: 60_000 }));
const ingestLimit = rateLimit({ maxRequests: 30, windowMs: 60_000 });
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 750 * 1024 * 1024);
const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || 5000);

const asyncHandler = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const normalizeEnvironment = req => String(req.params.environment || req.query.environment || 'PROD').toUpperCase();
const normalizeWorkspace = req => String(req.params.workspace || req.query.workspace || 'fsbl-prod-ops');

function pick(...values) {
  return values.find(v => v !== undefined && v !== null && String(v).trim() !== '');
}

function extractFromObject(p) {
  const raw = p.raw && typeof p.raw === 'object' ? p.raw : p;
  const msg = pick(p.message, p.msg, p.log, p.event, p.text, p.short_message, p.detail, typeof raw === 'string' ? raw : null);
  const service = pick(p.service_name, p.service, p.api_name, p.apiName, p.api, p.application, p.app, p.logger_name, p.logger, p.mule_app, p.flow, p.flowName, raw.service, raw.api);
  const method = pick(p.method, p.http_method, p.httpMethod, p.request_method, raw.method);
  const path = pick(p.path, p.endpoint, p.uri, p.url, p.request_uri, p.requestPath, p.resource, raw.path, raw.endpoint);
  const trace = pick(p.trace_id, p.traceId, p.correlationId, p.correlation_id, p.eventId, p.event_id, p.transactionId, p.transaction_id, p.requestId, p.request_id, p['x-correlation-id']);
  return {
    timestamp: pick(p.timestamp, p.time, p['@timestamp'], p.datetime, p.date),
    severity: String(p.severity || p.level || p.log_level || p.status || 'INFO').toUpperCase(),
    trace_id: trace || null,
    service_name: service || inferServiceFromMessage(msg || JSON.stringify(raw)),
    method: method ? String(method).toUpperCase() : inferMethod(msg || ''),
    path: path || inferPath(msg || ''),
    message: msg || JSON.stringify(raw),
    raw
  };
}

function inferMethod(text) { return (String(text).match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i) || [])[1]?.toUpperCase() || null; }
function inferPath(text) { return (String(text).match(/(?:path|endpoint|uri|url|requestPath)[=: ]+['"]?(\/[A-Za-z0-9._~:\/?#[\]@!$&'()*+,;=%-]+)/i) || String(text).match(/\s(\/[A-Za-z0-9._~:\/?#[\]@!$&'()*+,;=%-]+)(?:\s|$)/) || [])[1] || null; }
function inferServiceFromMessage(text) { return (String(text).match(/(?:service|api|application|app|flow|logger)[=: ]+['"]?([A-Za-z0-9._-]+)/i) || [])[1] || null; }
function inferTrace(text) { return (String(text).match(/(?:trace[_-]?id|correlation[_-]?id|event[_-]?id|transaction[_-]?id|request[_-]?id)[=: ]+['"]?([A-Za-z0-9._:-]+)/i) || [])[1] || null; }

function parseLogLine(line) {
  const trimmed = String(line || '').trim(); if (!trimmed) return null;
  try { return extractFromObject(JSON.parse(trimmed)); } catch {}
  const sev = /\bFATAL\b/i.test(trimmed)?'FATAL':/\bERROR\b/i.test(trimmed)?'ERROR':/\bWARN(?:ING)?\b/i.test(trimmed)?'WARN':/\bDEBUG\b/i.test(trimmed)?'DEBUG':'INFO';
  return {
    severity: sev,
    trace_id: inferTrace(trimmed),
    service_name: inferServiceFromMessage(trimmed),
    method: inferMethod(trimmed),
    path: inferPath(trimmed),
    message: trimmed,
    raw: { line: trimmed }
  };
}

function recordsFromJsonPayload(parsed) {
  if (Array.isArray(parsed)) return parsed.map(extractFromObject);
  if (parsed && typeof parsed === 'object') {
    const candidate = parsed.logs || parsed.events || parsed.records || parsed.items || parsed.data;
    if (Array.isArray(candidate)) return candidate.map(extractFromObject);
    return [extractFromObject(parsed)];
  }
  return [];
}

function looksLikeStructuredJson(text) {
  const t = String(text || '').trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

function parseUploadText(text) {
  const body = String(text || '').trim();
  if (!body) return [];
  if (looksLikeStructuredJson(body)) {
    try { return recordsFromJsonPayload(JSON.parse(body)).filter(Boolean); } catch {}
  }
  return body.split(/\r?\n/).map(parseLogLine).filter(Boolean);
}


router.get('/workspaces', asyncHandler(async (_req,res)=>res.json({data:await getWorkspaces()})));
router.get('/:workspace/:environment/overview', asyncHandler(async (req,res)=>{const data=await getOverview(normalizeWorkspace(req),normalizeEnvironment(req));res.json({data});}));
router.get('/:workspace/:environment/services', asyncHandler(async (req,res)=>res.json({data:await getServices(normalizeWorkspace(req),normalizeEnvironment(req))})));
router.get('/:workspace/:environment/endpoints', asyncHandler(async (req,res)=>res.json({data:await getEndpoints(normalizeWorkspace(req),normalizeEnvironment(req))})));
router.get('/:workspace/:environment/logs', asyncHandler(async (req,res)=>{const limit=Math.min(Number(req.query.limit||50),500);const page=Math.max(Number(req.query.page||1),1);res.json({data:await getLogs(normalizeWorkspace(req),normalizeEnvironment(req),limit,{q:req.query.q,severity:req.query.severity,service:req.query.service,path:req.query.path,trace_id:req.query.trace_id,range:req.query.range,from:req.query.from,to:req.query.to,page})});}));
router.get('/:workspace/:environment/traces', asyncHandler(async (req,res)=>res.json({data:await getTraces(normalizeWorkspace(req),normalizeEnvironment(req))})));
router.get('/:workspace/:environment/alerts', asyncHandler(async (req,res)=>res.json({data:await getAlerts(normalizeWorkspace(req),normalizeEnvironment(req))})));
router.get('/:workspace/:environment/ops', asyncHandler(async (req,res)=>res.json({data:await getOps(normalizeWorkspace(req),normalizeEnvironment(req))})));
router.post('/:workspace/:environment/rca', asyncHandler(async (req,res)=>res.json({data:await rca(normalizeWorkspace(req),normalizeEnvironment(req),req.body?.query||'')})));

router.post('/:workspace/:environment/logs', ingestLimit, requireApiKey, asyncHandler(async (req,res)=>{const payload=Array.isArray(req.body)?req.body:[req.body];const data=await bulkCreateLogs(normalizeWorkspace(req),normalizeEnvironment(req),payload);res.status(201).json({inserted:data.length,data});}));

router.post('/:workspace/:environment/logs/upload', ingestLimit, asyncHandler(async (req,res)=>{
  let bytes=0, carry='', inserted=0, parsed=0, rejected=0, batch=[];
  let mode=null, structuredBuffer='';
  async function flush(){ if(!batch.length) return; const created=await bulkCreateLogs(normalizeWorkspace(req),normalizeEnvironment(req),batch); inserted+=created.length; batch=[]; }
  function acceptItems(items){ for (const item of items) { if(item){batch.push(item); parsed++;} else rejected++; } }
  for await (const chunk of req) {
    bytes += chunk.length; if (bytes > MAX_UPLOAD_BYTES) { const err=new Error(`Upload exceeds limit ${Math.round(MAX_UPLOAD_BYTES/1024/1024)}MB`); err.status=413; throw err; }
    const textChunk = chunk.toString('utf8');
    if (mode === null) {
      const first = (carry + textChunk).trimStart()[0];
      mode = first === '{' || first === '[' ? 'structured' : 'lines';
    }
    if (mode === 'structured') { structuredBuffer += textChunk; continue; }
    const text = carry + textChunk; const lines = text.split(/\r?\n/); carry = lines.pop() || '';
    for (const line of lines) { const item=parseLogLine(line); if(item){batch.push(item);parsed++;} else rejected++; if(batch.length>=BATCH_SIZE) await flush(); }
  }
  if (mode === 'structured') {
    const items = parseUploadText(structuredBuffer);
    for (let i=0; i<items.length; i+=BATCH_SIZE) { batch.push(...items.slice(i, i+BATCH_SIZE)); parsed += items.slice(i, i+BATCH_SIZE).length; await flush(); }
  } else if (carry.trim()) { const item=parseLogLine(carry); if(item){batch.push(item);parsed++;} else rejected++; }
  await flush(); if (!parsed) return res.status(400).json({error:'No parseable log lines found in upload.'});
  res.status(201).json({inserted, parsed, rejected, bytes});
}));

export default router;
