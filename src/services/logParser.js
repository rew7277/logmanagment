const SEVERITY = '(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)';
const muleStart = new RegExp(`^${SEVERITY}\\s+\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}[,.]\\d{3}`);
const genericStart = new RegExp(`^(?:${SEVERITY}\\b|\\[?\\d{4}-\\d{2}-\\d{2}[T\\s]\\d{2}:\\d{2}:\\d{2}|\\d{4}-\\d{2}-\\d{2}[T\\s]\\d{2}:\\d{2}:\\d{2}|\\w+=|\\{\\s*\"(?:timestamp|time|level|severity|message|msg|service|api))`, 'i');

function pick(...values) {
  return values.find(v => v !== undefined && v !== null && String(v).trim() !== '');
}
function normalizeSeverity(v) {
  const s = String(v || 'INFO').toUpperCase();
  if (s === 'WARNING') return 'WARN';
  if (['DEBUG','INFO','WARN','ERROR','FATAL'].includes(s)) return s;
  if (s === 'TRACE') return 'DEBUG';
  return 'INFO';
}
function normalizePath(p) {
  if (!p) return null;
  let s = String(p).trim().replace(/\\+/g, '/').replace(/\/+/g, '/');
  s = s.split(':')[0];
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/$/, '') || '/';
}
function normalizeServiceName(v) {
  if (!v) return null;
  let s = String(v).trim().replace(/[\]\)]*$/, '');
  if (!s || s === '-' || s === 'null') return null;
  // Mule XML files, flow names and processor implementation names are NOT services.
  if (/\.xml(?::\d+)?$/i.test(s)) return null;
  if (/subflow|processor|flowstack/i.test(s)) return null;
  if (s.endsWith('-config')) s = s.slice(0, -7);
  return s || null;
}

function strictMuleService(raw) {
  const text = String(raw || '');
  // 1) Prefer the application name inside Mule runtime brackets: [s-gupshup-api].get:\path
  const runtimeApp = (text.match(/\[([A-Za-z0-9._-]+-api)\]\.(?:get|post|put|patch|delete|head|options):/i) || [])[1];
  if (runtimeApp) return normalizeServiceName(runtimeApp);
  // 2) FlowStack format: @ s-gupshup-api:generate-otp.xml:36
  const flowStackApp = (text.match(/@\s*([A-Za-z0-9._-]+-api)\s*:[A-Za-z0-9._-]+\.xml(?::\d+)?/i) || [])[1];
  if (flowStackApp) return normalizeServiceName(flowStackApp);
  // 3) Main flow format: s-gupshup-api-main(...)
  const mainFlowApp = (text.match(/\b([A-Za-z0-9._-]+-api)-main\b/i) || [])[1];
  if (mainFlowApp) return normalizeServiceName(mainFlowApp);
  // 4) Config format: s-gupshup-api-config
  const configApp = (text.match(/\b([A-Za-z0-9._-]+-api)-config\b/i) || [])[1];
  if (configApp) return normalizeServiceName(configApp);
  return null;
}
function normalizeTimestamp(ts) {
  if (!ts) return null;
  const s = String(ts).trim().replace(',', '.');
  const candidate = /^\d{4}-\d{2}-\d{2}\s/.test(s) ? s.replace(' ', 'T') : s;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function inferMethod(text) { return (String(text).match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i) || [])[1]?.toUpperCase() || null; }
