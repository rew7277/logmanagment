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

function parseLogLine(line) {
  const trimmed = String(line || '').trim(); if (!trimmed) return null;
  try {
    const p = JSON.parse(trimmed);
    return { timestamp:p.timestamp||p.time||p['@timestamp'], severity:String(p.severity||p.level||'INFO').toUpperCase(), trace_id:p.trace_id||p.traceId||p.correlationId||p.correlation_id, service_name:p.service_name||p.service||p.app||p.application||p.api, method:p.method, path:p.path||p.endpoint||p.uri||p.url, message:p.message||p.msg||trimmed, raw:p };
  } catch {
    const sev = /\bFATAL\b/i.test(trimmed)?'FATAL':/\bERROR\b/i.test(trimmed)?'ERROR':/\bWARN(?:ING)?\b/i.test(trimmed)?'WARN':/\bDEBUG\b/i.test(trimmed)?'DEBUG':'INFO';
    const trace = trimmed.match(/(?:trace[_-]?id|correlation[_-]?id)[=: ]+([A-Za-z0-9._-]+)|\b(TR[-_A-Z0-9]+)\b/i);
    const method = trimmed.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/); const path = trimmed.match(/\s(\/[^\s?]+)(?:\?|\s|$)/);
    const svc = trimmed.match(/(?:service|app|api)[=: ]+([A-Za-z0-9._-]+)/i);
    return { severity:sev, trace_id:trace ? (trace[1] || trace[2] || trace[0].split(/[=: ]+/).pop()) : null, service_name:svc?.[1] || null, method:method?.[1], path:path?.[1], message:trimmed, raw:{line:trimmed} };
  }
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

router.post('/:workspace/:environment/logs/upload', ingestLimit, requireApiKey, asyncHandler(async (req,res)=>{
  let bytes=0, carry='', inserted=0, parsed=0, rejected=0, batch=[];
  async function flush(){ if(!batch.length) return; const created=await bulkCreateLogs(normalizeWorkspace(req),normalizeEnvironment(req),batch); inserted+=created.length; batch=[]; }
  for await (const chunk of req) {
    bytes += chunk.length; if (bytes > MAX_UPLOAD_BYTES) { const err=new Error(`Upload exceeds limit ${Math.round(MAX_UPLOAD_BYTES/1024/1024)}MB`); err.status=413; throw err; }
    const text = carry + chunk.toString('utf8'); const lines = text.split(/\r?\n/); carry = lines.pop() || '';
    for (const line of lines) { const item=parseLogLine(line); if(item){batch.push(item);parsed++;} else rejected++; if(batch.length>=BATCH_SIZE) await flush(); }
  }
  if (carry.trim()) { const item=parseLogLine(carry); if(item){batch.push(item);parsed++;} else rejected++; }
  await flush(); if (!parsed) return res.status(400).json({error:'No parseable log lines found in upload.'});
  res.status(201).json({inserted, parsed, rejected, bytes});
}));

export default router;
