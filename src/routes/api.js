import express from 'express';
import { bulkCreateLogs, getAlerts, getEndpoints, getLogs, getOps, getOverview, getServices, getTraces, getWorkspaces, rca } from '../services/repository.js';
import { requireApiKey } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { parseLogBlock, parseUploadText, isNewLogStart } from '../services/logParser.js';

const router = express.Router();
router.use(rateLimit({ maxRequests: 180, windowMs: 60_000 }));
const ingestLimit = rateLimit({ maxRequests: 30, windowMs: 60_000 });
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 750 * 1024 * 1024);
const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || 5000);

const asyncHandler = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const normalizeEnvironment = req => String(req.params.environment || req.query.environment || 'PROD').toUpperCase();
const normalizeWorkspace = req => String(req.params.workspace || req.query.workspace || 'fsbl-prod-ops');


function createRawStreamParser(onItems) {
  let current = '';
  let pending = '';
  return {
    async push(chunkText) {
      const text = pending + chunkText;
      const lines = text.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        if (isNewLogStart(line)) {
          if (current.trim()) await onItems([parseLogBlock(current)].filter(Boolean));
          current = line;
        } else if (current) {
          current += '\n' + line;
        } else if (line.trim()) {
          current = line;
        }
      }
    },
    async finish() {
      if (pending) {
        if (isNewLogStart(pending)) {
          if (current.trim()) await onItems([parseLogBlock(current)].filter(Boolean));
          current = pending;
        } else if (current) current += '\n' + pending;
        else current = pending;
      }
      if (current.trim()) await onItems([parseLogBlock(current)].filter(Boolean));
      current = ''; pending = '';
    }
  };
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
  let bytes = 0, inserted = 0, parsed = 0, rejected = 0, batch = [];
  let mode = null, structuredBuffer = '';
  async function flush(){
    if(!batch.length) return;
    const created = await bulkCreateLogs(normalizeWorkspace(req), normalizeEnvironment(req), batch);
    inserted += created.length;
    batch = [];
  }
  async function acceptItems(items){
    for (const item of items) {
      if (item) { batch.push(item); parsed++; }
      else rejected++;
      if (batch.length >= BATCH_SIZE) await flush();
    }
  }
  const rawParser = createRawStreamParser(acceptItems);
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD_BYTES) {
      const err = new Error(`Upload exceeds limit ${Math.round(MAX_UPLOAD_BYTES/1024/1024)}MB`);
      err.status = 413;
      throw err;
    }
    const textChunk = chunk.toString('utf8');
    if (mode === null) {
      const first = textChunk.trimStart()[0];
      mode = first === '{' || first === '[' ? 'structured' : 'raw';
    }
    if (mode === 'structured') structuredBuffer += textChunk;
    else await rawParser.push(textChunk);
  }
  if (mode === 'structured') await acceptItems(parseUploadText(structuredBuffer));
  else await rawParser.finish();
  await flush();
  if (!parsed) return res.status(400).json({error:'No parseable log events found. Supported: Mule runtime logs, JSON/JSONL, and generic timestamped logs.'});
  res.status(201).json({inserted, parsed, rejected, bytes, parser:'mule+generic'});
}));


export default router;