function inferPath(text) { return normalizePath((String(text).match(/(?:path|endpoint|uri|url|requestPath|route)[=: ]+["']?(\/[A-Za-z0-9._~:\/?#[\]@!$&'()*+,;=%-]+)/i) || String(text).match(/\s(\/[A-Za-z0-9._~:\/?#[\]@!$&'()*+,;=%-]+)(?:\s|$)/) || [])[1]); }
function inferService(text) {
  const raw = String(text || '');
  const strict = strictMuleService(raw);
  if (strict) return strict;
  const generic = (raw.match(/(?:service|api_name|apiName|application|mule_app)[=: ]+["']?([A-Za-z0-9._-]+)/i) || [])[1];
  return normalizeServiceName(generic);
}
function inferIdentifiers(text) {
  const s = String(text || '');
  const muleEvent = (s.match(/\[processor:\s*[^\]]*?;\s*event:\s*([^\]\s;]+)/i) || s.match(/;\s*event:\s*([^\]\s;]+)/i) || [])[1] || null;
  const trace = (s.match(/(?:trace[_-]?id|traceId)\s*[:=]\s*["']?([A-Za-z0-9._:-]+)/i) || [])[1] || null;
  const correlation = (s.match(/(?:correlation[_-]?id|correlationId|x-correlation-id)\s*[:=]\s*["']?([A-Za-z0-9._:-]+)/i) || [])[1] || null;
  const eventId = (s.match(/(?:event[_-]?id|eventId)\s*[:=]\s*["']?([A-Za-z0-9._:-]+)/i) || [])[1] || muleEvent;
  const request = (s.match(/(?:request[_-]?id|requestId)\s*[:=]\s*["']?([A-Za-z0-9._:-]+)/i) || [])[1] || null;
  const transaction = inferTxn(s);
  const primary = trace || correlation || eventId || request || transaction || null;
  return { trace_id: primary, event_id: eventId || primary, correlation_id: correlation || primary, request_id: request, transaction_id: transaction };
}
function inferTrace(text) { return inferIdentifiers(text).trace_id; }
function inferTxn(text) { return (String(text).match(/"?transactionId"?\s*[:=]\s*"?([A-Za-z0-9._:-]+)/i) || [])[1] || null; }
function maskSensitiveText(value) {
  return String(value || '')
    .replace(/(encrdata=)([A-Za-z0-9._~+/=-]{24,})/gi, (_, k, v) => `${k}${v.slice(0, 8)}…${v.slice(-6)}`)
    .replace(/("?(?:password|secret|token|access[_-]?key|api[_-]?key)"?\s*[:=]\s*"?)([^"\s,}]{6,})/gi, '$1****');
}
function enrichRaw(raw, ids, source='parser') {
  const base = raw && typeof raw === 'object' ? { ...raw } : { original: raw };
  return { ...base, id_source: source, event_id: ids.event_id || null, correlation_id: ids.correlation_id || null, trace_id: ids.trace_id || null, request_id: ids.request_id || null, transaction_id: ids.transaction_id || base.transaction_id || null };
}
function messageAfterLogger(block) {
  const idx = block.indexOf('LoggerMessageProcessor:');
  if (idx >= 0) return block.slice(idx + 'LoggerMessageProcessor:'.length).trim();
  const parts = block.split(/\]\s+/);
  return (parts[parts.length - 1] || block).trim();
}
function extractJsonFragments(block) {
  const out = [];
  const start = block.indexOf('{');
  if (start < 0) return out;
  const frag = block.slice(start).trim();
  try { out.push(JSON.parse(frag)); } catch {}
  return out;
}

export function isNewLogStart(line) {
  const t = String(line || '').trimStart();
  if (!t) return false;
  return muleStart.test(t) || genericStart.test(t);
}

export function parseMuleBlock(block) {
  const raw = String(block || '').trim();
  if (!raw) return null;
  const head = raw.match(new RegExp(`^${SEVERITY}\\s+(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}[,.]\\d{3})`, 'i'));
  if (!head) return null;
  const route = raw.match(/\[([A-Za-z0-9._-]+)\]\.(get|post|put|patch|delete|head|options):([^:\]\s]+)/i);
  const flowRoute = raw.match(/(?:^|[\s(])(get|post|put|patch|delete|head|options):(\\[^:\s)]+):([A-Za-z0-9._-]+)-config/i);
  const processor = raw.match(/\[processor:\s*([^;\]]+)/i);
  const json = extractJsonFragments(raw)[0] || null;
  const msg = messageAfterLogger(raw);
  const ids = inferIdentifiers(raw);
  const businessStatus = json?.status || json?.statusCode || null;
  const parsedSeverity = normalizeSeverity(head[1]);
  const effectiveSeverity = (String(json?.status || '').toLowerCase() === 'error' || /\berror\b/i.test(msg)) ? 'ERROR' : parsedSeverity;
  return {
    parser: 'mule-runtime',
    timestamp: normalizeTimestamp(head[2]),
    severity: effectiveSeverity,
    service_name: strictMuleService(raw) || normalizeServiceName(route?.[1]) || normalizeServiceName(flowRoute?.[3]) || inferService(raw),
    method: route?.[2]?.toUpperCase() || flowRoute?.[1]?.toUpperCase() || inferMethod(raw),
    path: normalizePath(route?.[3]) || normalizePath(flowRoute?.[2]) || inferPath(raw),
    trace_id: ids.trace_id,
    transaction_id: ids.transaction_id,
    processor: processor?.[1] || null,
    message: maskSensitiveText(msg),
    raw: enrichRaw({ parser: 'mule-runtime', original: maskSensitiveText(raw), processor: processor?.[1] || null, business_status: businessStatus, payload: json }, ids, ids.event_id ? 'mule-event-header' : 'inferred')
  };
}

export function extractFromObject(p) {
  const raw = p?.raw && typeof p.raw === 'object' ? p.raw : p;
  const msg = pick(p.message, p.msg, p.log, p.event, p.text, p.short_message, p.detail, typeof raw === 'string' ? raw : null);
  const service = pick(p.service_name, p.service, p.api_name, p.apiName, p.api, p.application, p.app, p.logger_name, p.logger, p.mule_app, p.flow, p.flowName, raw?.service, raw?.api);
  const method = pick(p.method, p.http_method, p.httpMethod, p.request_method, raw?.method);
  const path = pick(p.path, p.endpoint, p.uri, p.url, p.request_uri, p.requestPath, p.resource, raw?.path, raw?.endpoint);
  const trace = pick(p.trace_id, p.traceId, p.correlationId, p.correlation_id, p.eventId, p.event_id, p.transactionId, p.transaction_id, p.requestId, p.request_id, p['x-correlation-id']);
  const text = msg || JSON.stringify(raw || p);
  const ids = { ...inferIdentifiers(text), trace_id: trace || inferTrace(text), event_id: p.eventId || p.event_id || raw?.event_id || inferIdentifiers(text).event_id, correlation_id: p.correlationId || p.correlation_id || raw?.correlation_id || inferIdentifiers(text).correlation_id };
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
  try { return extractFromObject(JSON.parse(raw)); } catch {}
  const ts = (raw.match(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[,.]\d{3})?/) || [])[0];
  const sev = (raw.match(/\b(FATAL|ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\b/i) || [])[1] || 'INFO';
  const ids = inferIdentifiers(raw);
  return {
    parser: 'generic-text',
    timestamp: normalizeTimestamp(ts),
    severity: normalizeSeverity(sev),
    trace_id: ids.trace_id,
    service_name: inferService(raw),
    method: inferMethod(raw),
    path: inferPath(raw),
    transaction_id: ids.transaction_id,
    message: maskSensitiveText(messageAfterLogger(raw)),
    raw: enrichRaw({ parser: 'generic-text', original: maskSensitiveText(raw) }, ids, 'generic-text')
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
    try { return recordsFromJsonPayload(JSON.parse(body)); } catch {}
  }
  const rows = [];
  let current = '';
  for (const line of body.split(/\r?\n/)) {
    if (isNewLogStart(line)) {
      if (current.trim()) rows.push(parseLogBlock(current));
      current = line;
    } else if (current) {
      current += '\n' + line;
    } else if (line.trim()) {
      current = line;
    }
  }
  if (current.trim()) rows.push(parseLogBlock(current));
  return sanitizeParsedRecords(rows.filter(Boolean));
}

export function sanitizeParsedRecords(records) {
  const clean = (records || []).filter(Boolean);
  for (const r of clean) {
    const rawText = typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw || {}) + '\n' + String(r.message || '');
    const strict = strictMuleService(rawText);
    const normalized = normalizeServiceName(r.service_name || r.service);
    r.service_name = strict || normalized || null;
    if (!r.method) r.method = inferMethod(rawText);
    if (!r.path) r.path = inferPath(rawText);
    const ids = inferIdentifiers(rawText);
    r.trace_id = r.trace_id || ids.trace_id;
    r.transaction_id = r.transaction_id || ids.transaction_id;
    r.message = maskSensitiveText(r.message || '');
    r.raw = enrichRaw(r.raw || {}, { ...ids, trace_id: r.trace_id || ids.trace_id, transaction_id: r.transaction_id || ids.transaction_id }, ids.event_id ? 'mule-event-header' : 'post-process');
  }
  return postProcessRecords(clean);
}

function postProcessRecords(records) {
  const byTrace = new Map();
  for (const r of records) {
    r.service_name = normalizeServiceName(r.service_name);
    if (r.trace_id && r.service_name) {
      const existing = byTrace.get(r.trace_id) || {};
      byTrace.set(r.trace_id, {
        service_name: existing.service_name || r.service_name,
        method: existing.method || r.method,
        path: existing.path || r.path
      });
    }
  }
  for (const r of records) {
    if (r.trace_id) {
      const e = byTrace.get(r.trace_id);
      if (e) {
        r.service_name = r.service_name || e.service_name;
        r.method = r.method || e.method;
        r.path = r.path || e.path;
      }
    }
  }
  return records;
}
