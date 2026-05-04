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
  ingestion: []
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
    `SELECT s.id, s.name, s.owner, s.runtime_version, s.app_version, s.status, s.health_score,
            COALESCE(100.0 * count(le.*) FILTER (WHERE le.severity IN ('ERROR','FATAL')) / NULLIF(count(le.*),0),0)::numeric(7,2) error_rate,
            COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY t.latency_ms),0)::int p95_latency_ms
     FROM services s
     LEFT JOIN log_events le ON le.service_id=s.id
     LEFT JOIN traces t ON t.service_id=s.id AND t.started_at >= now() - interval '24 hours'
     WHERE s.environment_id=$1 AND s.name !~* '\.xml(:[0-9]+)?$'
     GROUP BY s.id
     ORDER BY s.health_score ASC, s.name ASC`,
    [env.id]
  );
  return result.rows;
}

export async function getEndpoints(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  if (!hasDatabase) return fallbackEndpoints(environmentName);
  const result = await query(
    `SELECT ep.id, ep.method, ep.path, ep.status, s.name service_name,
            count(le.*)::int calls_total,
            COALESCE(100.0 * count(le.*) FILTER (WHERE le.severity IN ('ERROR','FATAL')) / NULLIF(count(le.*),0),0)::numeric(7,2) error_rate,
            COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY t.latency_ms),0)::int p95_latency_ms,
            COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY ((t.meta->>'backend_ms')::int)),0)::int backend_ms
     FROM endpoints ep
     JOIN services s ON s.id=ep.service_id
     LEFT JOIN log_events le ON le.endpoint_id=ep.id
     LEFT JOIN traces t ON t.endpoint_id=ep.id AND t.started_at >= now() - interval '24 hours'
     WHERE s.environment_id=$1 AND s.name !~* '\.xml(:[0-9]+)?$'
     GROUP BY ep.id, s.name
     ORDER BY s.name, ep.method, ep.path`,
    [env.id]
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
              CASE WHEN s.name ~* '\.xml(:[0-9]+)?$' THEN NULL ELSE s.name END service_name, ep.method, ep.path
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
     VALUES($1,$2,$3,$4,$5,0,COALESCE($6, now()),$7)
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
      path: payload.path || payload.endpoint || null
    })]
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
     VALUES($1,$2,$3,$4,$5,COALESCE($6, now()),$7,$8,$9,$10)
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
export async function bulkCreateLogs(workspaceSlug, environmentName, logs, options = {}) {
  if (!Array.isArray(logs) || logs.length === 0) return [];
  logs = sanitizeParsedRecords(logs).filter(l => l && (l.message || l.raw));
  if (!logs.length) return [];
  if (!hasDatabase) {
    const created = logs.map((l, i) => {
      const row = {
        id: `local-${Date.now()}-${i}`,
        environment_name: environmentName,
        timestamp: l.timestamp || new Date().toISOString(),
        severity: String(l.severity || 'INFO').toUpperCase(),
        trace_id: l.trace_id || null,
        service_name: l.service_name || l.service || null,
        method: l.method ? String(l.method).toUpperCase() : null,
        path: l.path || l.endpoint || null,
        message: l.message || String(l.raw || ''),
        raw: l.raw || l,
        upload_id: options.uploadId || null
      };
      return row;
    });
    fallback.logs.push(...created);
    if (!options.uploadId) fallback.ingestion.unshift({ id:`local-upload-${Date.now()}`, source_type:'UPLOAD', source_name:options.sourceName || 'browser/API upload', status:'healthy', accepted_count:created.length, rejected_count:0, parser_errors:0, meta:{bytes:options.bytes||0}, created_at:new Date().toISOString() });
    return created;
  }
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) throw new Error('Environment not found');

  return withTransaction(async (client) => {
    const serviceCache = new Map();
    const endpointCache = new Map();

    const services = [...new Set(logs.map(l => l.service_name || l.service).filter(v => v && !String(v).toLowerCase().endsWith('.xml')))];
    for (const name of services) {
      const svc = await client.query(
        `INSERT INTO services(environment_id, name, status)
         VALUES($1,$2,'observed')
         ON CONFLICT(environment_id, name) DO UPDATE SET name=EXCLUDED.name
         RETURNING id`,
        [env.id, name]
      );
      serviceCache.set(name, svc.rows[0].id);
    }

    const endpointKeys = [];
    for (const log of logs) {
      const serviceName = (log.service_name || log.service);
      if (serviceName && String(serviceName).toLowerCase().endsWith('.xml')) continue;
      const serviceId = serviceCache.get(serviceName);
      const method = log.method ? String(log.method).toUpperCase() : null;
      const logPath = log.path || log.endpoint || null;
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
         VALUES($1,$2,$3,'observed')
         ON CONFLICT(service_id, method, path) DO UPDATE SET path=EXCLUDED.path
         RETURNING id`,
        [epItem.serviceId, epItem.method, epItem.path]
      );
      endpointCache.set(epItem.key, ep.rows[0].id);
    }

    const values = [];
    const placeholders = [];
    logs.forEach((payload, idx) => {
      const rawServiceName = payload.service_name || payload.service || null;
      const serviceName = rawServiceName && !String(rawServiceName).toLowerCase().endsWith('.xml') ? rawServiceName : null;
      const serviceId = serviceCache.get(serviceName) || null;
      const method = payload.method ? String(payload.method).toUpperCase() : null;
      const logPath = payload.path || payload.endpoint || null;
      const endpointId = serviceId && method && logPath ? endpointCache.get(`${serviceId}|${method}|${logPath}`) || null : null;
      const base = idx * 11;
      placeholders.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},COALESCE($${base+7}, now()),$${base+8},$${base+9},$${base+10},$${base+11})`);
      values.push(
        env.org_id, env.workspace_id, env.id,
        serviceId, endpointId, options.uploadId || null,
        payload.timestamp || null,
        String(payload.severity || 'INFO').toUpperCase(),
        payload.trace_id || null,
        payload.message || String(payload.raw || ''),
        JSON.stringify(payload)
      );
    });

    const result = await client.query(
      `INSERT INTO log_events(org_id, workspace_id, environment_id, service_id, endpoint_id, upload_id, timestamp, severity, trace_id, message, raw)
       VALUES ${placeholders.join(',')}
       RETURNING id, timestamp, severity, trace_id, message`,
      values
    );

    // Fast trace rollup: old code upserted one trace per log row. That made uploads slow.
    // This keeps one representative row per trace and performs one bulk upsert.
    const traceMap = new Map();
    for (const payload of logs) {
      const traceId = payload.trace_id || payload.raw?.trace_id || payload.raw?.event_id || payload.raw?.correlation_id;
      if (!traceId) continue;
      const rawServiceName = payload.service_name || payload.service || null;
      const serviceName = rawServiceName && !String(rawServiceName).toLowerCase().endsWith('.xml') ? rawServiceName : null;
      const serviceId = serviceCache.get(serviceName) || null;
      const method = payload.method ? String(payload.method).toUpperCase() : null;
      const logPath = payload.path || payload.endpoint || null;
      const endpointId = serviceId && method && logPath ? endpointCache.get(`${serviceId}|${method}|${logPath}`) || null : null;
      const severity = String(payload.severity || '').toUpperCase();
      const status = ['ERROR','FATAL'].includes(severity) ? 'error' : 'success';
      const existing = traceMap.get(traceId);
      if (!existing) {
        traceMap.set(traceId, { traceId, serviceId, endpointId, status, startedAt: payload.timestamp || null, payload });
      } else {
        existing.status = existing.status === 'error' || status === 'error' ? 'error' : status;
        existing.serviceId = existing.serviceId || serviceId;
        existing.endpointId = existing.endpointId || endpointId;
        if (payload.timestamp && (!existing.startedAt || new Date(payload.timestamp) < new Date(existing.startedAt))) existing.startedAt = payload.timestamp;
      }
    }
    const traceItems = [...traceMap.values()];
    if (traceItems.length) {
      const traceValues = [];
      const tracePlaceholders = [];
      traceItems.forEach((t, idx) => {
        const base = idx * 8;
        const payload = t.payload || {};
        tracePlaceholders.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},0,COALESCE($${base+6}, now()),$${base+7}::jsonb)`);
        traceValues.push(env.id, t.serviceId, t.endpointId, t.traceId, t.status, t.startedAt || null, JSON.stringify({
          event_id: payload.raw?.event_id || t.traceId,
          correlation_id: payload.raw?.correlation_id || t.traceId,
          transaction_id: payload.transaction_id || payload.raw?.transaction_id || null,
          service_name: payload.service_name || payload.service || null,
          method: payload.method || null,
          path: payload.path || payload.endpoint || null,
          rolled_up_events: logs.length
        }));
      });
      await client.query(
        `INSERT INTO traces(environment_id, service_id, endpoint_id, trace_id, status, latency_ms, started_at, meta)
         VALUES ${tracePlaceholders.join(',')}
         ON CONFLICT(environment_id, trace_id) DO UPDATE SET
           service_id=COALESCE(traces.service_id, EXCLUDED.service_id),
           endpoint_id=COALESCE(traces.endpoint_id, EXCLUDED.endpoint_id),
           status=CASE WHEN traces.status='error' OR EXCLUDED.status='error' THEN 'error' ELSE EXCLUDED.status END,
           started_at=LEAST(traces.started_at, EXCLUDED.started_at),
           meta=traces.meta || EXCLUDED.meta`,
        traceValues
      );
    }

    if (!options.uploadId) {
      await client.query(
        `INSERT INTO ingestion_jobs(environment_id, source_type, source_name, status, last_received_at, accepted_count, rejected_count, parser_errors, meta)
         VALUES($1,'UPLOAD',$2,'completed',now(),$3,0,0,$4)`,
        [env.id, options.sourceName || 'browser/API upload', result.rowCount, JSON.stringify({ batch_size: logs.length, bytes: options.bytes || 0 })]
      );
    }

    return result.rows;
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
       status=COALESCE($3,status),
       accepted_count=COALESCE($4,accepted_count),
       rejected_count=COALESCE($5,rejected_count),
       parser_errors=COALESCE($6,parser_errors),
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
    `SELECT t.*, CASE WHEN s.name ~* '\.xml(:[0-9]+)?$' THEN NULL ELSE s.name END service_name, ep.method, ep.path
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

export async function rca(workspaceSlug, environmentName, queryText = '') {
  const [overview, alerts, logs] = await Promise.all([
    getOverview(workspaceSlug, environmentName),
    getAlerts(workspaceSlug, environmentName),
    getLogs(workspaceSlug, environmentName, 50, queryText)
  ]);

  const logRows = Array.isArray(logs) ? logs : (logs.items || []);
  const topError = logRows.find((log) => ['ERROR', 'FATAL'].includes(log.severity));
  const warnCount = logRows.filter((log) => log.severity === 'WARN').length;
  const errorCount = logRows.filter((log) => ['ERROR', 'FATAL'].includes(log.severity)).length;
  const affectedServices = [...new Set(logRows.map((l) => l.service_name).filter(Boolean))].slice(0, 5);
  return {
    environment: environmentName,
    query: queryText,
    summary: `${environmentName} RCA is scoped to this environment only. Health: ${overview?.environment?.health_score ?? 'N/A'}, active alerts: ${overview?.metrics?.active_alerts ?? 0}.`,
    likely_root_cause: topError ? topError.message : 'No critical error pattern found in the matched/latest logs.',
    impact: alerts.slice(0, 3).map((a) => a.title),
    evidence: { matched_logs: logRows.length, errors: errorCount, warnings: warnCount, affected_services: affectedServices },
    recommended_actions: [
      'Open the affected service and endpoint first.',
      'Inspect slow traces and backend latency split.',
      'Validate recent deployment impact for the same environment only.',
      'Do not compare or merge logs from other environments unless using an explicit compare screen.'
    ]
  };
}
