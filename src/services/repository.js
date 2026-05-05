import { query, hasDatabase, withTransaction } from '../db/pool.js';
import { sanitizeParsedRecords } from './logParser.js';

const fallback = {
  workspaces: [{ id: 'demo-workspace', name: 'FSBL Production Ops', slug: 'fsbl-prod-ops' }],
  environments: [
    { id: 'env-prod', name: 'PROD', display_name: 'PROD', health_score: 0, status: 'observed' },
    { id: 'env-uat',  name: 'UAT',  display_name: 'UAT',  health_score: 0, status: 'observed' },
    { id: 'env-dev',  name: 'DEV',  display_name: 'DEV',  health_score: 0, status: 'observed' },
    { id: 'env-dr',   name: 'DR',   display_name: 'DR',   health_score: 0, status: 'observed' }
  ],
  logs: [],
  ingestion: [],
  configs: new Map(),
  maskingRules: new Map()
};

function envId(environmentName) { return `env-${String(environmentName || 'PROD').toLowerCase()}`; }
function matchesRange(ts, range='24h') {
  const t = new Date(ts || Date.now()).getTime();
  const now = Date.now();
  const ms = range === '1h' ? 3600_000 : range === '7d' ? 7*86400_000 : range === '30d' ? 30*86400_000 : 24*3600_000;
  return t >= now - ms;
}
function fallbackLogs(environmentName, f={}) {
  const page = Math.max(Number(f.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(f.limit || f.page_size || 50), 10), 500);
  let rows = fallback.logs.filter(l => l.environment_name === environmentName);
  if (f.range && f.range !== 'custom' && f.range !== 'all' && !f.from && !f.to) rows = rows.filter(l => matchesRange(l.timestamp, f.range));
  if (f.from) rows = rows.filter(l => new Date(l.timestamp) >= new Date(f.from));
  if (f.to) rows = rows.filter(l => new Date(l.timestamp) <= new Date(f.to));
  if (f.severity) rows = rows.filter(l => l.severity === String(f.severity).toUpperCase());
  if (f.service) rows = rows.filter(l => String(l.service_name || '').toLowerCase().includes(String(f.service).toLowerCase()));
  if (f.path) rows = rows.filter(l => String(l.path || '').toLowerCase().includes(String(f.path).toLowerCase()));
  if (f.trace_id) rows = rows.filter(l => [l.trace_id,l.raw?.event_id,l.raw?.correlation_id,l.raw?.transaction_id].some(v => String(v || '').toLowerCase().includes(String(f.trace_id).toLowerCase())));
  if (f.q) {
    const q = String(f.q).toLowerCase();
    rows = rows.filter(l => [l.message,l.trace_id,l.raw?.event_id,l.raw?.correlation_id,l.raw?.transaction_id,l.service_name,l.path,l.method].some(v => String(v||'').toLowerCase().includes(q)));
  }
  rows = rows.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  const total = rows.length;
  return { items: rows.slice((page-1)*pageSize, page*pageSize), total, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
}
function fallbackServices(environmentName) {
  const map = new Map();
  for (const l of fallback.logs.filter(x => x.environment_name === environmentName)) {
    const name = l.service_name || 'unknown-service';
    if (!map.has(name)) map.set(name, { id:name, name, owner:'Not mapped', runtime_version:'-', app_version:'-', status:'observed', total:0, errors:0 });
    const s = map.get(name); s.total++; if (['ERROR','FATAL'].includes(l.severity)) s.errors++;
  }
  return [...map.values()].map(s => ({...s, error_rate: s.total ? (100*s.errors/s.total).toFixed(2) : 0, p95_latency_ms:0, health_score: Math.max(0, 100 - s.errors*10)}));
}
function fallbackEndpoints(environmentName) {
  const map = new Map();
  for (const l of fallback.logs.filter(x => x.environment_name === environmentName && x.path)) {
    const key = `${l.service_name||'unknown'}|${l.method||'-'}|${l.path}`;
    if (!map.has(key)) map.set(key, { id:key, service_name:l.service_name||'unknown-service', method:l.method||'-', path:l.path, status:'observed', calls_per_hour:0, errors:0 });
    const e = map.get(key); e.calls_per_hour++; if (['ERROR','FATAL'].includes(l.severity)) e.errors++;
  }
  return [...map.values()].map(e => ({...e, error_rate: e.calls_per_hour ? (100*e.errors/e.calls_per_hour).toFixed(2) : 0, p95_latency_ms:0, backend_ms:0}));
}



async function ensureWorkspaceEnvironment(workspaceSlug='fsbl-prod-ops', environmentName='PROD') {
  const org = await query(`INSERT INTO organizations(name, slug) VALUES($1,$2)
    ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`, ['Default Organization', 'default-org']);
  const wsName = workspaceSlug === 'fsbl-prod-ops' ? 'FSBL Production Ops' : workspaceSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const ws = await query(`INSERT INTO workspaces(org_id, name, slug) VALUES($1,$2,$3)
    ON CONFLICT(org_id, slug) DO UPDATE SET name=EXCLUDED.name RETURNING id, org_id`, [org.rows[0].id, wsName, workspaceSlug]);
  const env = await query(`INSERT INTO environments(workspace_id, name, display_name, health_score, status)
    VALUES($1,$2,$2,0,'observed')
    ON CONFLICT(workspace_id, name) DO UPDATE SET display_name=EXCLUDED.display_name
    RETURNING *`, [ws.rows[0].id, environmentName]);
  return { ...env.rows[0], workspace_slug: workspaceSlug, workspace_name: wsName, org_id: ws.rows[0].org_id, workspace_id: ws.rows[0].id };
}

export async function getWorkspaces() {
  if (!hasDatabase) return fallback.workspaces;
  let result = await query(`SELECT id, name, slug FROM workspaces ORDER BY created_at ASC`);
  if (result.rows.length === 0) {
    await ensureWorkspaceEnvironment('fsbl-prod-ops', 'PROD');
    result = await query(`SELECT id, name, slug FROM workspaces ORDER BY created_at ASC`);
  }
  return result.rows;
}

export async function getEnvironment(workspaceSlug, environmentName) {
  if (!hasDatabase) return fallback.environments.find((e) => e.name === environmentName) || fallback.environments[0];
  const result = await query(
    `SELECT e.*, w.slug workspace_slug, w.name workspace_name, o.id org_id, w.id workspace_id
     FROM environments e
     JOIN workspaces w ON w.id = e.workspace_id
     JOIN organizations o ON o.id = w.org_id
     WHERE w.slug=$1 AND e.name=$2`,
    [workspaceSlug, environmentName]
  );
  return result.rows[0] || ensureWorkspaceEnvironment(workspaceSlug, environmentName);
}

export async function getOverview(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return null;

  if (!hasDatabase) {
    return {
      environment: env,
      metrics: {
        logs_ingested: 0,
        error_rate: 0,
        p95_latency_ms: 0,
        active_alerts: 0,
        services: 0,
        endpoints: 0,
        masking_coverage: 0
      }
    };
  }

  const [logStats, alertStats, serviceStats, endpointStats, traceStats] = await Promise.all([
    query(
      `SELECT count(*)::int logs_ingested,
              COALESCE(100.0 * count(*) FILTER (WHERE severity IN ('ERROR','FATAL')) / NULLIF(count(*),0),0)::numeric(7,2) error_rate
       FROM log_events WHERE environment_id=$1`,
      [env.id]
    ),
    query(`SELECT count(*)::int active_alerts FROM alerts WHERE environment_id=$1 AND status='open'`, [env.id]),
    query(`SELECT count(*)::int services FROM services WHERE environment_id=$1 AND name !~* '\\.xml(:[0-9]+)?$'`, [env.id]),
    query(
      `SELECT count(*)::int endpoints FROM endpoints ep JOIN services s ON s.id=ep.service_id WHERE s.environment_id=$1 AND s.name !~* '\\.xml(:[0-9]+)?$'`,
      [env.id]
    ),
    query(
      `SELECT COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),0)::int p95_latency_ms
       FROM traces WHERE environment_id=$1 AND started_at >= now() - interval '24 hours'`,
      [env.id]
    )
  ]);

  return {
    environment: env,
    metrics: {
      logs_ingested: logStats.rows[0].logs_ingested,
      error_rate: Number(logStats.rows[0].error_rate),
      p95_latency_ms: traceStats.rows[0].p95_latency_ms || 0,
      active_alerts: alertStats.rows[0].active_alerts,
      services: serviceStats.rows[0].services,
      endpoints: endpointStats.rows[0].endpoints,
      masking_coverage: 0
    }
  };
}

export async function getServices(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  if (!hasDatabase) return fallbackServices(environmentName);
  const result = await query(
    `SELECT s.id, s.name, s.owner, s.runtime_version, s.app_version, s.status,
            GREATEST(0, LEAST(100,
              100 - (COALESCE(ls.error_rate,0) * 2) - (GREATEST(COALESCE(ts.p95_latency_ms,0) - 500,0) / 100)
            ))::int AS health_score,
            COALESCE(ls.total_logs,0)::int AS calls_total,
            COALESCE(ls.error_rate,0)::numeric(7,2) AS error_rate,
            NULLIF(COALESCE(ts.p95_latency_ms,0),0)::int AS p95_latency_ms,
            COALESCE(prev.calls_24h,0)::int AS calls_24h,
            COALESCE(prev.prev_calls_24h,0)::int AS previous_calls_24h,
            CASE WHEN COALESCE(prev.prev_calls_24h,0)=0 THEN NULL ELSE ROUND(100.0*(prev.calls_24h-prev.prev_calls_24h)/NULLIF(prev.prev_calls_24h,0),2) END AS traffic_delta_pct,
            COALESCE(err.top_errors,'[]'::json) AS top_errors,
            last_seen.last_seen,
            COALESCE(v.volume_7d,'[]'::json) AS volume_7d
     FROM services s
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS total_logs,
              COALESCE(100.0 * count(*) FILTER (WHERE le.severity IN ('ERROR','FATAL')) / NULLIF(count(*),0),0)::numeric(7,2) AS error_rate
       FROM log_events le
       WHERE le.service_id=s.id
     ) ls ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),0)::int AS p95_latency_ms
       FROM traces t
       WHERE t.service_id=s.id AND t.started_at >= now() - interval '24 hours' AND t.latency_ms > 0
     ) ts ON true
     LEFT JOIN LATERAL (
       SELECT count(*) FILTER (WHERE le.timestamp >= now() - interval '24 hours')::int calls_24h,
              count(*) FILTER (WHERE le.timestamp < now() - interval '24 hours' AND le.timestamp >= now() - interval '48 hours')::int prev_calls_24h
       FROM log_events le WHERE le.service_id=s.id
     ) prev ON true
     LEFT JOIN LATERAL (
       SELECT max(le.timestamp) AS last_seen FROM log_events le WHERE le.service_id=s.id
     ) last_seen ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('signature', signature, 'count', cnt) ORDER BY cnt DESC) AS top_errors
       FROM (
         SELECT COALESCE(NULLIF(le.raw->>'error_type',''), NULLIF(le.raw->>'exception',''), NULLIF(le.raw->'payload'->>'errorType',''), NULLIF(le.raw->'analytics'->>'http_status',''), regexp_replace(left(le.message, 180), '[0-9a-fA-F-]{8,}', ':id', 'g'), 'Unknown error') AS signature, count(*)::int cnt
         FROM log_events le WHERE le.service_id=s.id AND le.severity IN ('ERROR','FATAL')
         GROUP BY signature ORDER BY cnt DESC LIMIT 3
       ) e
     ) err ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('day', day::date, 'count', cnt) ORDER BY day) AS volume_7d
       FROM (
         SELECT d.day, count(le.id)::int AS cnt
         FROM generate_series(current_date - interval '6 days', current_date, interval '1 day') d(day)
         LEFT JOIN log_events le ON le.service_id=s.id AND le.timestamp >= d.day AND le.timestamp < d.day + interval '1 day'
         GROUP BY d.day
       ) x
     ) v ON true
     WHERE s.environment_id=$1 AND s.name !~* '\.xml(:[0-9]+)?$'
     ORDER BY health_score ASC, s.name ASC`,
    [env.id]
  );
  return result.rows;
}

export async function getEndpoints(workspaceSlug, environmentName, serviceName = '') {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  if (!hasDatabase) {
    const rows = fallbackEndpoints(environmentName);
    return serviceName ? rows.filter(r => r.service_name === serviceName) : rows;
  }
  const values = [env.id];
  const serviceClause = serviceName ? ` AND s.name=$2` : '';
  if (serviceName) values.push(serviceName);
  const result = await query(
    `SELECT ep.id, ep.method, ep.path, ep.status, s.name service_name,
            COALESCE(ls.calls_total,0)::int AS calls_total,
            COALESCE(ls.error_rate,0)::numeric(7,2) AS error_rate,
            NULLIF(COALESCE(ts.p95_latency_ms,0),0)::int AS p95_latency_ms,
            COALESCE(ts.backend_ms,0)::int AS backend_ms,
            last_seen.last_seen,
            COALESCE(err.top_errors,'[]'::json) AS top_errors
     FROM endpoints ep
     JOIN services s ON s.id=ep.service_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS calls_total,
              COALESCE(100.0 * count(*) FILTER (WHERE le.severity IN ('ERROR','FATAL')) / NULLIF(count(*),0),0)::numeric(7,2) AS error_rate
       FROM log_events le
       WHERE le.endpoint_id=ep.id
     ) ls ON true
     LEFT JOIN LATERAL (
       SELECT max(le.timestamp) AS last_seen FROM log_events le WHERE le.endpoint_id=ep.id
     ) last_seen ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('signature', signature, 'count', cnt) ORDER BY cnt DESC) AS top_errors
       FROM (
         SELECT COALESCE(NULLIF(le.raw->>'error_type',''), NULLIF(le.raw->>'exception',''), NULLIF(le.raw->'payload'->>'errorType',''), NULLIF(le.raw->'analytics'->>'http_status',''), regexp_replace(left(le.message, 180), '[0-9a-fA-F-]{8,}', ':id', 'g'), 'Unknown error') AS signature, count(*)::int cnt
         FROM log_events le WHERE le.endpoint_id=ep.id AND le.severity IN ('ERROR','FATAL')
         GROUP BY signature ORDER BY cnt DESC LIMIT 3
       ) e
     ) err ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),0)::int AS p95_latency_ms,
              COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY CASE WHEN (meta->>'backend_ms') ~ '^[0-9]+$' THEN NULLIF((meta->>'backend_ms')::int,0) END),0)::int AS backend_ms
       FROM traces t
       WHERE t.endpoint_id=ep.id AND t.started_at >= now() - interval '24 hours' AND t.latency_ms > 0
     ) ts ON true
     WHERE s.environment_id=$1 AND s.name !~* '\.xml(:[0-9]+)?$'${serviceClause}
     ORDER BY s.name, ep.method, ep.path`,
    values
  );
  return result.rows;
}

export async function getLogs(workspaceSlug, environmentName, limit = 50, filters = '') {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return { items: [], total: 0, page: 1, page_size: limit, total_pages: 0 };
  const f = typeof filters === 'string' ? { q: filters } : (filters || {});
  const page = Math.max(Number(f.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(limit || 50), 10), 500);
  const offset = (page - 1) * pageSize;
  if (!hasDatabase) return fallbackLogs(environmentName, { ...f, page, page_size: pageSize, limit: pageSize });

  const values = [env.id];
  const where = ['le.environment_id=$1'];
  const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
  const q = String(f.q || '').trim();
  if (q) {
    const base = values.length;
    values.push(q, q, q, q, q, q, q, q);
    where.push(`(le.message ILIKE '%' || $${base+1} || '%' OR le.trace_id ILIKE '%' || $${base+2} || '%' OR s.name ILIKE '%' || $${base+3} || '%' OR ep.path ILIKE '%' || $${base+4} || '%' OR le.raw->>'event_id' ILIKE '%' || $${base+5} || '%' OR le.raw->>'correlation_id' ILIKE '%' || $${base+6} || '%' OR le.raw->>'transaction_id' ILIKE '%' || $${base+7} || '%' OR to_tsvector('simple', le.message) @@ plainto_tsquery('simple', $${base+8}))`);
  }
  if (f.severity) add('le.severity = ?', String(f.severity).toUpperCase());
  if (f.service) add(`s.name ILIKE '%' || ? || '%'`, String(f.service));
  if (f.path) add(`ep.path ILIKE '%' || ? || '%'`, String(f.path));
  if (f.upload_id) add('le.upload_id = ?', String(f.upload_id));
  if (f.http_status) {
    const base = values.length;
    values.push(String(f.http_status), String(f.http_status));
    where.push(`(le.raw->>'http_status' = $${base+1} OR le.raw->'analytics'->>'http_status' = $${base+2})`);
  }
  if (f.flow_name) {
    const base = values.length;
    values.push(String(f.flow_name), String(f.flow_name), String(f.flow_name));
    where.push(`(le.raw->>'flow_name' ILIKE '%' || $${base+1} || '%' OR le.raw->'analytics'->>'flow_name' ILIKE '%' || $${base+2} || '%' OR le.raw->'payload'->'entry'->>'FlowName' ILIKE '%' || $${base+3} || '%')`);
  }
  if (f.trace_id) {
    const base = values.length;
    values.push(String(f.trace_id), String(f.trace_id), String(f.trace_id), String(f.trace_id));
    where.push(`(le.trace_id ILIKE '%' || $${base+1} || '%' OR le.raw->>'event_id' ILIKE '%' || $${base+2} || '%' OR le.raw->>'correlation_id' ILIKE '%' || $${base+3} || '%' OR le.raw->>'transaction_id' ILIKE '%' || $${base+4} || '%')`);
  }
  if (f.from) add('le.timestamp >= ?', f.from);
  if (f.to) add('le.timestamp <= ?', f.to);
  if (!f.from && !f.to && f.range && f.range !== 'custom' && f.range !== 'all') {
    const interval = f.range === '1h' ? '1 hour' : f.range === '7d' ? '7 days' : f.range === '30d' ? '30 days' : '24 hours';
    where.push(`le.timestamp >= now() - interval '${interval}'`);
  }

  const whereSql = where.join(' AND ');
  const dataValues = [...values, pageSize, offset];
  const limitParam = values.length + 1;
  const offsetParam = values.length + 2;

  const [countResult, dataResult] = await Promise.all([
    query(
      `SELECT count(*)::int AS total
       FROM log_events le
       LEFT JOIN services s ON s.id=le.service_id
       LEFT JOIN endpoints ep ON ep.id=le.endpoint_id
       WHERE ${whereSql}`,
      values
    ),
    query(
      `SELECT le.id, le.upload_id, le.timestamp, le.severity, le.trace_id, le.message, le.raw,
              CASE WHEN s.name ~* '\.xml(:[0-9]+)?$' THEN NULL ELSE s.name END service_name, ep.method, ep.path,
              COALESCE(CASE WHEN (le.raw->>'latency_ms') ~ '^[0-9]+$' THEN (le.raw->>'latency_ms')::int END, CASE WHEN (le.raw->'analytics'->>'latency_ms') ~ '^[0-9]+$' THEN (le.raw->'analytics'->>'latency_ms')::int END, 0) AS latency_ms,
              COALESCE(le.raw->>'http_status', le.raw->'analytics'->>'http_status') AS http_status
       FROM log_events le
       LEFT JOIN services s ON s.id=le.service_id
       LEFT JOIN endpoints ep ON ep.id=le.endpoint_id
       WHERE ${whereSql}
       ORDER BY le.timestamp DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      dataValues
    )
  ]);
  const total = countResult.rows[0]?.total || 0;
  return { items: dataResult.rows, total, page, page_size: pageSize, total_pages: Math.ceil(total / pageSize) };
}


async function upsertTraceFromLog(client, env, serviceId, endpointId, payload) {
  const traceId = payload.trace_id || payload.raw?.trace_id || payload.raw?.event_id || payload.raw?.correlation_id;
  if (!traceId) return;
  const status = ['ERROR','FATAL'].includes(String(payload.severity || '').toUpperCase()) ? 'error' : 'success';
  await client.query(
    `INSERT INTO traces(environment_id, service_id, endpoint_id, trace_id, status, latency_ms, started_at, meta)
     VALUES($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$8::int,COALESCE($6::timestamptz, now()),$7::jsonb)
     ON CONFLICT(environment_id, trace_id) DO UPDATE SET
       service_id=COALESCE(traces.service_id, EXCLUDED.service_id),
       endpoint_id=COALESCE(traces.endpoint_id, EXCLUDED.endpoint_id),
       status=CASE WHEN traces.status='error' OR EXCLUDED.status='error' THEN 'error' ELSE EXCLUDED.status END,
       started_at=LEAST(traces.started_at, EXCLUDED.started_at),
       meta=traces.meta || EXCLUDED.meta`,
    [env.id, serviceId, endpointId, traceId, status, payload.timestamp || null, JSON.stringify({
      event_id: payload.raw?.event_id || traceId,
      correlation_id: payload.raw?.correlation_id || traceId,
      transaction_id: payload.transaction_id || payload.raw?.transaction_id || null,
      service_name: payload.service_name || payload.service || null,
      method: payload.method || null,
      path: payload.path || payload.endpoint || null,
      http_status: getHttpStatus(payload),
      latency_ms: getLatencyMs(payload)
    }), getLatencyMs(payload)]
  );
}

// ─── Single log insert ────────────────────────────────────────────────────────

/**
 * Internal: insert one log row using an existing DB client (for transaction use).
 */
async function _insertLog(client, env, payload) {
  const serviceName = payload.service_name || payload.service || null;
  const method      = payload.method || null;
  const logPath     = payload.path || payload.endpoint || null;

  let serviceId  = null;
  let endpointId = null;

  if (serviceName) {
    const svc = await client.query(
      `INSERT INTO services(environment_id, name, status)
       VALUES($1,$2,'healthy')
       ON CONFLICT(environment_id, name) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [env.id, serviceName]
    );
    serviceId = svc.rows[0].id;
  }

  if (serviceId && method && logPath) {
    const ep = await client.query(
      `INSERT INTO endpoints(service_id, method, path, status)
       VALUES($1,$2,$3,'healthy')
       ON CONFLICT(service_id, method, path) DO UPDATE SET path=EXCLUDED.path
       RETURNING id`,
      [serviceId, method.toUpperCase(), logPath]
    );
    endpointId = ep.rows[0].id;
  }

  const result = await client.query(
    `INSERT INTO log_events(org_id, workspace_id, environment_id, service_id, endpoint_id, timestamp, severity, trace_id, message, raw)
     VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,COALESCE($6::timestamptz, now()),$7::text,$8::text,$9::text,$10::jsonb)
     RETURNING *`,
    [
      env.org_id, env.workspace_id, env.id,
      serviceId, endpointId,
      payload.timestamp || null,
      String(payload.severity || 'INFO').toUpperCase(),
      payload.trace_id || null,
      payload.message || String(payload.raw || ''),
      payload
    ]
  );
  await upsertTraceFromLog(client, env, serviceId, endpointId, payload);
  return result.rows[0];
}

export async function createLog(workspaceSlug, environmentName, payload) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) throw new Error('Environment not found');
  if (!hasDatabase) return { id: crypto.randomUUID(), ...payload };

  // Use pool directly (single-statement path doesn't need a transaction)
  return _insertLog({ query: (...args) => query(...args) }, env, payload);
}

