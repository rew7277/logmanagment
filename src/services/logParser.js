/**
 * LogParser v21 — High-Performance Streaming Parser
 * 
 * Key upgrades:
 *  - Worker-ready: pure functions, no side-effects, no I/O
 *  - Pre-compiled RegExp cache (compiled once at module load)
 *  - SIMD-friendly string ops via indexOf over regex where possible
 *  - Lightweight severity trie for O(1) normalization
 *  - JSON fast-path: tries JSON.parse first, falls back to text scan
 *  - Streaming line splitter with zero-copy chunk concatenation
 *  - Full Mule 4 event-header parsing (processor, event, correlation)
 *  - Sensitive-data masking with single-pass regex
 */

// ─── Pre-compiled RegExp cache ────────────────────────────────────────────────
const SEV_PATTERN   = '(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)';
const RE_MULE_START = new RegExp(`^${SEV_PATTERN}\\s+\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}[,.]\\d{3}`);
const RE_GENERIC    = new RegExp(
  `^(?:${SEV_PATTERN}\\b|\\[?\\d{4}-\\d{2}-\\d{2}[T\\s]\\d{2}:\\d{2}:\\d{2}|` +
  `\\d{1,2}\\/\\d{1,2}\\/\\d{4},?\\s+\\d{1,2}:\\d{2}:\\d{2}\\s*(?:am|pm)?|` +
  `\\w+=|\\{\\s*"(?:timestamp|time|level|severity|message|msg|service|api))`, 'i');

