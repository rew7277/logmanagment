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

export async function getWorkspaces() {
  if (!hasDatabase) return fallback.workspaces;
  const result = await query(`SELECT id, name, slug FROM workspaces ORDER BY created_at ASC`);
  return result.rows;
}

export async function getEnvironment(workspaceSlug, environmentName) {
  if (!hasDatabase) {
    return fallback.environments.find((e) => e.name === environmentName) || fallback.environments[0];
  }
  const result = await query(
    `SELECT e.*, w.slug workspace_slug, w.name workspace_name, o.id org_id, w.id workspace_id
     FROM environments e
     JOIN workspaces w ON w.id = e.workspace_id
     JOIN organizations o ON o.id = w.org_id
     WHERE w.slug=$1 AND e.name=$2`,
    [workspaceSlug, environmentName]
  );
  return result.rows[0];
}

export async function getOverview(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return null;

  if (!hasDatabase) {
    return {
      environment: env,
      metrics: {
        logs_ingested: 12_800_000,
        error_rate: 5.1,
        p95_latency_ms: 842,
        active_alerts: 17,
        services: 54,
        endpoints: 128,
        masking_coverage: 98.7
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
      masking_coverage: 98.7
    }
  };
}

export async function getServices(workspaceSlug, environmentName) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  if (!hasDatabase) {
    return [
      { name: 'payment-engine-api',  owner: 'Payments Team',       runtime_version: '4.4.0', app_version: '1.0.8', status: 'degraded', health_score: 92.1, error_rate: 5.1,  p95_latency_ms: 842 },
      { name: 'employee-portal-api', owner: 'EP Integration Team', runtime_version: '4.4.0', app_version: '2.3.1', status: 'healthy',  health_score: 97.8, error_rate: 0.42, p95_latency_ms: 420 },
      { name: 'bbps-integration-api',owner: 'Banking Team',        runtime_version: '4.4.0', app_version: '1.5.2', status: 'watch',    health_score: 96.8, error_rate: 1.9,  p95_latency_ms: 610 }
    ];
  }
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
  if (!hasDatabase) {
    return [
      { method: 'POST', path: '/payment/status', service_name: 'payment-engine-api', status: 'degraded', calls_per_hour: 1840, error_rate: 5.1, p95_latency_ms: 842, backend_ms: 720 },
      { method: 'POST', path: '/payment/initiate', service_name: 'payment-engine-api', status: 'healthy', calls_per_hour: 920, error_rate: 0.4, p95_latency_ms: 390, backend_ms: 240 }
    ];
  }
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

export async function getLogs(workspaceSlug, environmentName, limit = 100, search = '') {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  if (!hasDatabase) {
    return [
      { timestamp: new Date().toISOString(), severity: 'ERROR', trace_id: 'TR-8FA91C', message: 'Backend timeout on payment-engine connector after 800ms' },
      { timestamp: new Date().toISOString(), severity: 'WARN',  trace_id: 'TR-8FA91C', message: 'Retry policy triggered for external bank dependency' }
    ];
  }
  const result = await query(
    `SELECT le.id, le.timestamp, le.severity, le.trace_id, le.message, s.name service_name, ep.method, ep.path
     FROM log_events le
     LEFT JOIN services s ON s.id=le.service_id
     LEFT JOIN endpoints ep ON ep.id=le.endpoint_id
     WHERE le.environment_id=$1
       AND ($3 = '' OR le.message ILIKE '%' || $3 || '%' OR le.trace_id ILIKE '%' || $3 || '%' OR s.name ILIKE '%' || $3 || '%' OR to_tsvector('simple', le.message) @@ plainto_tsquery('simple', $3))
     ORDER BY le.timestamp DESC
     LIMIT $2`,
    [env.id, limit, String(search || '').trim()]
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
  if (!hasDatabase) return [{ trace_id: 'TR-8FA91C', status: 'error', latency_ms: 842, service_name: 'payment-engine-api', path: '/payment/status' }];
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
  if (!hasDatabase) return [{ severity: 'P1', title: 'PROD error rate crossed 5%', description: 'Payment endpoint timeout cluster detected', status: 'open' }];
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