/**
 * FIX: Old version called createLog() per row → getEnvironment() was called N
 * times (one per log). Now we look up the environment ONCE and wrap all inserts
 * in a single SERIALIZABLE transaction so bulk uploads are atomic.
 */

function safeText(value, fallbackValue = null) {
  if (value === undefined || value === null) return fallbackValue;
  const text = String(value);
  return text.length ? text : fallbackValue;
}

function safeUpper(value, fallbackValue = 'INFO') {
  return String(value || fallbackValue).toUpperCase();
}

function safeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return JSON.stringify({ message: 'raw payload could not be serialized' });
  }
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function getLatencyMs(payload = {}) {
  return numberOrNull(
    payload.latency_ms ?? payload.response_time_ms ?? payload.duration_ms ?? payload.elapsed_ms ??
    payload.raw?.latency_ms ?? payload.raw?.response_time_ms ?? payload.raw?.duration_ms ?? payload.raw?.elapsed_ms ??
    payload.raw?.analytics?.latency_ms
  ) || 0;
}

function getHttpStatus(payload = {}) {
  return numberOrNull(payload.http_status ?? payload.status_code ?? payload.statusCode ?? payload.raw?.http_status ?? payload.raw?.analytics?.http_status);
}

function signatureSql(alias = 'le') {
  return `COALESCE(NULLIF(${alias}.raw->>'error_type',''), NULLIF(${alias}.raw->>'exception',''), NULLIF(${alias}.raw->'payload'->>'errorType',''), NULLIF(${alias}.raw->'analytics'->>'http_status',''), regexp_replace(left(${alias}.message, 180), '[0-9a-fA-F-]{8,}', ':id', 'g'), 'Unknown error')`;
}

