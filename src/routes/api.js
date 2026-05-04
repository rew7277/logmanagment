import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bulkCreateLogs, createUploadRecord, deleteAllUploadHistory, deleteEnvironmentLogs, deleteUploadHistory, getAlerts, getEndpoints, getLogs, getOps, getOverview, getServices, getTraces, getUploadHistory, getWorkspaces, rca, updateUploadRecord } from '../services/repository.js';
import { requireApiKey } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { parseLogBlock, parseUploadText, isNewLogStart } from '../services/logParser.js';

const router = express.Router();
router.use(rateLimit({ maxRequests: 180, windowMs: 60_000 }));
const ingestLimit = rateLimit({ maxRequests: 30, windowMs: 60_000 });
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 750 * 1024 * 1024);
const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || 5000);

const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;
function createJob(fileName='upload.log') {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  const job = { id, fileName, status:'receiving', stage:'Receiving file', bytes:0, parsed:0, inserted:0, rejected:0, speed:0, startedAt:Date.now(), updatedAt:Date.now(), error:null };
  jobs.set(id, job);
  return job;
}
function updateJob(job, patch={}) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  const elapsed = Math.max((Date.now() - job.startedAt) / 1000, 0.1);
  job.speed = Math.round((job.inserted || job.parsed || 0) / elapsed);
}
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (['completed','failed'].includes(job.status) && now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 10 * 60 * 1000).unref?.();

async function processUploadedFile(job, filePath, workspace, environment) {
  let batch = [];
  async function flush(){
    if(!batch.length) return;
    updateJob(job, { status:'processing', stage:`Indexing ${batch.length} parsed events` });
    const created = await bulkCreateLogs(workspace, environment, batch, { uploadId: job.uploadRecordId, sourceName: job.fileName, bytes: job.bytes });
    job.inserted += created.length;
    batch = [];
    updateJob(job, { stage:'Parsing & indexing', status:'processing' });
  }
  async function acceptItems(items){
    for (const item of items) {
      if (item) { batch.push(item); job.parsed++; }
      else job.rejected++;
      if (batch.length >= BATCH_SIZE) await flush();
    }
    updateJob(job, {});
  }
  try {
    updateJob(job, { status:'processing', stage:'Parsing Mule logs' });
    const rawParser = createRawStreamParser(acceptItems);
    const stream = fs.createReadStream(filePath, { encoding:'utf8', highWaterMark: 1024 * 1024 });
    let mode = null;
    let structuredBuffer = '';
    for await (const textChunk of stream) {
      if (mode === null) {
        const first = String(textChunk).trimStart()[0];
        mode = first === '{' || first === '[' ? 'structured' : 'raw';
      }
      if (mode === 'structured') structuredBuffer += textChunk;
      else await rawParser.push(textChunk);
    }
    if (mode === 'structured') await acceptItems(parseUploadText(structuredBuffer));
    else await rawParser.finish();
    await flush();
    if (!job.parsed) throw new Error('No parseable log events found. Supported: Mule runtime logs, JSON/JSONL, and generic timestamped logs.');
    await updateUploadRecord(workspace, environment, job.uploadRecordId, { status:'completed', accepted_count: job.inserted, rejected_count: job.rejected, parser_errors: 0, meta:{ bytes: job.bytes, stage:'Completed', speed: job.speed } });
    updateJob(job, { status:'completed', stage:'Completed' });
  } catch (err) {
    await updateUploadRecord(workspace, environment, job.uploadRecordId, { status:'failed', accepted_count: job.inserted || 0, rejected_count: job.rejected || 0, parser_errors: 1, meta:{ bytes: job.bytes, stage:'Failed', error: err.message || String(err), speed: job.speed || 0 } }).catch(()=>{});
    updateJob(job, { status:'failed', stage:'Failed', error: err.message || String(err) });
  } finally {
    fs.promises.rm(filePath, { force:true }).catch(()=>{});
  }
}

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
router.get('/:workspace/:environment/logs', asyncHandler(async (req,res)=>{const limit=Math.min(Number(req.query.limit||50),500);const page=Math.max(Number(req.query.page||1),1);res.json({data:await getLogs(normalizeWorkspace(req),normalizeEnvironment(req),limit,{q:req.query.q,severity:req.query.severity,service:req.query.service,path:req.query.path,trace_id:req.query.trace_id,range:req.query.range,from:req.query.from,to:req.query.to,upload_id:req.query.upload_id,page})});}));
router.get('/:workspace/:environment/traces', asyncHandler(async (req,res)=>res.json({data:await getTraces(normalizeWorkspace(req),normalizeEnvironment(req))})));
router.get('/:workspace/:environment/alerts', asyncHandler(async (req,res)=>res.json({data:await getAlerts(normalizeWorkspace(req),normalizeEnvironment(req))})));
router.get('/:workspace/:environment/ops', asyncHandler(async (req,res)=>res.json({data:await getOps(normalizeWorkspace(req),normalizeEnvironment(req))})));
router.post('/:workspace/:environment/rca', asyncHandler(async (req,res)=>res.json({data:await rca(normalizeWorkspace(req),normalizeEnvironment(req),req.body?.query||'')})));