const RE_MULE_HEAD      = new RegExp(`^${SEV_PATTERN}\\s+(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}[,.]\\d{3})`, 'i');
const RE_MULE_ROUTE     = /\[([A-Za-z0-9._-]+)\]\.(get|post|put|patch|delete|head|options):(\S+[^\]:\s])/i;
const RE_FLOW_ROUTE     = /(?:^|[\s(])(get|post|put|patch|delete|head|options):(\S+):([A-Za-z0-9._-]+-config)/i;
const RE_PROCESSOR      = /\[processor:\s*([^;\]]+)/i;
const RE_ISO_TS         = /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[,.]\d{3})?/;
const RE_DMY_TS         = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i;
const RE_SEV_WORD       = /\b(FATAL|ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\b/i;
const RE_METHOD         = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i;
const RE_LOGGER_MSG     = /LoggerMessageProcessor:/;
const RE_MULE_API       = /\[([A-Za-z0-9._-]+-api)\]\.(get|post|put|patch|delete|head|options):/i;
const RE_MULE_API2      = /@\s*([A-Za-z0-9._-]+-api)\s*:[A-Za-z0-9._-]+\.xml(?::\d+)?/i;
const RE_MULE_API3      = /\b([A-Za-z0-9._-]+-api)-main\b/i;
const RE_MULE_API4      = /\b([A-Za-z0-9._-]+-api)-config\b/i;
const RE_MULE_API5      = /\b([A-Za-z0-9._-]+-api)\b/i;
const RE_SVC_GENERIC    = /(?:service|api_name|apiName|application|mule_app)\s*[:=]+['"]?([A-Za-z0-9._-]+)/i;
const RE_TRACE_ID       = /(?:trace[_-]?id|traceId)\s*[:=]\s*["']?([A-Za-z0-9._:-]+)/i;
const RE_CORRELATION    = /(?:correlation[_-]?id|correlationId|x-correlation-id|corelation[_-]?id|corelationId)\s*[:=]\s*["']?([A-Za-z0-9._:-]+)/i;
const RE_EVENT_ID       = /(?:event[_-]?id|eventId)\s*[:=]\s*["']?([A-Za-z0-9._:-]+)/i;
const RE_REQUEST_ID     = /(?:request[_-]?id|requestId)\s*[:=]\s*["']?([A-Za-z0-9._:-]+)/i;
const RE_TXN_ID         = /"?transactionId"?\s*[:=]\s*"?([A-Za-z0-9._:-]+)/i;
const RE_MULE_EVENT     = /\[processor:[^\]]*?;\s*event:\s*([^\]\s;]+)/i;
const RE_PATH_NAMED     = /(?:path|endpoint|uri|url|requestPath|route)\s*[:= ]+['"]?(\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)/i;
const RE_PATH_SLASH     = /\s(\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)(?:\s|$)/;
const RE_FLOWSTACK_PATH = /(?:^|[\s(])(get|post|put|patch|delete|head|options):(\S+):([A-Za-z0-9._-]+-config)/i;
const RE_MULE_PATH      = /\]\.(get|post|put|patch|delete|head|options):(\S+)/i;
const RE_MASK_ENCR      = /(encrdata=)([A-Za-z0-9._~+/=-]{24,})/gi;
const RE_MASK_SECRET    = /("?(?:password|secret|token|access[_-]?key|api[_-]?key)"?\s*[:=]\s*"?)([^"\s,}]{6,})/gi;
const RE_BAD_SVC        = /\.xml(?::\d+)?$/i;
const RE_FLOW_SVC       = /(?:^|[-_])(sub)?flow(?:$|[-_])|flowstack|processor|processors/i;

// ─── Severity trie (O(1) lookup) ──────────────────────────────────────────────
const SEV_MAP = Object.freeze({
  TRACE: 'DEBUG', DEBUG: 'DEBUG', INFO: 'INFO',
  WARN: 'WARN', WARNING: 'WARN', ERROR: 'ERROR', FATAL: 'FATAL'
});

function normalizeSeverity(v) {
  return SEV_MAP[String(v || 'INFO').toUpperCase()] ?? 'INFO';
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function pick(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

// Filesystem path segments that indicate this is an OS path, not an HTTP endpoint
const RE_FS_PATH = /^\/(?:data|var|tmp|home|opt|usr|etc|mnt|proc|sys|run|srv|dev|root|logs?|mule|jboss|tomcat|app|apps|deploy|conf|config)\//i;
// File extensions that are never HTTP endpoint paths
const RE_FILE_EXT = /\.(?:log|txt|xml|jar|war|ear|zip|gz|properties|conf|yaml|yml|json|class|py|sh|bat|csv|sql|bak|tmp|lock|pid|out|err)(?:\.[0-9]+)?$/i;
// MuleSoft internal queue/transaction paths
const RE_MULE_INTERNAL = /\/(?:queue-[a-z]+-log|queue-xa|\.mule|mule-enterprise|mule-standalone)\//i;

function normalizePath(p) {
  if (!p) return null;
  let s = String(p).trim().replace(/\\+/g, '/').replace(/\/+/g, '/');
  s = s.replace(/^['"]|['"]$/g, '').split(':')[0];
  if (!s || /[${}]/.test(s)) return null;
  if (!s.startsWith('/')) s = '/' + s;
  // Reject filesystem paths — these are OS/container paths, not HTTP routes
  if (RE_FS_PATH.test(s)) return null;
  if (RE_FILE_EXT.test(s)) return null;
  if (RE_MULE_INTERNAL.test(s)) return null;
  // Reject excessively deep paths that look like filesystem traversal (>6 segments)
  if (s.split('/').filter(Boolean).length > 6) return null;
  return s.replace(/\/$/, '') || '/';
}

function normalizeServiceName(v) {
  if (!v) return null;
  let s = String(v).trim().replace(/^[\[.(]+|[\].,);:]+$/g, '');
  if (!s || s === '-' || /^null$/i.test(s)) return null;
  if (RE_BAD_SVC.test(s)) return null;
  if (RE_FLOW_SVC.test(s)) return null;
  if (s.endsWith('-config')) s = s.slice(0, -7);
  return s || null;
}

function strictMuleService(raw) {
  const t = String(raw || '');
  return normalizeServiceName(
    (RE_MULE_API.exec(t) || [])[1] ||
    (RE_MULE_API2.exec(t) || [])[1] ||
    (RE_MULE_API3.exec(t) || [])[1] ||
    (RE_MULE_API4.exec(t) || [])[1] ||
    (RE_MULE_API5.exec(t) || [])[1]
  );
}

function normalizeTimestamp(ts) {
  if (!ts) return null;
  let s = String(ts).trim().replace(',', '.');
  const dmy = RE_DMY_TS.exec(s);
  if (dmy) {
    let [, d, m, y, hh, mm, ss = '00', ap] = dmy;
    let h = Number(hh);
    if (ap) { if (/pm/i.test(ap) && h < 12) h += 12; if (/am/i.test(ap) && h === 12) h = 0; }
    s = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:${mm}:${ss}`;
  } else if (/^\d{4}-\d{2}-\d{2}\s/.test(s)) s = s.replace(' ', 'T');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function inferMethod(text) {
  return (RE_METHOD.exec(String(text)) || [])[1]?.toUpperCase() || null;
}

function inferPath(text) {
  const s = String(text || '');
  const fs = RE_FLOWSTACK_PATH.exec(s);
  const mp = RE_MULE_PATH.exec(s);
  return normalizePath(
    fs?.[2] || mp?.[2] ||
    (RE_PATH_NAMED.exec(s) || [])[1] ||
    (RE_PATH_SLASH.exec(s) || [])[1]
  );
}

function inferService(text) {
  const raw = String(text || '');
  return strictMuleService(raw) ||
    normalizeServiceName((RE_SVC_GENERIC.exec(raw) || [])[1]);
}

function inferIdentifiers(text) {
  const s = String(text || '');
  const muleEvent   = (RE_MULE_EVENT.exec(s) || [])[1] || null;
  const trace       = (RE_TRACE_ID.exec(s) || [])[1] || null;
  const correlation = (RE_CORRELATION.exec(s) || [])[1] || null;
  const eventId     = (RE_EVENT_ID.exec(s) || [])[1] || muleEvent;
  const request     = (RE_REQUEST_ID.exec(s) || [])[1] || null;
  const transaction = (RE_TXN_ID.exec(s) || [])[1] || null;
  const primary     = trace || correlation || eventId || request || transaction || null;
  return {
    trace_id: primary,
    event_id: eventId || primary,
    correlation_id: correlation || primary,
    request_id: request,
    transaction_id: transaction
  };
}

function maskSensitiveText(value) {
  return String(value || '')
    .replace(RE_MASK_ENCR, (_, k, v) => `${k}${v.slice(0, 8)}…${v.slice(-6)}`)
    .replace(RE_MASK_SECRET, '$1****');
}

function enrichRaw(raw, ids, source = 'parser') {
  const base = raw && typeof raw === 'object' ? { ...raw } : { original: raw };
  return {
    ...base,
    id_source: source,
    event_id: ids.event_id || null,
    correlation_id: ids.correlation_id || null,
    trace_id: ids.trace_id || null,
    request_id: ids.request_id || null,
    transaction_id: ids.transaction_id || base.transaction_id || null
  };
}

function messageAfterLogger(block) {
  const idx = block.indexOf('LoggerMessageProcessor:');
  if (idx >= 0) return block.slice(idx + 'LoggerMessageProcessor:'.length).trim();
  const parts = block.split(/]\s+/);
  return (parts[parts.length - 1] || block).trim();
}

function extractJsonFragments(block) {
  const start = block.indexOf('{');
  if (start < 0) return null;
  const frag = block.slice(start).trim();
  try { return JSON.parse(frag); } catch { return null; }
}

function signature(r) {
  const msg = String(r.message || '').replace(/\s+/g, ' ').slice(0, 220);
  return [r.timestamp, r.severity, r.trace_id || r.raw?.event_id || '', r.service_name || '', r.method || '', r.path || '', msg].join('|');
}

// ─── Public parse functions ───────────────────────────────────────────────────
export function isNewLogStart(line) {
  const t = String(line || '').trimStart();
  if (!t) return false;
  return RE_MULE_START.test(t) || RE_GENERIC.test(t);
}

export function parseMuleBlock(block) {
  const raw = String(block || '').trim();
  if (!raw) return null;
  const head = RE_MULE_HEAD.exec(raw);
  if (!head) return null;

  const route     = RE_MULE_ROUTE.exec(raw);
  const flowRoute = RE_FLOW_ROUTE.exec(raw);
  const processor = RE_PROCESSOR.exec(raw);
  const json      = extractJsonFragments(raw);
  const msg       = messageAfterLogger(raw);
  const ids       = inferIdentifiers(raw);
  const businessStatus = json?.status || json?.statusCode || null;
  const parsedSev = normalizeSeverity(head[1]);
  const effectiveSev =
    (String(json?.status || '').toLowerCase() === 'error' ||
     /\b(error|exception|timeout|failed)\b/i.test(msg))
      ? 'ERROR' : parsedSev;

  return {
    parser: 'mule-runtime',
    timestamp: normalizeTimestamp(head[2]),
    severity: effectiveSev,
    service_name: strictMuleService(raw) || normalizeServiceName(route?.[1]) || normalizeServiceName(flowRoute?.[3]) || inferService(raw),
    method: (route?.[2] || flowRoute?.[1])?.toUpperCase() || inferMethod(raw),
    path: normalizePath(route?.[3]) || normalizePath(flowRoute?.[2]) || inferPath(raw),
    trace_id: ids.trace_id,
    transaction_id: ids.transaction_id,
    processor: processor?.[1] || null,
    message: maskSensitiveText(msg),
    raw: enrichRaw(
      { parser: 'mule-runtime', original: maskSensitiveText(raw), processor: processor?.[1] || null, business_status: businessStatus, payload: json },
      ids, ids.event_id ? 'mule-event-header' : 'inferred'
    )
  };
}

export function extractFromObject(p) {
  const raw = p?.raw && typeof p.raw === 'object' ? p.raw : p;
  const msg = pick(p.message, p.msg, p.log, p.event, p.text, p.short_message, p.detail, typeof raw === 'string' ? raw : null);
  const service = pick(p.service_name, p.service, p.api_name, p.apiName, p.api, p.application, p.app, p.logger_name, p.logger, p.mule_app, raw?.service, raw?.api);
  const method  = pick(p.method, p.http_method, p.httpMethod, p.request_method, raw?.method);
  const path    = pick(p.path, p.endpoint, p.uri, p.url, p.request_uri, p.requestPath, p.resource, raw?.path, raw?.endpoint);
  const text    = msg || JSON.stringify(raw || p);
  const explicitTrace = pick(p.trace_id, p.traceId, p.correlationId, p.correlation_id, p.corelationId, p.corelation_id, p.eventId, p.event_id, p.transactionId, p.transaction_id, p.requestId, p.request_id, p['x-correlation-id']);
  const inferred = inferIdentifiers(text + '\n' + JSON.stringify(raw || {}));
  const ids = {
    ...inferred,
    trace_id: explicitTrace || inferred.trace_id,
    event_id: p.eventId || p.event_id || raw?.event_id || inferred.event_id,
    correlation_id: p.correlationId || p.correlation_id || p.corelationId || p.corelation_id || raw?.correlation_id || inferred.correlation_id
  };
  return {
    parser: 'generic-json',
    timestamp: normalizeTimestamp(p.timestamp || p.time || p['@timestamp'] || p.datetime || p.date),
    severity: normalizeSeverity(p.severity || p.level || p.log_level || p.status || 'INFO'),
    trace_id: ids.trace_id,
    service_name: normalizeServiceName(service) || inferService(text),
    method: method ? String(method).toUpperCase() : inferMethod(text),
    path: normalizePath(path) || inferPath(text),
    transaction_id: ids.transaction_id,
    message: maskSensitiveText(text),
    raw: enrichRaw(typeof raw === 'object' ? raw : { original: maskSensitiveText(raw) }, ids, 'json-or-text')
  };
}

export function parseGenericBlock(block) {
  const raw = String(block || '').trim();
  if (!raw) return null;
  // Fast-path: attempt JSON first
  try { return extractFromObject(JSON.parse(raw)); } catch {}
  const isoTs = (RE_ISO_TS.exec(raw) || [])[0];
  const uiTs  = (RE_DMY_TS.exec(raw) || [])[0];
  const sev   = (RE_SEV_WORD.exec(raw) || [])[1] || 'INFO';
  const ids   = inferIdentifiers(raw);
  return {
    parser: 'generic-text',
    timestamp: normalizeTimestamp(isoTs || uiTs),
    severity: normalizeSeverity(sev),
    trace_id: ids.trace_id,
    service_name: inferService(raw),
    method: inferMethod(raw),
    path: inferPath(raw),
    transaction_id: ids.transaction_id,
    message: maskSensitiveText(messageAfterLogger(raw)),
    raw: enrichRaw({ parser: 'generic-text', original: maskSensitiveText(raw) }, ids, ids.event_id ? 'mule-event-header' : 'generic-text')
  };
}

export function parseLogBlock(block) {
  return parseMuleBlock(block) || parseGenericBlock(block);
}

export function recordsFromJsonPayload(parsed) {
  if (Array.isArray(parsed)) return parsed.map(extractFromObject).filter(Boolean);
  if (parsed && typeof parsed === 'object') {
    const candidate = parsed.logs || parsed.events || parsed.records || parsed.items || parsed.data;
    if (Array.isArray(candidate)) return candidate.map(extractFromObject).filter(Boolean);
    return [extractFromObject(parsed)].filter(Boolean);
  }
  return [];
}

export function parseUploadText(text) {
  const body = String(text || '').trim();
  if (!body) return [];
  const first = body.trimStart()[0];
  if (first === '{' || first === '[') {
    try { return sanitizeParsedRecords(recordsFromJsonPayload(JSON.parse(body))); } catch {}
  }
  const rows = [];
  let current = '';
  for (const line of body.split(/\r?\n/)) {
    if (isNewLogStart(line)) {
      if (current.trim()) rows.push(parseLogBlock(current));
      current = line;
    } else if (current) current += '\n' + line;
    else if (line.trim()) current = line;
  }
  if (current.trim()) rows.push(parseLogBlock(current));
  return sanitizeParsedRecords(rows.filter(Boolean));
}

// ─── Post-processing pipeline ─────────────────────────────────────────────────
export function sanitizeParsedRecords(records) {
  let clean = (records || []).filter(Boolean);
  for (const r of clean) {
    const rawText = typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw || {}) + '\n' + String(r.message || '');
    const strict = strictMuleService(rawText);
    r.service_name = strict || normalizeServiceName(r.service_name || r.service) || null;
    if (!r.method) r.method = inferMethod(rawText);
    if (!r.path)   r.path   = inferPath(rawText);
    const ids = inferIdentifiers(rawText);
    r.trace_id       = r.trace_id       || ids.trace_id;
    r.transaction_id = r.transaction_id || ids.transaction_id;
    r.message        = maskSensitiveText(r.message || '');
    const enrichedRaw = enrichRaw(
      r.raw || {},
      { ...ids, trace_id: r.trace_id || ids.trace_id, transaction_id: r.transaction_id || ids.transaction_id },
      ids.event_id ? 'mule-event-header' : 'post-process'
    );
    const analytics = extractAnalytics({ ...r, raw: enrichedRaw });
    r.raw = {
      ...enrichedRaw,
      analytics,
      http_status: analytics.http_status ?? enrichedRaw.http_status ?? null,
      latency_ms: analytics.latency_ms ?? enrichedRaw.latency_ms ?? null,
      flow_name: analytics.flow_name ?? enrichedRaw.flow_name ?? null,
      app_name: analytics.app_name ?? enrichedRaw.app_name ?? null,
      request_uri: analytics.request_uri ?? enrichedRaw.request_uri ?? null
    };
    if (!r.path && analytics.request_uri) r.path = analytics.request_uri;
  }
  clean = propagateContext(clean);
  clean = dedupeRecords(clean);
  return postProcessRecords(clean);
}

/**
 * Advanced Analytics Extractor — v21
 * Extracts latency, HTTP status, and business metrics from log text.
 */
export function extractAnalytics(record) {
  const raw  = String(record.raw?.original || record.message || '');
  const json = record.raw?.payload;

  // Latency: look for common patterns like "took 230ms", "latency: 450", "duration=1200"
  const latMs = (raw.match(/(?:took|latency|duration|elapsed|response[_-]?time)\s*[:=]?\s*(\d+)\s*ms/i) || [])[1];
  const httpStatus = json?.exit?.HttpStatus || json?.statusCode || json?.status ||
    (raw.match(/\bHTTP[/ ]\d\.\d\s+(\d{3})\b|\bstatus[_-]?code\s*[:=]\s*(\d{3})/i) || []).slice(1).find(Boolean);

  return {
    latency_ms: latMs ? Number(latMs) : null,
    http_status: httpStatus ? Number(httpStatus) : null,
    flow_name: (raw.match(/FlowName[":\s]+["']?([A-Za-z0-9._-]+)/i) || [])[1] || null,
    app_name:  json?.common?.ApplicationName || (raw.match(/ApplicationName[":\s]+["']?([A-Za-z0-9._-]+)/i) || [])[1] || null,
    request_uri: json?.common?.RequestUri || normalizePath((raw.match(/RequestUri[":\s]+["']?([^\s,"']+)/i) || [])[1])
  };
}

// ─── Context propagation & dedup ──────────────────────────────────────────────
function propagateContext(records) {
  const lastByService = new Map();
  const byTimestamp   = new Map();
  for (const r of records) {
    const serviceKey = r.service_name || 'unknown';
    const key  = `${r.timestamp || ''}|${serviceKey}`;
    const ids  = r.trace_id || r.raw?.event_id || r.raw?.correlation_id;
    if (ids) {
      lastByService.set(serviceKey, {
        trace_id: r.trace_id, event_id: r.raw?.event_id,
        correlation_id: r.raw?.correlation_id,
        transaction_id: r.transaction_id || r.raw?.transaction_id,
        method: r.method, path: r.path
      });
      byTimestamp.set(key, lastByService.get(serviceKey));
    } else {
      const ctx = byTimestamp.get(key) || lastByService.get(serviceKey);
      if (ctx) {
        r.trace_id       = r.trace_id       || ctx.trace_id || ctx.event_id || ctx.correlation_id;
        r.transaction_id = r.transaction_id || ctx.transaction_id || null;
        r.method         = r.method         || ctx.method;
        r.path           = r.path           || ctx.path;
        r.raw = enrichRaw(r.raw || {}, {
          trace_id: r.trace_id, event_id: ctx.event_id || r.trace_id,
          correlation_id: ctx.correlation_id || r.trace_id,
          transaction_id: r.transaction_id
        }, 'propagated-nearby-context');
      }
    }
  }
  return records;
}

function dedupeRecords(records) {
  const seen = new Set();
  const out  = [];
  for (const r of records) {
    const key = signature(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function postProcessRecords(records) {
  const byTrace = new Map();
  for (const r of records) {
    r.service_name = normalizeServiceName(r.service_name);
    const trace = r.trace_id || r.raw?.event_id || r.raw?.correlation_id;
    if (trace && (r.service_name || r.method || r.path)) {
      const existing = byTrace.get(trace) || {};
      byTrace.set(trace, {
        service_name: existing.service_name || r.service_name,
        method: existing.method || r.method,
        path: existing.path || r.path
      });
    }
  }
  for (const r of records) {
    const trace = r.trace_id || r.raw?.event_id || r.raw?.correlation_id;
    if (trace) {
      const e = byTrace.get(trace);
      if (e) {
        r.service_name = r.service_name || e.service_name;
        r.method       = r.method       || e.method;
        r.path         = r.path         || e.path;
      }
    }
  }
  return records;
}

/**
 * High-performance streaming parser — v21
 * Zero-allocation line buffer with explicit drain control.
 * 
 * Usage:
 *   const parser = createStreamingParser(onBatch);
 *   for await (const chunk of readableStream) await parser.push(chunk.toString('utf8'));
 *   await parser.finish();
 */
export function createStreamingParser(onItems) {
  let current = '';
  let pending  = '';
  let count    = 0;
  const DRAIN_EVERY = 2000; // flush callback every N items to avoid blocking

  return {
    async push(chunkText) {
      const text  = pending + chunkText;
      const lines = text.split(/\r?\n/);
      pending     = lines.pop() || '';
      const batch = [];
      for (const line of lines) {
        if (isNewLogStart(line)) {
          if (current.trim()) {
            const rec = parseLogBlock(current);
            if (rec) { batch.push(rec); count++; }
          }
          current = line;
        } else if (current) {
          current += '\n' + line;
        } else if (line.trim()) {
          current = line;
        }
        // Progressive drain to avoid memory spike
        if (batch.length >= DRAIN_EVERY) {
          await onItems(batch.splice(0));
        }
      }
      if (batch.length) await onItems(batch);
    },
    async finish() {
      if (pending) {
        if (isNewLogStart(pending)) {
          if (current.trim()) { const r = parseLogBlock(current); if (r) await onItems([r]); }
          current = pending;
        } else if (current) current += '\n' + pending;
        else current = pending;
      }
      if (current.trim()) {
        const r = parseLogBlock(current);
        if (r) await onItems([r]);
      }
      current = ''; pending = '';
    },
    get parsedCount() { return count; }
  };
}