function applyMaskingRulesToPayload(payload, rules = []) {
  if (!rules.length) return payload;
  let text = JSON.stringify(payload ?? {});
  let message = String(payload?.message ?? '');
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const replacement = rule.replacement || '[MASKED]';
    try {
      if (rule.pattern) {
        const re = new RegExp(rule.pattern, 'gi');
        text = text.replace(re, replacement);
        message = message.replace(re, replacement);
      } else if (rule.field_name) {
        const f = String(rule.field_name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`("${f}"\\s*:\\s*")([^"]+)(")`, 'gi');
        text = text.replace(re, `$1${replacement}$3`);
      }
    } catch { /* ignore invalid business regex instead of breaking ingestion */ }
  }
  try { return { ...JSON.parse(text), message: message || payload.message }; } catch { return { ...payload, message }; }
}

async function loadMaskingRulesForEnv(env) {
  const defaults = [
    { field_name:'password', pattern:'password\\s*[:=]\\s*[^,\\s]+', replacement:'password=[MASKED]', enabled:true },
    { field_name:'authorization', pattern:'authorization\\s*[:=]\\s*bearer\\s+[^,\\s]+', replacement:'Authorization: Bearer [MASKED]', enabled:true },
    { field_name:'token', pattern:'(token|secret|api[_-]?key)\\s*[:=]\\s*[^,\\s]+', replacement:'$1=[MASKED]', enabled:true }
  ];
  if (!hasDatabase || !env?.id) return defaults;
  const rows = await query(`SELECT field_name, pattern, replacement, enabled FROM masking_rules WHERE environment_id=$1 AND enabled=true`, [env.id]).catch(() => ({ rows: [] }));
  return rows.rows.length ? rows.rows : defaults;
}

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const LOG_INSERT_CHUNK_SIZE = Number(process.env.LOG_INSERT_CHUNK_SIZE || 500);
const TRACE_INSERT_CHUNK_SIZE = Number(process.env.TRACE_INSERT_CHUNK_SIZE || 500);