router.post('/:workspace/:environment/logs', ingestLimit, requireApiKey, asyncHandler(async (req,res)=>{const payload=Array.isArray(req.body)?req.body:[req.body];const data=await bulkCreateLogs(normalizeWorkspace(req),normalizeEnvironment(req),payload);res.status(201).json({inserted:data.length,data});}));


router.delete('/:workspace/:environment/logs', ingestLimit, asyncHandler(async (req,res)=>{
  const data = await deleteEnvironmentLogs(normalizeWorkspace(req), normalizeEnvironment(req));
  res.json({data});
}));


router.get('/:workspace/:environment/uploads', asyncHandler(async (req,res)=>{
  res.json({data:await getUploadHistory(normalizeWorkspace(req), normalizeEnvironment(req))});
}));

router.delete('/:workspace/:environment/uploads', ingestLimit, asyncHandler(async (req,res)=>{
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const data = req.body?.all ? await deleteAllUploadHistory(normalizeWorkspace(req), normalizeEnvironment(req)) : await deleteUploadHistory(normalizeWorkspace(req), normalizeEnvironment(req), ids);
  res.json({data});
}));

router.delete('/:workspace/:environment/uploads/:uploadId', ingestLimit, asyncHandler(async (req,res)=>{
  const data = await deleteUploadHistory(normalizeWorkspace(req), normalizeEnvironment(req), [req.params.uploadId]);
  res.json({data});
}));

router.get('/:workspace/:environment/ingestion/:jobId', asyncHandler(async (req,res)=>{
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({error:'Ingestion job not found or expired'});
  res.json({data:job});
}));

router.post('/:workspace/:environment/logs/upload-async', ingestLimit, asyncHandler(async (req,res)=>{
  const workspace = normalizeWorkspace(req);
  const environment = normalizeEnvironment(req);
  const fileName = String(req.headers['x-file-name'] || 'upload.log').slice(0, 160);
  const job = createJob(fileName);
  const uploadRecord = await createUploadRecord(workspace, environment, { fileName, bytes: 0 });
  job.uploadRecordId = uploadRecord?.id || null;
  const filePath = path.join(os.tmpdir(), `observex-${job.id}.log`);
  const out = fs.createWriteStream(filePath);
  let bytes = 0;
  try {
    await new Promise((resolve, reject) => {
      let rejected = false;
      req.on('data', chunk => {
        bytes += chunk.length;
        updateJob(job, { bytes, stage:'Receiving file' });
        if (bytes > MAX_UPLOAD_BYTES && !rejected) {
          rejected = true;
          const err = Object.assign(new Error(`Upload exceeds limit ${Math.round(MAX_UPLOAD_BYTES/1024/1024)}MB`), { status:413 });
          req.destroy(err);
          out.destroy(err);
          reject(err);
        }
      });
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    });
  } catch (err) {
    await updateUploadRecord(workspace, environment, job.uploadRecordId, { status:'failed', parser_errors:1, meta:{ bytes, stage:'Upload failed before parsing', error: err.message || String(err) } }).catch(()=>{});
    updateJob(job, { status:'failed', stage:'Upload failed before parsing', bytes, error: err.message || String(err) });
    fs.promises.rm(filePath, { force:true }).catch(()=>{});
    throw err;
  }
  job.bytes = bytes;
  await updateUploadRecord(workspace, environment, job.uploadRecordId, { status:'queued', meta:{ bytes, stage:'Queued for parsing' } }).catch(()=>{});
  updateJob(job, { status:'queued', stage:'Queued for parsing', bytes });
  setImmediate(() => processUploadedFile(job, filePath, workspace, environment));
  res.status(202).json({data:job});
}));

router.post('/:workspace/:environment/logs/upload', ingestLimit, asyncHandler(async (req,res)=>{
  let bytes = 0, inserted = 0, parsed = 0, rejected = 0, batch = [];
  const fileName = String(req.headers['x-file-name'] || 'browser/API upload').slice(0,160);
  const uploadRecord = await createUploadRecord(normalizeWorkspace(req), normalizeEnvironment(req), { fileName, bytes: 0 });
  let mode = null, structuredBuffer = '';
  async function flush(){
    if(!batch.length) return;
    const created = await bulkCreateLogs(normalizeWorkspace(req), normalizeEnvironment(req), batch, { uploadId: uploadRecord?.id, sourceName:fileName, bytes });
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
  if (!parsed) { await updateUploadRecord(normalizeWorkspace(req), normalizeEnvironment(req), uploadRecord?.id, { status:'failed', parser_errors:1, meta:{ bytes, error:'No parseable log events found' } }).catch(()=>{}); return res.status(400).json({error:'No parseable log events found. Supported: Mule runtime logs, JSON/JSONL, and generic timestamped logs.'}); }
  await updateUploadRecord(normalizeWorkspace(req), normalizeEnvironment(req), uploadRecord?.id, { status:'completed', accepted_count: inserted, rejected_count: rejected, parser_errors:0, meta:{ bytes, stage:'Completed' } }).catch(()=>{});
  res.status(201).json({inserted, parsed, rejected, bytes, upload_id: uploadRecord?.id, parser:'mule+generic'});
}));


export default router;
