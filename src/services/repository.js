import { query, hasDatabase, withTransaction } from '../db/pool.js';

const fallback = {
  workspaces: [{ id: 'demo-workspace', name: 'FSBL Production Ops', slug: 'fsbl-prod-ops' }],
  environments: [
    { id: 'env-prod', name: 'PROD', display_name: 'PROD', health_score: 92, status: 'degraded' },
    { id: 'env-uat',  name: 'UAT',  display_name: 'UAT',  health_score: 96, status: 'watch' },
    { id: 'env-dev',  name: 'DEV',  display_name: 'DEV',  health_score: 99, status: 'healthy' },
    { id: 'env-dr',   name: 'DR',   display_name: 'DR',   health_score: 100, status: 'healthy' }
  ]
};


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
       FROM log_events WHERE environment_id=$1 AND timestamp >= now() - interval '24 hours'`,
      [env.id]
    ),
    query(`SELECT count(*)::int active_alerts FROM alerts WHERE environment_id=$1 AND status='open'`, [env.id]),
    query(`SELECT count(*)::int services FROM services WHERE environment_id=$1`, [env.id]),
    query(
      `SELECT count(*)::int endpoints FROM endpoints ep JOIN services s ON s.id=ep.service_id WHERE s.environment_id=$1`,
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
  if (!hasDatabase) return [];
  const result = await query(
    `SELECT s.id, s.name, s.owner, s.runtime_version, s.app_version, s.status, s.health_score,
            COALESCE(100.0 * count(le.*) FILTER (WHERE le.severity IN ('ERROR','FATAL')) / NULLIF(count(le.*),0),0)::numeric(7,2) error_rate,
            COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY t.latency_ms),0)::int p95_latency_ms
     FROM services s
     LEFT JOIN log_events le ON le.service_id=s.id AND le.timestamp >= now() - interval '24 hours'
     LEFT JOIN traces t ON t.service_id=s.id AND t.started_at >= now() - interval '24 hours'
     WHERE s.environment_id=$1
     GROUP BY s.id
     ORDER BY s.health_score ASC, s.name ASC`,
    [env.id]
  );
  return result.rows;
}

export async function getEndpoints(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  if (!hasDatabase) return [];
  const result = await query(
    `SELECT ep.id, ep.method, ep.path, ep.status, s.name service_name,
            count(le.*)::int calls_per_hour,
            COALESCE(100.0 * count(le.*) FILTER (WHERE le.severity IN ('ERROR','FATAL')) / NULLIF(count(le.*),0),0)::numeric(7,2) error_rate,
            COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY t.latency_ms),0)::int p95_latency_ms,
            COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY ((t.meta->>'backend_ms')::int)),0)::int backend_ms
     FROM endpoints ep
     JOIN services s ON s.id=ep.service_id
     LEFT JOIN log_events le ON le.endpoint_id=ep.id AND le.timestamp >= now() - interval '1 hour'
     LEFT JOIN traces t ON t.endpoint_id=ep.id AND t.started_at >= now() - interval '24 hours'
     WHERE s.environment_id=$1
     GROUP BY ep.id, s.name
     ORDER BY s.name, ep.method, ep.path`,
    [env.id]
  );
  return result.rows;
}

export async function getLogs(workspaceSlug, environmentName, limit = 100, filters = '') {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  const f = typeof filters === 'string' ? { q: filters } : (filters || {});
  if (!hasDatabase) return [];
  const values = [env.id, Math.min(Number(limit || 100), 1000)];
  const where = ['le.environment_id=$1'];
  const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
  const q = String(f.q || '').trim();
  if (q) {
    const base = values.length;
    values.push(q, q, q, q, q);
    where.push(`(le.message ILIKE '%' || $${base+1} || '%' OR le.trace_id ILIKE '%' || $${base+2} || '%' OR s.name ILIKE '%' || $${base+3} || '%' OR ep.path ILIKE '%' || $${base+4} || '%' OR to_tsvector('simple', le.message) @@ plainto_tsquery('simple', $${base+5}))`);
  }
  if (f.severity) add('le.severity = ?', String(f.severity).toUpperCase());
  if (f.service) add(`s.name ILIKE '%' || ? || '%'`, String(f.service));
  if (f.path) add(`ep.path ILIKE '%' || ? || '%'`, String(f.path));
  if (f.trace_id) add(`le.trace_id ILIKE '%' || ? || '%'`, String(f.trace_id));
  if (f.from) add('le.timestamp >= ?', f.from);
  if (f.to) add('le.timestamp <= ?', f.to);
  if (!f.from && !f.to && f.range && f.range !== 'custom') {
    const interval = f.range === '1h' ? '1 hour' : f.range === '7d' ? '7 days' : f.range === '30d' ? '30 days' : '24 hours';
    where.push(`le.timestamp >= now() - interval '${interval}'`);
  }
  const result = await query(
    `SELECT le.id, le.timestamp, le.severity, le.trace_id, le.message, s.name service_name, ep.method, ep.path
     FROM log_events le
     LEFT JOIN services s ON s.id=le.service_id
     LEFT JOIN endpoints ep ON ep.id=le.endpoint_id
     WHERE ${where.join(' AND ')}
     ORDER BY le.timestamp DESC
     LIMIT $2`,
    values
  );
  return result.rows;
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
export async function bulkCreateLogs(workspaceSlug, environmentName, logs) {
  if (!hasDatabase) {
    return logs.map((l) => ({ id: crypto.randomUUID(), ...l }));
  }
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) throw new Error('Environment not found');

  return withTransaction(async (client) => {
    const created = [];
    for (const log of logs) {
      created.push(await _insertLog(client, env, log));
    }
    return created;
  });
}

export async function getTraces(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  if (!hasDatabase) return [];
  const result = await query(
    `SELECT t.*, s.name service_name, ep.method, ep.path
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
    `SELECT a.*, s.name service_name, ep.method, ep.path
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
      ingestion:   [{ source_type: 'S3', source_name: 'prod/app-logs/hourly', status: 'healthy', accepted_count: 128000, rejected_count: 12, parser_errors: 3 }],
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

  const topError = logs.find((log) => ['ERROR', 'FATAL'].includes(log.severity));
  const warnCount = logs.filter((log) => log.severity === 'WARN').length;
  const errorCount = logs.filter((log) => ['ERROR', 'FATAL'].includes(log.severity)).length;
  const affectedServices = [...new Set(logs.map((l) => l.service_name).filter(Boolean))].slice(0, 5);
  return {
    environment: environmentName,
    query: queryText,
    summary: `${environmentName} RCA is scoped to this environment only. Health: ${overview?.environment?.health_score ?? 'N/A'}, active alerts: ${overview?.metrics?.active_alerts ?? 0}.`,
    likely_root_cause: topError ? topError.message : 'No critical error pattern found in the matched/latest logs.',
    impact: alerts.slice(0, 3).map((a) => a.title),
    evidence: { matched_logs: logs.length, errors: errorCount, warnings: warnCount, affected_services: affectedServices },
    recommended_actions: [
      'Open the affected service and endpoint first.',
      'Inspect slow traces and backend latency split.',
      'Validate recent deployment impact for the same environment only.',
      'Do not compare or merge logs from other environments unless using an explicit compare screen.'
    ]
  };
}