export async function bulkCreateLogs(workspaceSlug, environmentName, logs, options = {}) {
  if (!Array.isArray(logs) || logs.length === 0) return [];
  logs = sanitizeParsedRecords(logs).filter(l => l && (l.message || l.raw));
  if (!logs.length) return [];

  if (!hasDatabase) {
    const created = logs.map((l, i) => ({
      id: `local-${Date.now()}-${i}`,
      environment_name: environmentName,
      timestamp: l.timestamp || new Date().toISOString(),
      severity: safeUpper(l.severity),
      trace_id: l.trace_id || l.event_id || l.correlation_id || l.raw?.event_id || null,
      service_name: l.service_name || l.service || null,
      method: l.method ? String(l.method).toUpperCase() : null,
      path: l.path || l.endpoint || null,
      message: l.message || String(l.raw || ''),
      raw: l.raw || l,
      upload_id: options.uploadId || null
    }));
    fallback.logs.push(...created);
    if (!options.uploadId) {
      fallback.ingestion.unshift({
        id:`local-upload-${Date.now()}`,
        source_type:'UPLOAD',
        source_name:options.sourceName || 'browser/API upload',
        status:'completed',
        accepted_count:created.length,
        rejected_count:0,
        parser_errors:0,
        meta:{bytes:options.bytes||0},
        created_at:new Date().toISOString()
      });
    }
    return created;
  }

  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) throw new Error('Environment not found');
  const maskingRules = await loadMaskingRulesForEnv(env);
  logs = logs.map(l => applyMaskingRulesToPayload(l, maskingRules));

  return withTransaction(async (client) => {
    const serviceCache = new Map();
    const endpointCache = new Map();

    const serviceNames = [...new Set(logs
      .map(l => safeText(l.service_name || l.service))
      .filter(v => v && !String(v).toLowerCase().endsWith('.xml'))
    )];

    for (const name of serviceNames) {
      const svc = await client.query(
        `INSERT INTO services(environment_id, name, status)
         VALUES($1::uuid,$2::text,'observed')
         ON CONFLICT(environment_id, name) DO UPDATE SET name=EXCLUDED.name
         RETURNING id`,
        [env.id, name]
      );
      serviceCache.set(name, svc.rows[0].id);
    }

    const endpointKeys = [];
    for (const log of logs) {
      const serviceName = safeText(log.service_name || log.service);
      if (!serviceName || serviceName.toLowerCase().endsWith('.xml')) continue;
      const serviceId = serviceCache.get(serviceName);
      const method = log.method ? String(log.method).toUpperCase() : null;
      const logPath = safeText(log.path || log.endpoint);
      if (serviceId && method && logPath) {
        const key = `${serviceId}|${method}|${logPath}`;
        if (!endpointCache.has(key)) {
          endpointCache.set(key, 'pending');
          endpointKeys.push({ key, serviceId, method, path: logPath });
        }
      }
    }

    for (const epItem of endpointKeys) {
      const ep = await client.query(
        `INSERT INTO endpoints(service_id, method, path, status)
         VALUES($1::uuid,$2::text,$3::text,'observed')
         ON CONFLICT(service_id, method, path) DO UPDATE SET path=EXCLUDED.path
         RETURNING id`,
        [epItem.serviceId, epItem.method, epItem.path]
      );
      endpointCache.set(epItem.key, ep.rows[0].id);
    }

    const insertedRows = [];

    for (const batch of chunkArray(logs, LOG_INSERT_CHUNK_SIZE)) {
      const values = [];
      const placeholders = [];

      batch.forEach((payload, idx) => {
        const rawServiceName = safeText(payload.service_name || payload.service);
        const serviceName = rawServiceName && !rawServiceName.toLowerCase().endsWith('.xml') ? rawServiceName : null;
        const serviceId = serviceName ? serviceCache.get(serviceName) || null : null;
        const method = payload.method ? String(payload.method).toUpperCase() : null;
        const logPath = safeText(payload.path || payload.endpoint);
        const endpointId = serviceId && method && logPath ? endpointCache.get(`${serviceId}|${method}|${logPath}`) || null : null;
        const traceId = safeText(payload.trace_id || payload.event_id || payload.correlation_id || payload.raw?.trace_id || payload.raw?.event_id || payload.raw?.correlation_id);
        const message = safeText(payload.message, safeText(payload.raw, ''));

        const base = idx * 11;
        placeholders.push(`($${base+1}::uuid,$${base+2}::uuid,$${base+3}::uuid,$${base+4}::uuid,$${base+5}::uuid,$${base+6}::uuid,COALESCE($${base+7}::timestamptz, now()),$${base+8}::text,$${base+9}::text,$${base+10}::text,$${base+11}::jsonb)`);
        values.push(
          env.org_id,
          env.workspace_id,
          env.id,
          serviceId,
          endpointId,
          options.uploadId || null,
          safeTimestamp(payload.timestamp),
          safeUpper(payload.severity),
          traceId,
          message,
          safeJson(payload)
        );
      });

      const result = await client.query(
        `INSERT INTO log_events(org_id, workspace_id, environment_id, service_id, endpoint_id, upload_id, timestamp, severity, trace_id, message, raw)
         VALUES ${placeholders.join(',')}
         RETURNING id, timestamp, severity, trace_id, message`,
        values
      );
      insertedRows.push(...result.rows);
    }

    const traceMap = new Map();
    for (const payload of logs) {
      const traceId = safeText(payload.trace_id || payload.event_id || payload.correlation_id || payload.raw?.trace_id || payload.raw?.event_id || payload.raw?.correlation_id);
      if (!traceId) continue;

      const rawServiceName = safeText(payload.service_name || payload.service);
      const serviceName = rawServiceName && !rawServiceName.toLowerCase().endsWith('.xml') ? rawServiceName : null;
      const serviceId = serviceName ? serviceCache.get(serviceName) || null : null;
      const method = payload.method ? String(payload.method).toUpperCase() : null;
      const logPath = safeText(payload.path || payload.endpoint);
      const endpointId = serviceId && method && logPath ? endpointCache.get(`${serviceId}|${method}|${logPath}`) || null : null;
      const status = ['ERROR','FATAL'].includes(safeUpper(payload.severity, '')) ? 'error' : 'success';
      const startedAt = safeTimestamp(payload.timestamp);
      const existing = traceMap.get(traceId);

      if (!existing) {
        traceMap.set(traceId, { traceId, serviceId, endpointId, status, startedAt, payload, count: 1 });
      } else {
        existing.count += 1;
        existing.status = existing.status === 'error' || status === 'error' ? 'error' : status;
        existing.serviceId = existing.serviceId || serviceId;
        existing.endpointId = existing.endpointId || endpointId;
        if (startedAt && (!existing.startedAt || new Date(startedAt) < new Date(existing.startedAt))) existing.startedAt = startedAt;
      }
    }

    for (const traceBatch of chunkArray([...traceMap.values()], TRACE_INSERT_CHUNK_SIZE)) {
      const traceValues = [];
      const tracePlaceholders = [];
      traceBatch.forEach((t, idx) => {
        const base = idx * 8;
        const payload = t.payload || {};
        tracePlaceholders.push(`($${base+1}::uuid,$${base+2}::uuid,$${base+3}::uuid,$${base+4}::text,$${base+5}::text,$${base+6}::int,COALESCE($${base+7}::timestamptz, now()),$${base+8}::jsonb)`);
        traceValues.push(
          env.id,
          t.serviceId || null,
          t.endpointId || null,
          t.traceId,
          t.status,
          getLatencyMs(payload),
          t.startedAt || null,
          safeJson({
            event_id: payload.raw?.event_id || payload.event_id || t.traceId,
            correlation_id: payload.raw?.correlation_id || payload.correlation_id || t.traceId,
            transaction_id: payload.transaction_id || payload.raw?.transaction_id || null,
            service_name: payload.service_name || payload.service || null,
            method: payload.method || null,
            path: payload.path || payload.endpoint || null,
            rolled_up_events: t.count,
            http_status: getHttpStatus(payload),
            latency_ms: getLatencyMs(payload)
          })
        );
      });

      await client.query(
        `INSERT INTO traces(environment_id, service_id, endpoint_id, trace_id, status, latency_ms, started_at, meta)
         VALUES ${tracePlaceholders.join(',')}
         ON CONFLICT(environment_id, trace_id) DO UPDATE SET
           service_id=COALESCE(traces.service_id, EXCLUDED.service_id),
           endpoint_id=COALESCE(traces.endpoint_id, EXCLUDED.endpoint_id),
           status=CASE WHEN traces.status='error' OR EXCLUDED.status='error' THEN 'error' ELSE EXCLUDED.status END,
           latency_ms=GREATEST(COALESCE(traces.latency_ms,0), COALESCE(EXCLUDED.latency_ms,0)),
           started_at=LEAST(traces.started_at, EXCLUDED.started_at),
           meta=traces.meta || EXCLUDED.meta`,
        traceValues
      );
    }

    if (!options.uploadId) {
      await client.query(
        `INSERT INTO ingestion_jobs(environment_id, source_type, source_name, status, last_received_at, accepted_count, rejected_count, parser_errors, meta)
         VALUES($1::uuid,'UPLOAD',$2::text,'completed',now(),$3::int,0,0,$4::jsonb)`,
        [env.id, options.sourceName || 'browser/API upload', insertedRows.length, safeJson({ batch_size: logs.length, bytes: options.bytes || 0 })]
      );
    }

    return insertedRows;
  });
}


