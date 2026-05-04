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
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/$/, '') || '/';
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
function inferService(text) { return (String(text).match(/(?:service|api|application|app|logger|mule_app)[=: ]+["']?([A-Za-z0-9._-]+)/i) || String(text).match(/\[([A-Za-z0-9._-]+-api)\]/i) || [])[1] || null; }
function inferTrace(text) { return (String(text).match(/(?:trace[_-]?id|correlation[_-]?id|event[_-]?id|event|transaction[_-]?id|request[_-]?id)[:=\s]+["']?([A-Za-z0-9._:-]+)/i) || [])[1] || null; }
function inferTxn(text) { return (String(text).match(/"?transactionId"?\s*[:=]\s*"?([A-Za-z0-9._:-]+)/i) || [])[1] || null; }
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
  const processor = raw.match(/\[processor:\s*([^;\]]+)/i);
  const json = extractJsonFragments(raw)[0] || null;
  const msg = messageAfterLogger(raw);
  const event = (raw.match(/event:\s*([^\]\s;]+)/i) || [])[1] || null;
  const businessStatus = json?.status || json?.statusCode || null;
  const parsedSeverity = normalizeSeverity(head[1]);
  const effectiveSeverity = (String(json?.status || '').toLowerCase() === 'error' || /\berror\b/i.test(msg)) ? 'ERROR' : parsedSeverity;
  return {
    parser: 'mule-runtime',
    timestamp: normalizeTimestamp(head[2]),
    severity: effectiveSeverity,
    service_name: route?.[1] || inferService(raw),
    method: route?.[2]?.toUpperCase() || inferMethod(raw),
    path: normalizePath(route?.[3]) || inferPath(raw),
    trace_id: event || inferTrace(raw),
    transaction_id: inferTxn(raw),
    processor: processor?.[1] || null,
    message: msg,
    raw: { parser: 'mule-runtime', original: raw, processor: processor?.[1] || null, event_id: event, transaction_id: inferTxn(raw), business_status: businessStatus, payload: json }
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
  return {
    parser: 'generic-json',
    timestamp: normalizeTimestamp(p.timestamp || p.time || p['@timestamp'] || p.datetime || p.date),
    severity: normalizeSeverity(p.severity || p.level || p.log_level || p.status || 'INFO'),
    trace_id: trace || inferTrace(text),
    service_name: service || inferService(text),
    method: method ? String(method).toUpperCase() : inferMethod(text),
    path: normalizePath(path) || inferPath(text),
    transaction_id: inferTxn(text),
    message: text,
    raw: typeof raw === 'object' ? raw : { original: raw }
  };
}

export function parseGenericBlock(block) {
  const raw = String(block || '').trim();
  if (!raw) return null;
  try { return extractFromObject(JSON.parse(raw)); } catch {}
  const ts = (raw.match(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[,.]\d{3})?/) || [])[0];
  const sev = (raw.match(/\b(FATAL|ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\b/i) || [])[1] || 'INFO';
  return {
    parser: 'generic-text',
    timestamp: normalizeTimestamp(ts),
    severity: normalizeSeverity(sev),
    trace_id: inferTrace(raw),
    service_name: inferService(raw),
    method: inferMethod(raw),
    path: inferPath(raw),
    transaction_id: inferTxn(raw),
    message: messageAfterLogger(raw),
    raw: { parser: 'generic-text', original: raw }
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
  return rows.filter(Boolean);
}