export async function createUploadRecord(workspaceSlug, environmentName, { fileName='upload.log', bytes=0 } = {}) {
  if (!hasDatabase) {
    const rec = { id:`local-upload-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, source_type:'UPLOAD', source_name:fileName, status:'receiving', accepted_count:0, rejected_count:0, parser_errors:0, meta:{bytes}, created_at:new Date().toISOString(), last_received_at:new Date().toISOString() };
    fallback.ingestion.unshift(rec);
    return rec;
  }
  const env = await getEnvironment(workspaceSlug, environmentName);
  const result = await query(
    `INSERT INTO ingestion_jobs(environment_id, source_type, source_name, status, last_received_at, accepted_count, rejected_count, parser_errors, meta)
     VALUES($1,'UPLOAD',$2,'receiving',now(),0,0,0,$3)
     RETURNING *`,
    [env.id, fileName, JSON.stringify({ bytes, stage:'Receiving file' })]
  );
  return result.rows[0];
}

export async function updateUploadRecord(workspaceSlug, environmentName, uploadId, patch = {}) {
  if (!uploadId) return null;
  if (!hasDatabase) {
    const rec = fallback.ingestion.find(x => x.id === uploadId);
    if (rec) Object.assign(rec, patch, { meta: { ...(rec.meta||{}), ...(patch.meta||{}) }, last_received_at:new Date().toISOString() });
    return rec || null;
  }
  const env = await getEnvironment(workspaceSlug, environmentName);
  const current = await query(`SELECT meta FROM ingestion_jobs WHERE id=$1 AND environment_id=$2`, [uploadId, env.id]);
  if (!current.rows[0]) return null;
  const meta = { ...(current.rows[0].meta || {}), ...(patch.meta || {}) };
  const result = await query(
    `UPDATE ingestion_jobs SET
       status=COALESCE($3::text,status),
       accepted_count=COALESCE($4::int,accepted_count),
       rejected_count=COALESCE($5::int,rejected_count),
       parser_errors=COALESCE($6::int,parser_errors),
       last_received_at=now(),
       meta=$7::jsonb
     WHERE id=$1 AND environment_id=$2
     RETURNING *`,
    [uploadId, env.id, patch.status || null, patch.accepted_count ?? null, patch.rejected_count ?? null, patch.parser_errors ?? null, JSON.stringify(meta)]
  );
  return result.rows[0] || null;
}

export async function getUploadHistory(workspaceSlug, environmentName) {
  if (!hasDatabase) {
    return fallback.ingestion.filter(x => x.source_type === 'UPLOAD').map(x => ({
      ...x,
      file_name: x.source_name,
      file_size: x.meta?.bytes || 0,
      total_logs: x.accepted_count || 0,
      environment: environmentName
    }));
  }
  const env = await getEnvironment(workspaceSlug, environmentName);
  const result = await query(
    `SELECT ij.id, ij.source_name AS file_name, ij.status, ij.accepted_count AS total_logs,
            ij.rejected_count, ij.parser_errors, ij.created_at, ij.last_received_at,
            COALESCE((ij.meta->>'bytes')::bigint,0) AS file_size,
            ij.meta,
            count(le.id)::int AS stored_logs
     FROM ingestion_jobs ij
     LEFT JOIN log_events le ON le.upload_id=ij.id
     WHERE ij.environment_id=$1 AND ij.source_type='UPLOAD'
     GROUP BY ij.id
     ORDER BY ij.created_at DESC
     LIMIT 200`,
    [env.id]
  );
  return result.rows;
}

export async function deleteUploadHistory(workspaceSlug, environmentName, uploadIds = []) {
  const ids = Array.isArray(uploadIds) ? uploadIds.filter(Boolean) : [];
  if (!ids.length) return { deleted_uploads: 0, deleted_logs: 0 };
  if (!hasDatabase) {
    const beforeLogs = fallback.logs.length;
    fallback.logs = fallback.logs.filter(l => !ids.includes(l.upload_id));
    const beforeUploads = fallback.ingestion.length;
    fallback.ingestion = fallback.ingestion.filter(x => !ids.includes(x.id));
    return { deleted_uploads: beforeUploads - fallback.ingestion.length, deleted_logs: beforeLogs - fallback.logs.length, mode:'memory' };
  }
  const env = await getEnvironment(workspaceSlug, environmentName);
  return withTransaction(async (client) => {
    const delLogs = await client.query(`DELETE FROM log_events WHERE environment_id=$1 AND upload_id = ANY($2::uuid[])`, [env.id, ids]);
    const delUploads = await client.query(`DELETE FROM ingestion_jobs WHERE environment_id=$1 AND id = ANY($2::uuid[]) AND source_type='UPLOAD'`, [env.id, ids]);
    await client.query(`DELETE FROM traces t WHERE t.environment_id=$1 AND NOT EXISTS (SELECT 1 FROM log_events le WHERE le.environment_id=$1 AND le.trace_id=t.trace_id)`, [env.id]);
    await client.query(`DELETE FROM endpoints ep USING services s WHERE ep.service_id=s.id AND s.environment_id=$1 AND NOT EXISTS (SELECT 1 FROM log_events le WHERE le.endpoint_id=ep.id)`, [env.id]);
    await client.query(`DELETE FROM services s WHERE s.environment_id=$1 AND NOT EXISTS (SELECT 1 FROM log_events le WHERE le.service_id=s.id) AND NOT EXISTS (SELECT 1 FROM endpoints ep WHERE ep.service_id=s.id)`, [env.id]);
    return { deleted_uploads: delUploads.rowCount || 0, deleted_logs: delLogs.rowCount || 0, environment: environmentName };
  });
}

export async function deleteAllUploadHistory(workspaceSlug, environmentName) {
  if (!hasDatabase) {
    const beforeLogs = fallback.logs.length, beforeUploads = fallback.ingestion.length;
    fallback.logs = fallback.logs.filter(l => l.environment_name !== environmentName);
    fallback.ingestion = fallback.ingestion.filter(x => x.source_type !== 'UPLOAD');
    return { deleted_uploads: beforeUploads - fallback.ingestion.length, deleted_logs: beforeLogs - fallback.logs.length, mode:'memory' };
  }
  const env = await getEnvironment(workspaceSlug, environmentName);
  return withTransaction(async (client) => {
    const ids = await client.query(`SELECT id FROM ingestion_jobs WHERE environment_id=$1 AND source_type='UPLOAD'`, [env.id]);
    const delLogs = await client.query(`DELETE FROM log_events WHERE environment_id=$1 AND upload_id IN (SELECT id FROM ingestion_jobs WHERE environment_id=$1 AND source_type='UPLOAD')`, [env.id]);
    await client.query(`DELETE FROM ingestion_jobs WHERE environment_id=$1 AND source_type='UPLOAD'`, [env.id]);
    await client.query(`DELETE FROM traces WHERE environment_id=$1`, [env.id]);
    await client.query(`DELETE FROM alerts WHERE environment_id=$1`, [env.id]);
    await client.query(`DELETE FROM endpoints ep USING services s WHERE ep.service_id=s.id AND s.environment_id=$1`, [env.id]);
    await client.query(`DELETE FROM services WHERE environment_id=$1`, [env.id]);
    return { deleted_uploads: ids.rowCount || 0, deleted_logs: delLogs.rowCount || 0, environment: environmentName };
  });
}

export async function deleteEnvironmentLogs(workspaceSlug, environmentName) {
  if (!hasDatabase) {
    const before = fallback.logs.length;
    fallback.logs = fallback.logs.filter(l => l.environment_name !== environmentName);
    fallback.ingestion.unshift({ source_type:'ADMIN', source_name:'clear environment logs', status:'healthy', accepted_count:0, rejected_count:0, parser_errors:0, created_at:new Date().toISOString() });
    return { deleted: before - fallback.logs.length, mode: 'memory' };
  }
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return { deleted: 0 };
  return withTransaction(async (client) => {
    const delLogs = await client.query(`DELETE FROM log_events WHERE environment_id=$1`, [env.id]);
    await client.query(`DELETE FROM traces WHERE environment_id=$1`, [env.id]);
    await client.query(`DELETE FROM alerts WHERE environment_id=$1`, [env.id]);
    await client.query(`DELETE FROM ingestion_jobs WHERE environment_id=$1`, [env.id]);
    await client.query(`DELETE FROM endpoints ep USING services s WHERE ep.service_id=s.id AND s.environment_id=$1`, [env.id]);
    await client.query(`DELETE FROM services WHERE environment_id=$1`, [env.id]);
    return { deleted: delLogs.rowCount || 0, environment: environmentName };
  });
}

export async function getTraces(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  if (!hasDatabase) return [];
  const result = await query(
    `SELECT t.*, CASE WHEN s.name ~* '\.xml(:[0-9]+)?$' THEN NULL ELSE s.name END service_name, ep.method, ep.path,
              COALESCE(CASE WHEN (le.raw->>'latency_ms') ~ '^[0-9]+$' THEN (le.raw->>'latency_ms')::int END, CASE WHEN (le.raw->'analytics'->>'latency_ms') ~ '^[0-9]+$' THEN (le.raw->'analytics'->>'latency_ms')::int END, 0) AS latency_ms,
              COALESCE(le.raw->>'http_status', le.raw->'analytics'->>'http_status') AS http_status
     FROM traces t
     LEFT JOIN services s ON s.id=t.service_id
     LEFT JOIN endpoints ep ON ep.id=t.endpoint_id
     WHERE t.environment_id=$1
     ORDER BY t.started_at DESC
     LIMIT 100`,
    [env.id]
  );
  return result.rows;
}


export async function getTraceDetail(workspaceSlug, environmentName, traceId) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env || !traceId) return { trace: null, events: [], waterfall: [] };
  if (!hasDatabase) return { trace: null, events: [] };
  const trace = await query(
    `SELECT t.*, s.name service_name, ep.method, ep.path
     FROM traces t
     LEFT JOIN services s ON s.id=t.service_id
     LEFT JOIN endpoints ep ON ep.id=t.endpoint_id
     WHERE t.environment_id=$1 AND t.trace_id=$2`, [env.id, traceId]);
  const events = await query(
    `SELECT le.id, le.timestamp, le.severity, le.trace_id, le.message, le.raw,
            s.name service_name, ep.method, ep.path,
            COALESCE(CASE WHEN (le.raw->>'latency_ms') ~ '^[0-9]+$' THEN (le.raw->>'latency_ms')::int END, CASE WHEN (le.raw->'analytics'->>'latency_ms') ~ '^[0-9]+$' THEN (le.raw->'analytics'->>'latency_ms')::int END, 0) AS latency_ms,
            COALESCE(le.raw->>'http_status', le.raw->'analytics'->>'http_status') AS http_status
     FROM log_events le
     LEFT JOIN services s ON s.id=le.service_id
     LEFT JOIN endpoints ep ON ep.id=le.endpoint_id
     WHERE le.environment_id=$1 AND (le.trace_id=$2 OR le.raw->>'event_id'=$2 OR le.raw->>'correlation_id'=$2 OR le.raw->>'transaction_id'=$2)
     ORDER BY le.timestamp ASC LIMIT 300`, [env.id, traceId]);
  const first = events.rows[0]?.timestamp ? new Date(events.rows[0].timestamp).getTime() : Date.now();
  const waterfall = events.rows.map((e, idx) => ({
    step: idx + 1,
    at_ms: Math.max(0, new Date(e.timestamp).getTime() - first),
    service_name: e.service_name,
    method: e.method,
    path: e.path,
    severity: e.severity,
    latency_ms: e.latency_ms || 0,
    message: e.message
  }));
  return { trace: trace.rows[0] || null, events: events.rows, waterfall };
}

export async function getErrorGroups(workspaceSlug, environmentName, filters = {}) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env || !hasDatabase) return [];
  const values = [env.id];
  const where = [`le.environment_id=$1`, `le.severity IN ('ERROR','FATAL')`];
  const add = (sql, value) => { if (value !== undefined && value !== null && String(value).trim() !== '') { values.push(String(value)); where.push(sql.replace('?', `$${values.length}`)); } };
  add('s.name = ?', filters.service);
  add('ep.path = ?', filters.path);
  if (filters.range && filters.range !== 'all') {
    const interval = filters.range === '1h' ? '1 hour' : filters.range === '7d' ? '7 days' : filters.range === '30d' ? '30 days' : '24 hours';
    where.push(`le.timestamp >= now() - interval '${interval}'`);
  }
  const sig = signatureSql('le');
  try {
    const result = await query(
      `SELECT ${sig} AS signature,
              count(*)::int AS occurrences,
              max(le.timestamp) AS last_seen,
              min(le.timestamp) AS first_seen,
              (array_remove(array_agg(DISTINCT s.name), NULL))[1:5] AS services,
              (array_remove(array_agg(DISTINCT ep.path), NULL))[1:5] AS endpoints,
              max(le.message) AS sample_message
       FROM log_events le
       LEFT JOIN services s ON s.id=le.service_id
       LEFT JOIN endpoints ep ON ep.id=le.endpoint_id
       WHERE ${where.join(' AND ')}
       GROUP BY signature
       ORDER BY occurrences DESC, last_seen DESC
       LIMIT 25`, values);
    return result.rows;
  } catch (error) {
    console.warn('[error-groups] primary query failed, using safe fallback:', error.message);
    const fallbackResult = await query(
      `SELECT COALESCE(NULLIF(left(le.message, 120), ''), 'Unknown error') AS signature,
              count(*)::int AS occurrences,
              max(le.timestamp) AS last_seen,
              min(le.timestamp) AS first_seen,
              ARRAY[]::text[] AS services,
              ARRAY[]::text[] AS endpoints,
              max(le.message) AS sample_message
       FROM log_events le
       LEFT JOIN services s ON s.id=le.service_id
       LEFT JOIN endpoints ep ON ep.id=le.endpoint_id
       WHERE ${where.join(' AND ')}
       GROUP BY signature
       ORDER BY occurrences DESC, last_seen DESC
       LIMIT 25`, values);
    return fallbackResult.rows;
  }
}

export async function getDeployImpact(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env || !hasDatabase) return [];
  const result = await query(
    `WITH uploads AS (
       SELECT id, source_name, created_at FROM ingestion_jobs
       WHERE environment_id=$1 AND source_type='UPLOAD' AND status IN ('completed','healthy')
       ORDER BY created_at DESC LIMIT 10
     ), metrics AS (
       SELECT u.id, u.source_name, u.created_at,
              count(le.id) FILTER (WHERE le.timestamp < u.created_at)::int before_logs,
              count(le.id) FILTER (WHERE le.timestamp >= u.created_at)::int after_logs,
              COALESCE(100.0 * count(le.id) FILTER (WHERE le.timestamp < u.created_at AND le.severity IN ('ERROR','FATAL')) / NULLIF(count(le.id) FILTER (WHERE le.timestamp < u.created_at),0),0)::numeric(7,2) before_error_rate,
              COALESCE(100.0 * count(le.id) FILTER (WHERE le.timestamp >= u.created_at AND le.severity IN ('ERROR','FATAL')) / NULLIF(count(le.id) FILTER (WHERE le.timestamp >= u.created_at),0),0)::numeric(7,2) after_error_rate
       FROM uploads u
       LEFT JOIN log_events le ON le.environment_id=$1 AND le.timestamp >= u.created_at - interval '24 hours' AND le.timestamp < u.created_at + interval '24 hours'
       GROUP BY u.id, u.source_name, u.created_at
     ) SELECT *, (after_error_rate-before_error_rate)::numeric(7,2) AS error_delta_pct FROM metrics ORDER BY created_at DESC`, [env.id]);
  return result.rows;
}

export async function getAlerts(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  if (!hasDatabase) return [];
  const result = await query(
    `SELECT a.*, CASE WHEN s.name ~* '\.xml(:[0-9]+)?$' THEN NULL ELSE s.name END service_name, ep.method, ep.path
     FROM alerts a
     LEFT JOIN services s ON s.id=a.service_id
     LEFT JOIN endpoints ep ON ep.id=a.endpoint_id
     WHERE a.environment_id=$1
     ORDER BY a.created_at DESC
     LIMIT 100`,
    [env.id]
  );
  return result.rows;
}

export async function getOps(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return null;
  if (!hasDatabase) {
    return {
      ingestion: fallback.ingestion,
      security:    [{ event_type: 'PII_MASKING', severity: 'INFO', message: 'PII masked before indexing', count: 987 }],
      deployments: [{ version: '1.0.8', before_error_rate: 0.008, after_error_rate: 0.051, before_p95_ms: 286, after_p95_ms: 842 }]
    };
  }
  const [ingestion, security, deployments] = await Promise.all([
    query(`SELECT * FROM ingestion_jobs WHERE environment_id=$1 ORDER BY created_at DESC LIMIT 20`, [env.id]),
    query(`SELECT * FROM security_events WHERE environment_id=$1 ORDER BY created_at DESC LIMIT 20`, [env.id]),
    query(`SELECT d.*, s.name service_name FROM deployments d LEFT JOIN services s ON s.id=d.service_id WHERE d.environment_id=$1 ORDER BY deployed_at DESC LIMIT 20`, [env.id])
  ])
  return { ingestion: ingestion.rows, security: security.rows, deployments: deployments.rows };
}


export async function runAnomalyDetection(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return { checked: 0, created: 0, alerts: [] };
  if (!hasDatabase) return { checked: 0, created: 0, alerts: [] };

  const result = await query(
    `WITH buckets AS (
       SELECT s.id service_id, s.name service_name,
              date_trunc('hour', le.timestamp) bucket,
              count(*) total,
              count(*) FILTER (WHERE le.severity IN ('ERROR','FATAL')) errors
       FROM services s
       JOIN log_events le ON le.service_id=s.id
       WHERE s.environment_id=$1
         AND s.name !~* '\.xml(:[0-9]+)?$'
         AND le.timestamp >= now() - interval '7 days'
       GROUP BY s.id, s.name, date_trunc('hour', le.timestamp)
     ), scored AS (
       SELECT service_id, service_name, bucket,
              COALESCE(100.0 * errors / NULLIF(total,0),0) AS error_rate
       FROM buckets
     ), stats AS (
       SELECT service_id, service_name,
              avg(error_rate) FILTER (WHERE bucket < date_trunc('hour', now())) AS avg_rate,
              stddev_pop(error_rate) FILTER (WHERE bucket < date_trunc('hour', now())) AS std_rate,
              max(error_rate) FILTER (WHERE bucket >= now() - interval '5 minutes') AS current_rate
       FROM scored
       GROUP BY service_id, service_name
     )
     SELECT * FROM stats
     WHERE current_rate IS NOT NULL
       AND COALESCE(std_rate,0) > 0
       AND current_rate > avg_rate + (2 * std_rate)
       AND current_rate >= 1`,
    [env.id]
  );

  const created = [];
  for (const row of result.rows) {
    const desc = `Error rate ${Number(row.current_rate).toFixed(2)}% exceeded baseline ${Number(row.avg_rate).toFixed(2)}% by >2σ.`;
    const exists = await query(
      `SELECT id FROM alerts WHERE environment_id=$1 AND service_id=$2 AND status='open' AND title=$3 LIMIT 1`,
      [env.id, row.service_id, 'Log anomaly detected']
    );
    if (exists.rows[0]) continue;
    const alert = await query(
      `INSERT INTO alerts(environment_id, service_id, severity, title, description, status)
       VALUES($1,$2,'P2','Log anomaly detected',$3,'open') RETURNING *`,
      [env.id, row.service_id, `${row.service_name}: ${desc}`]
    );
    created.push(alert.rows[0]);
  }
  return { checked: result.rows.length, created: created.length, alerts: created };
}

export async function getSavedSearches(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env || !hasDatabase) return [];
  const result = await query(`SELECT id, name, filters, created_at FROM saved_searches WHERE environment_id=$1 ORDER BY created_at DESC LIMIT 50`, [env.id]);
  return result.rows;
}

export async function createSavedSearch(workspaceSlug, environmentName, name, filters = {}) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return null;
  if (!hasDatabase) return { id: `local-search-${Date.now()}`, name, filters, created_at: new Date().toISOString() };
  const result = await query(
    `INSERT INTO saved_searches(environment_id, name, filters) VALUES($1,$2,$3::jsonb)
     ON CONFLICT(environment_id, name) DO UPDATE SET filters=EXCLUDED.filters
     RETURNING id, name, filters, created_at`,
    [env.id, name, JSON.stringify(filters || {})]
  );
  return result.rows[0];
}

async function getRcaSettings(env) {
  const provider = String(process.env.AI_PROVIDER || '').trim().toLowerCase() || 'local';
  const model = process.env.AI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : provider === 'anthropic' ? 'claude-3-5-haiku-latest' : provider === 'gemini' ? 'gemini-1.5-flash' : 'local-rule-engine');
  if (!hasDatabase || !env?.id) return { provider, model, enabled: provider !== 'local' };
  const existing = await query(`SELECT provider, model, enabled FROM rca_settings WHERE environment_id=$1`, [env.id]).catch(() => ({ rows: [] }));
  return existing.rows[0] || { provider, model, enabled: provider !== 'local' };
}

async function callAiProvider(settings, prompt) {
  const provider = String(settings?.provider || 'local').toLowerCase();
  const model = settings?.model || process.env.AI_MODEL;
  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`}, body: JSON.stringify({ model: model || 'gpt-4o-mini', messages:[{role:'system',content:'You are an observability RCA assistant. Be concise, evidence-based, and production-safe.'},{role:'user',content:prompt}], temperature:0.2 }) });
    if (!res.ok) throw new Error(`OpenAI RCA failed: ${res.status}`);
    const data = await res.json(); return data.choices?.[0]?.message?.content || '';
  }
  if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'}, body: JSON.stringify({ model: model || 'claude-3-5-haiku-latest', max_tokens:700, temperature:0.2, messages:[{role:'user',content:prompt}] }) });
    if (!res.ok) throw new Error(`Anthropic RCA failed: ${res.status}`);
    const data = await res.json(); return (data.content || []).map(x => x.text || '').join('\n');
  }
  if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
    const geminiModel = model || 'gemini-1.5-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents:[{parts:[{text:prompt}]}] }) });
    if (!res.ok) throw new Error(`Gemini RCA failed: ${res.status}`);
    const data = await res.json(); return data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('\n') || '';
  }
  return '';
}

export async function rca(workspaceSlug, environmentName, queryText = '') {
  const env = await getEnvironment(workspaceSlug, environmentName);
  const [overview, alerts, logs, errorGroups] = await Promise.all([
    getOverview(workspaceSlug, environmentName),
    getAlerts(workspaceSlug, environmentName),
    getLogs(workspaceSlug, environmentName, 50, { q: queryText, range: '24h' }),
    getErrorGroups(workspaceSlug, environmentName, { range: '24h' }).catch(() => [])
  ]);

  const logRows = Array.isArray(logs) ? logs : (logs.items || []);
  const topError = logRows.find((log) => ['ERROR', 'FATAL'].includes(log.severity));
  const warnCount = logRows.filter((log) => log.severity === 'WARN').length;
  const errorCount = logRows.filter((log) => ['ERROR', 'FATAL'].includes(log.severity)).length;
  const affectedServices = [...new Set(logRows.map((l) => l.service_name).filter(Boolean))].slice(0, 5);
  const settings = await getRcaSettings(env);
  const base = {
    environment: environmentName,
    query: queryText,
    ai_provider: settings.provider || 'local',
    ai_model: settings.model || 'local-rule-engine',
    summary: `${environmentName} RCA is scoped to this environment only. Health: ${overview?.environment?.health_score ?? 'N/A'}, active alerts: ${overview?.metrics?.active_alerts ?? 0}.`,
    likely_root_cause: topError ? topError.message : (errorGroups[0]?.sample_message || 'No critical error pattern found in the matched/latest logs.'),
    impact: alerts.slice(0, 3).map((a) => a.title),
    evidence: { matched_logs: logRows.length, errors: errorCount, warnings: warnCount, affected_services: affectedServices, top_error_groups: errorGroups.slice(0, 5) },
    recommended_actions: [
      'Open the affected service and endpoint first.',
      'Inspect slow traces and backend latency split.',
      'Validate recent deployment/upload impact for the same environment only.',
      'Check masking/security policy hits before sharing logs externally.'
    ]
  };
  const prompt = `Environment: ${environmentName}\nQuestion: ${queryText}\nOverview: ${JSON.stringify(overview?.metrics || {})}\nAlerts: ${JSON.stringify(alerts.slice(0,5))}\nError groups: ${JSON.stringify(errorGroups.slice(0,5))}\nRecent logs: ${JSON.stringify(logRows.slice(0,10).map(l=>({severity:l.severity,service:l.service_name,path:l.path,message:l.message,timestamp:l.timestamp})))}\nReturn RCA with root cause, evidence, impact, recommended actions.`;
  try {
    const ai = settings.enabled ? await callAiProvider(settings, prompt) : '';
    if (ai) return { ...base, ai_summary: ai, likely_root_cause: ai.split('\n').find(Boolean) || base.likely_root_cause };
  } catch (error) {
    return { ...base, ai_error: error.message, recommended_actions: [`AI provider failed (${error.message}); using local RCA.`, ...base.recommended_actions] };
  }
  return base;
}


const builtinAlertTemplates = [
  { key:'error-rate-critical', name:'Critical error-rate spike', metric:'error_rate_pct', operator:'>', threshold:5, severity:'P1', window_minutes:15, description:'Triggers when ERROR/FATAL logs cross 5% for any service.' },
  { key:'error-rate-warning', name:'Error-rate warning', metric:'error_rate_pct', operator:'>', threshold:1, severity:'P2', window_minutes:15, description:'Early warning when a service error rate crosses 1%.' },
  { key:'latency-p95-high', name:'High P95 latency', metric:'p95_latency_ms', operator:'>', threshold:1500, severity:'P2', window_minutes:15, description:'Triggers when endpoint/service P95 latency is higher than expected.' },
  { key:'no-logs', name:'No logs received', metric:'no_logs_minutes', operator:'>', threshold:30, severity:'P2', window_minutes:30, description:'Detects silent services or broken ingestion when no logs arrive.' },
  { key:'ingestion-rejects', name:'Parser rejection spike', metric:'rejected_rate_pct', operator:'>', threshold:2, severity:'P2', window_minutes:60, description:'Upload/API/S3 parser is rejecting too many rows.' },
  { key:'fatal-events', name:'Fatal events present', metric:'fatal_count', operator:'>', threshold:0, severity:'P1', window_minutes:15, description:'Any FATAL event in the selected environment.' },
  { key:'security-mask', name:'Security masking coverage low', metric:'masking_coverage_pct', operator:'<', threshold:95, severity:'P2', window_minutes:60, description:'PII/token masking coverage below policy threshold.' }
];

export async function getAlertRules(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  const builtins = builtinAlertTemplates.map((r) => ({ ...r, id: `builtin-${r.key}`, builtin: true, enabled: true, service_name: null, endpoint_path: null }));
  if (!hasDatabase) return builtins;
  const result = await query(
    `SELECT id, name, metric, operator, threshold, severity, service_name, endpoint_path, window_minutes, enabled, notify_webhook, created_at
     FROM alert_rules WHERE environment_id=$1 ORDER BY created_at DESC`, [env.id]
  );
  return [...result.rows.map(r => ({...r, builtin:false})), ...builtins];
}

export async function createAlertRule(workspaceSlug, environmentName, payload = {}) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return null;
  const name = String(payload.name || 'Custom alert').trim().slice(0, 120);
  const metric = String(payload.metric || 'error_rate_pct');
  const operator = ['>','<','>=','<=','='].includes(payload.operator) ? payload.operator : '>';
  const severity = ['INFO','P3','P2','P1'].includes(payload.severity) ? payload.severity : 'P2';
  const threshold = Number(payload.threshold ?? 1);
  const window_minutes = Math.max(1, Math.min(1440, Number(payload.window_minutes || 15)));
  const service_name = payload.service_name ? String(payload.service_name).slice(0,160) : null;
  const endpoint_path = payload.endpoint_path ? String(payload.endpoint_path).slice(0,300) : null;
  if (!hasDatabase) return { id:`local-rule-${Date.now()}`, name, metric, operator, threshold, severity, window_minutes, service_name, endpoint_path, enabled:true };
  const result = await query(
    `INSERT INTO alert_rules(environment_id, name, metric, operator, threshold, severity, service_name, endpoint_path, window_minutes, enabled, notify_webhook)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true)
     ON CONFLICT(environment_id, name) DO UPDATE SET metric=EXCLUDED.metric, operator=EXCLUDED.operator, threshold=EXCLUDED.threshold,
       severity=EXCLUDED.severity, service_name=EXCLUDED.service_name, endpoint_path=EXCLUDED.endpoint_path,
       window_minutes=EXCLUDED.window_minutes, enabled=true
     RETURNING *`, [env.id, name, metric, operator, threshold, severity, service_name, endpoint_path, window_minutes]
  );
  return result.rows[0];
}

function compareMetric(value, operator, threshold) {
  const v = Number(value || 0), t = Number(threshold || 0);
  if (operator === '<') return v < t;
  if (operator === '>=') return v >= t;
  if (operator === '<=') return v <= t;
  if (operator === '=') return v === t;
  return v > t;
}

async function computeRuleCandidates(env, rule) {
  const serviceClause = rule.service_name ? ` AND s.name=$3` : '';
  const params = [env.id, Number(rule.window_minutes || 15)];
  if (rule.service_name) params.push(rule.service_name);
  if (rule.metric === 'error_rate_pct') {
    const r = await query(`SELECT s.id service_id, s.name service_name, NULL::uuid endpoint_id, count(*)::int total,
        count(*) FILTER (WHERE le.severity IN ('ERROR','FATAL'))::int bad,
        COALESCE(100.0 * count(*) FILTER (WHERE le.severity IN ('ERROR','FATAL')) / NULLIF(count(*),0),0)::numeric(12,3) value
      FROM services s JOIN log_events le ON le.service_id=s.id
      WHERE s.environment_id=$1 AND le.timestamp >= now() - ($2 || ' minutes')::interval ${serviceClause}
      GROUP BY s.id, s.name HAVING count(*) > 0`, params);
    return r.rows;
  }
  if (rule.metric === 'fatal_count') {
    const r = await query(`SELECT s.id service_id, s.name service_name, NULL::uuid endpoint_id, count(*)::numeric(12,3) value
      FROM services s JOIN log_events le ON le.service_id=s.id
      WHERE s.environment_id=$1 AND le.severity='FATAL' AND le.timestamp >= now() - ($2 || ' minutes')::interval ${serviceClause}
      GROUP BY s.id, s.name`, params);
    return r.rows;
  }
  if (rule.metric === 'p95_latency_ms') {
    const r = await query(`SELECT s.id service_id, s.name service_name, NULL::uuid endpoint_id,
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY t.latency_ms),0)::numeric(12,3) value
      FROM services s JOIN traces t ON t.service_id=s.id
      WHERE s.environment_id=$1 AND t.started_at >= now() - ($2 || ' minutes')::interval ${serviceClause}
      GROUP BY s.id, s.name`, params);
    return r.rows;
  }
  if (rule.metric === 'no_logs_minutes') {
    const r = await query(`SELECT s.id service_id, s.name service_name, NULL::uuid endpoint_id,
        EXTRACT(EPOCH FROM (now() - MAX(le.timestamp))) / 60.0 AS value
      FROM services s LEFT JOIN log_events le ON le.service_id=s.id
      WHERE s.environment_id=$1 ${rule.service_name ? 'AND s.name=$2' : ''}
      GROUP BY s.id, s.name`, rule.service_name ? [env.id, rule.service_name] : [env.id]);
    return r.rows;
  }
  if (rule.metric === 'rejected_rate_pct') {
    const r = await query(`SELECT NULL::uuid service_id, source_name service_name, NULL::uuid endpoint_id,
        COALESCE(100.0 * rejected_count / NULLIF(accepted_count + rejected_count,0),0)::numeric(12,3) value
      FROM ingestion_jobs WHERE environment_id=$1 AND created_at >= now() - ($2 || ' minutes')::interval`, [env.id, Number(rule.window_minutes || 60)]);
    return r.rows;
  }
  if (rule.metric === 'masking_coverage_pct') {
    const r = await query(`SELECT NULL::uuid service_id, 'Security policy'::text service_name, NULL::uuid endpoint_id,
        COALESCE(100.0 - LEAST(100, count(*) FILTER (WHERE message ~* '(password|secret|token|authorization|apikey)') * 5),100)::numeric(12,3) value
      FROM log_events WHERE environment_id=$1 AND timestamp >= now() - ($2 || ' minutes')::interval`, [env.id, Number(rule.window_minutes || 60)]);
    return r.rows;
  }
  return [];
}

export async function evaluateAlertRules(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env || !hasDatabase) return { checked:0, created:0, alerts:[] };
  const customRules = await query(`SELECT * FROM alert_rules WHERE environment_id=$1 AND enabled=true`, [env.id]);
  const rules = customRules.rows.length ? customRules.rows : builtinAlertTemplates.map(r => ({...r, id:null, enabled:true}));
  const created=[]; let checked=0;
  for (const rule of rules) {
    const candidates = await computeRuleCandidates(env, rule);
    for (const c of candidates) {
      checked++;
      if (!compareMetric(c.value, rule.operator, rule.threshold)) continue;
      const scope = c.service_name || rule.service_name || 'environment';
      const fp = `${rule.name}|${rule.metric}|${scope}|${rule.operator}|${rule.threshold}`.toLowerCase();
      const description = `${scope}: ${rule.metric} is ${Number(c.value||0).toFixed(2)} ${rule.operator} ${Number(rule.threshold).toFixed(2)} during last ${rule.window_minutes || 15} minutes.`;
      const result = await query(
        `INSERT INTO alerts(environment_id, service_id, endpoint_id, rule_id, severity, title, description, status, metric, current_value, threshold, fingerprint)
         VALUES($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,$11)
         ON CONFLICT ON CONSTRAINT idx_alerts_env_fingerprint_open DO NOTHING
         RETURNING *`, [env.id, c.service_id || null, c.endpoint_id || null, rule.id || null, rule.severity || 'P2', rule.name, description, rule.metric, Number(c.value||0), Number(rule.threshold), fp]
      ).catch(async () => {
        return await query(
          `INSERT INTO alerts(environment_id, service_id, endpoint_id, rule_id, severity, title, description, status, metric, current_value, threshold, fingerprint)
           SELECT $1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10,$11
           WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE environment_id=$1 AND fingerprint=$11 AND status='open') RETURNING *`,
          [env.id, c.service_id || null, c.endpoint_id || null, rule.id || null, rule.severity || 'P2', rule.name, description, rule.metric, Number(c.value||0), Number(rule.threshold), fp]
        );
      });
      if (result.rows[0]) created.push(result.rows[0]);
    }
  }
  return { checked, created: created.length, alerts: created };
}


export async function getEnvironmentConfig(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  const defaultConfig = {
    environment: env?.name || environmentName,
    policy: { retention_days: 30, archive_to_s3: false, max_upload_mb: 750, rate_limit_per_minute: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 180), ingest_rate_limit_per_minute: Number(process.env.INGEST_RATE_LIMIT_MAX_REQUESTS || 30), allowed_ingestion_sources: ['UPLOAD','API','S3'], notes: '' },
    masking_rules: [
      { id: 'password', field_name: 'password', pattern: '(?i)password\\s*[:=]\\s*[^,\\s]+', replacement: 'password=[MASKED]', enabled: true, builtin: true },
      { id: 'authorization', field_name: 'authorization', pattern: '(?i)authorization\\s*[:=]\\s*bearer\\s+[^,\\s]+', replacement: 'Authorization: Bearer [MASKED]', enabled: true, builtin: true },
      { id: 'token', field_name: 'token', pattern: '(?i)(token|secret|api[_-]?key)\\s*[:=]\\s*[^,\\s]+', replacement: '$1=[MASKED]', enabled: true, builtin: true }
    ],
    rca: { provider: process.env.AI_PROVIDER || 'local', model: process.env.AI_MODEL || 'local-rule-engine', enabled: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY) }
  };
  if (!env || !hasDatabase) {
    const key = `${workspaceSlug}:${environmentName}`;
    const customRules = fallback.maskingRules.get(key) || [];
    return { ...defaultConfig, masking_rules: customRules.length ? customRules : defaultConfig.masking_rules };
  }
  const [policy, masking, rcaCfg] = await Promise.all([
    query(`INSERT INTO environment_policies(environment_id) VALUES($1) ON CONFLICT(environment_id) DO NOTHING; SELECT * FROM environment_policies WHERE environment_id=$1`, [env.id]).catch(() => ({ rows: [] })),
    query(`SELECT id, field_name, pattern, replacement, enabled FROM masking_rules WHERE environment_id=$1 ORDER BY created_at ASC`, [env.id]).catch(() => ({ rows: [] })),
    query(`INSERT INTO rca_settings(environment_id, provider, model, enabled) VALUES($1,$2,$3,$4) ON CONFLICT(environment_id) DO NOTHING; SELECT provider, model, enabled FROM rca_settings WHERE environment_id=$1`, [env.id, defaultConfig.rca.provider, defaultConfig.rca.model, defaultConfig.rca.enabled]).catch(() => ({ rows: [] }))
  ]);
  const byField = new Map(defaultConfig.masking_rules.map(r => [r.field_name, r]));
  for (const r of masking.rows || []) byField.set(r.field_name, { ...r, builtin: defaultConfig.masking_rules.some(d => d.field_name === r.field_name) });
  const mergedMaskingRules = Array.from(byField.values()).filter(r => r.enabled !== false);
  return { environment: env.name, policy: policy.rows?.at?.(-1) || defaultConfig.policy, masking_rules: mergedMaskingRules, rca: rcaCfg.rows?.at?.(-1) || defaultConfig.rca };
}

export async function updateEnvironmentConfig(workspaceSlug, environmentName, payload = {}) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return null;
  if (!hasDatabase) return { ok: true, local_only: true, config: payload };
  const p = payload.policy || {};
  if (payload.policy) {
    await query(`INSERT INTO environment_policies(environment_id, retention_days, archive_to_s3, max_upload_mb, rate_limit_per_minute, ingest_rate_limit_per_minute, allowed_ingestion_sources, notes, updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
      ON CONFLICT(environment_id) DO UPDATE SET retention_days=EXCLUDED.retention_days, archive_to_s3=EXCLUDED.archive_to_s3, max_upload_mb=EXCLUDED.max_upload_mb,
      rate_limit_per_minute=EXCLUDED.rate_limit_per_minute, ingest_rate_limit_per_minute=EXCLUDED.ingest_rate_limit_per_minute, allowed_ingestion_sources=EXCLUDED.allowed_ingestion_sources, notes=EXCLUDED.notes, updated_at=now()`,
      [env.id, Number(p.retention_days || 30), Boolean(p.archive_to_s3), Number(p.max_upload_mb || 750), Number(p.rate_limit_per_minute || 180), Number(p.ingest_rate_limit_per_minute || 30), p.allowed_ingestion_sources || ['UPLOAD','API','S3'], p.notes || null]);
  }
  if (Array.isArray(payload.masking_rules)) {
    for (const r of payload.masking_rules) await upsertMaskingRule(workspaceSlug, environmentName, r);
  }
  if (payload.rca) {
    await query(`INSERT INTO rca_settings(environment_id, provider, model, enabled) VALUES($1,$2,$3,$4)
      ON CONFLICT(environment_id) DO UPDATE SET provider=EXCLUDED.provider, model=EXCLUDED.model, enabled=EXCLUDED.enabled, updated_at=now()`,
      [env.id, payload.rca.provider || 'local', payload.rca.model || null, payload.rca.enabled !== false]);
  }
  return getEnvironmentConfig(workspaceSlug, environmentName);
}

export async function listEnvironments(workspaceSlug='fsbl-prod-ops') {
  if (!hasDatabase) return fallback.environments;
  await ensureWorkspaceEnvironment(workspaceSlug, 'PROD');
  const result = await query(`SELECT e.id, e.name, e.display_name, e.status, e.health_score, e.created_at
    FROM environments e JOIN workspaces w ON w.id=e.workspace_id
    WHERE w.slug=$1 ORDER BY e.name='PROD' DESC, e.name='UAT' DESC, e.name ASC`, [workspaceSlug]);
  return result.rows;
}

export async function createEnvironment(workspaceSlug, payload = {}) {
  const name = String(payload.name || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '-').slice(0, 40);
  if (!name) throw new Error('Environment name is required');
  if (!hasDatabase) {
    const existing = fallback.environments.find(e => e.name === name);
    if (existing) return existing;
    const env = { id: envId(name), name, display_name: payload.display_name || name, health_score: 0, status: 'observed', custom: true };
    fallback.environments.push(env);
    return env;
  }
  const env = await ensureWorkspaceEnvironment(workspaceSlug, name);
  await query(`UPDATE environments SET display_name=$1, status=$2 WHERE id=$3`, [String(payload.display_name || name).slice(0,80), String(payload.status || env.status || 'observed').slice(0,40), env.id]);
  return getEnvironment(workspaceSlug, name);
}

export async function updateEnvironment(workspaceSlug, environmentName, payload = {}) {
  const name = String(environmentName || '').trim().toUpperCase();
  const nextName = String(payload.name || name).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '-').slice(0, 40);
  if (!nextName) throw new Error('Environment name is required');
  if (!hasDatabase) {
    const env = fallback.environments.find(e => e.name === name);
    if (!env) throw new Error('Environment not found');
    env.name = nextName; env.display_name = payload.display_name || nextName; env.status = payload.status || env.status || 'observed';
    return env;
  }
  const env = await getEnvironment(workspaceSlug, name);
  await query(`UPDATE environments SET name=$1, display_name=$2, status=$3 WHERE id=$4 RETURNING *`, [nextName, String(payload.display_name || nextName).slice(0,80), String(payload.status || env.status || 'observed').slice(0,40), env.id]);
  return getEnvironment(workspaceSlug, nextName);
}

export async function deleteEnvironment(workspaceSlug, environmentName) {
  const name = String(environmentName || '').trim().toUpperCase();
  if (['PROD'].includes(name)) throw new Error('PROD cannot be deleted. Rename or clear data instead.');
  if (!hasDatabase) {
    const before = fallback.environments.length;
    fallback.environments = fallback.environments.filter(e => String(e.name).toUpperCase() !== name);
    return { deleted: before - fallback.environments.length, environment: name };
  }
  let env;
  try { env = await getEnvironment(workspaceSlug, name); }
  catch { return { deleted: 0, environment: name, already_removed: true }; }
  // Explicit cleanup keeps deletion reliable even if an older DB was migrated before all FK cascades existed.
  const tables = ['audit_logs','masking_rules','environment_configs','rca_provider_configs','alert_rules','saved_searches','security_events','ingestion_jobs','deployments','alerts','traces','endpoints','services','log_events'];
  for (const table of tables) {
    try { await query(`DELETE FROM ${table} WHERE environment_id=$1`, [env.id]); } catch (_) {}
  }
  const result = await query(`DELETE FROM environments WHERE id=$1 RETURNING id`, [env.id]);
  return { deleted: result.rowCount || 0, environment: name };
}

export async function upsertMaskingRule(workspaceSlug, environmentName, payload = {}) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  const field = String(payload.field_name || payload.name || '').trim();
  if (!field) throw new Error('Masking rule field_name is required');
  if (!hasDatabase) {
    const key = `${workspaceSlug}:${environmentName}`;
    const list = fallback.maskingRules.get(key) || [];
    const existing = list.find(r => r.field_name === field);
    const rule = { id: existing?.id || `mask-${Date.now()}`, field_name: field, pattern: payload.pattern || null, replacement: payload.replacement || '[MASKED]', enabled: payload.enabled !== false };
    if (existing) Object.assign(existing, rule); else list.push(rule);
    fallback.maskingRules.set(key, list);
    return rule;
  }
  const result = await query(`INSERT INTO masking_rules(environment_id, field_name, pattern, replacement, enabled)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(environment_id, field_name) DO UPDATE SET pattern=EXCLUDED.pattern, replacement=EXCLUDED.replacement, enabled=EXCLUDED.enabled
    RETURNING id, field_name, pattern, replacement, enabled`,
    [env.id, field, payload.pattern || null, payload.replacement || '[MASKED]', payload.enabled !== false]);
  return result.rows[0];
}

export async function deleteMaskingRule(workspaceSlug, environmentName, ruleIdOrField) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  const keyVal = String(ruleIdOrField || '').trim();
  if (!keyVal) throw new Error('Masking rule id or field is required');
  if (!hasDatabase) {
    const key = `${workspaceSlug}:${environmentName}`;
    const list = fallback.maskingRules.get(key) || [];
    const next = list.filter(r => r.id !== keyVal && r.field_name !== keyVal);
    fallback.maskingRules.set(key, next);
    return { deleted: list.length - next.length };
  }
  const result = await query(`DELETE FROM masking_rules WHERE environment_id=$1 AND (id::text=$2 OR field_name=$2) RETURNING id`, [env.id, keyVal]);
  if (result.rowCount) return { deleted: result.rowCount || 0 };
  const builtin = ['password','authorization','token'].includes(keyVal.toLowerCase());
  if (builtin) {
    await query(`INSERT INTO masking_rules(environment_id, field_name, pattern, replacement, enabled)
      VALUES($1,$2,NULL,'[MASKED]',false)
      ON CONFLICT(environment_id, field_name) DO UPDATE SET enabled=false`, [env.id, keyVal.toLowerCase()]);
    return { deleted: 1, disabled_builtin: true };
  }
  return { deleted: 0 };
}

export async function resetEnvironmentPolicy(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return null;
  if (!hasDatabase) return { reset: true, local_only: true };
  await query(`DELETE FROM environment_policies WHERE environment_id=$1`, [env.id]);
  return getEnvironmentConfig(workspaceSlug, environmentName);
}
