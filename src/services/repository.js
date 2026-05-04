import { query, hasDatabase } from '../db/pool.js';

const fallback = {
  workspaces: [{ id: 'demo-workspace', name: 'FSBL Production Ops', slug: 'fsbl-prod-ops' }],
  environments: [
    { id: 'env-prod', name: 'PROD', display_name: 'PROD', health_score: 92, status: 'degraded' },
    { id: 'env-uat', name: 'UAT', display_name: 'UAT', health_score: 96, status: 'watch' },
    { id: 'env-dev', name: 'DEV', display_name: 'DEV', health_score: 99, status: 'healthy' },
    { id: 'env-dr', name: 'DR', display_name: 'DR', health_score: 100, status: 'healthy' }
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
        logs_ingested: 12800000,
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
    query(`SELECT count(*)::int logs_ingested,
           COALESCE(100.0 * count(*) FILTER (WHERE severity IN ('ERROR','FATAL')) / NULLIF(count(*),0),0)::numeric(7,2) error_rate
           FROM log_events WHERE environment_id=$1 AND timestamp >= now() - interval '24 hours'`, [env.id]),
    query(`SELECT count(*)::int active_alerts FROM alerts WHERE environment_id=$1 AND status='open'`, [env.id]),
    query(`SELECT count(*)::int services FROM services WHERE environment_id=$1`, [env.id]),
    query(`SELECT count(*)::int endpoints FROM endpoints ep JOIN services s ON s.id=ep.service_id WHERE s.environment_id=$1`, [env.id]),
    query(`SELECT COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),0)::int p95_latency_ms FROM traces WHERE environment_id=$1 AND started_at >= now() - interval '24 hours'`, [env.id])
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
      { name: 'payment-engine-api', owner: 'Payments Team', runtime_version: '4.4.0', app_version: '1.0.8', status: 'degraded', health_score: 92.1, error_rate: 5.1, p95_latency_ms: 842 },
      { name: 'employee-portal-api', owner: 'EP Integration Team', runtime_version: '4.4.0', app_version: '2.3.1', status: 'healthy', health_score: 97.8, error_rate: 0.42, p95_latency_ms: 420 },
      { name: 'bbps-integration-api', owner: 'Banking Team', runtime_version: '4.4.0', app_version: '1.5.2', status: 'watch', health_score: 96.8, error_rate: 1.9, p95_latency_ms: 610 }
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
      { method: 'POST', path: '/payment/status', service_name: 'payment-engine-api', calls_per_hour: 8240, error_rate: 4.8, p95_latency_ms: 880, backend_ms: 720, last_failure: '2m ago', status: 'degraded' },
      { method: 'GET', path: '/employee/profile/{id}', service_name: 'employee-portal-api', calls_per_hour: 14820, error_rate: 0.2, p95_latency_ms: 260, backend_ms: 90, last_failure: '46m ago', status: 'healthy' }
    ];
  }
  const result = await query(
    `SELECT ep.id, ep.method, ep.path, ep.status, s.name service_name,
      count(le.*)::int calls_per_hour,
      COALESCE(100.0 * count(le.*) FILTER (WHERE le.severity IN ('ERROR','FATAL')) / NULLIF(count(le.*),0),0)::numeric(7,2) error_rate,
      COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY t.latency_ms),0)::int p95_latency_ms,
      COALESCE(max((t.meta->>'backend_ms')::int),0) backend_ms,
      max(le.timestamp) FILTER (WHERE le.severity IN ('ERROR','FATAL')) last_failure
     FROM endpoints ep
     JOIN services s ON s.id=ep.service_id
     LEFT JOIN log_events le ON le.endpoint_id=ep.id AND le.timestamp >= now() - interval '1 hour'
     LEFT JOIN traces t ON t.endpoint_id=ep.id AND t.started_at >= now() - interval '24 hours'
     WHERE s.environment_id=$1
     GROUP BY ep.id, s.name
     ORDER BY error_rate DESC, calls_per_hour DESC`,
    [env.id]
  );
  return result.rows;
}

export async function getLogs(workspaceSlug, environmentName, limit = 100) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) return [];
  if (!hasDatabase) {
    return [
      { timestamp: new Date().toISOString(), severity: 'ERROR', trace_id: 'TR-8FA91C', message: 'Backend timeout on payment-engine connector after 800ms' },
      { timestamp: new Date().toISOString(), severity: 'WARN', trace_id: 'TR-8FA91C', message: 'Retry policy triggered for external bank dependency' }
    ];
  }
  const result = await query(
    `SELECT le.id, le.timestamp, le.severity, le.trace_id, le.message, s.name service_name, ep.method, ep.path
     FROM log_events le
     LEFT JOIN services s ON s.id=le.service_id
     LEFT JOIN endpoints ep ON ep.id=le.endpoint_id
     WHERE le.environment_id=$1
     ORDER BY le.timestamp DESC
     LIMIT $2`,
    [env.id, limit]
  );
  return result.rows;
}

export async function createLog(workspaceSlug, environmentName, payload) {
  const env = await getEnvironment(workspaceSlug, environmentName);
  if (!env) throw new Error('Environment not found');
  if (!hasDatabase) return { id: crypto.randomUUID?.() || String(Date.now()), ...payload };

  const serviceName = payload.service_name || payload.service || null;
  const method = payload.method || null;
  const path = payload.path || payload.endpoint || null;

  let serviceId = null;
  let endpointId = null;

  if (serviceName) {
    const service = await query(
      `INSERT INTO services(environment_id, name, status)
       VALUES($1,$2,'healthy')
       ON CONFLICT(environment_id, name) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [env.id, serviceName]
    );
    serviceId = service.rows[0].id;
  }

  if (serviceId && method && path) {
    const ep = await query(
      `INSERT INTO endpoints(service_id, method, path, status)
       VALUES($1,$2,$3,'healthy')
       ON CONFLICT(service_id, method, path) DO UPDATE SET path=EXCLUDED.path
       RETURNING id`,
      [serviceId, method.toUpperCase(), path]
    );
    endpointId = ep.rows[0].id;
  }

  const result = await query(
    `INSERT INTO log_events(org_id, workspace_id, environment_id, service_id, endpoint_id, timestamp, severity, trace_id, message, raw)
     VALUES($1,$2,$3,$4,$5,COALESCE($6, now()),$7,$8,$9,$10)
     RETURNING *`,
    [env.org_id, env.workspace_id, env.id, serviceId, endpointId, payload.timestamp || null, payload.severity || 'INFO', payload.trace_id || null, payload.message || String(payload.raw || ''), payload]
  );
  return result.rows[0];
}

export async function bulkCreateLogs(workspaceSlug, environmentName, logs) {
  const created = [];
  for (const log of logs) {
    created.push(await createLog(workspaceSlug, environmentName, log));
  }
  return created;
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
      ingestion: [{ source_type: 'S3', source_name: 'prod/app-logs/hourly', status: 'healthy', accepted_count: 128000, rejected_count: 12, parser_errors: 3 }],
      security: [{ event_type: 'PII_MASKING', severity: 'INFO', message: 'PII masked before indexing', count: 987 }],
      deployments: [{ version: '1.0.8', before_error_rate: 0.008, after_error_rate: 0.051, before_p95_ms: 286, after_p95_ms: 842 }]
    };
  }
  const [ingestion, security, deployments] = await Promise.all([
    query(`SELECT * FROM ingestion_jobs WHERE environment_id=$1 ORDER BY created_at DESC LIMIT 20`, [env.id]),
    query(`SELECT * FROM security_events WHERE environment_id=$1 ORDER BY created_at DESC LIMIT 20`, [env.id]),
    query(`SELECT d.*, s.name service_name FROM deployments d LEFT JOIN services s ON s.id=d.service_id WHERE d.environment_id=$1 ORDER BY deployed_at DESC LIMIT 20`, [env.id])
  ]);
  return { ingestion: ingestion.rows, security: security.rows, deployments: deployments.rows };
}

export async function rca(workspaceSlug, environmentName, queryText = '') {
  const [overview, alerts, logs] = await Promise.all([
    getOverview(workspaceSlug, environmentName),
    getAlerts(workspaceSlug, environmentName),
    getLogs(workspaceSlug, environmentName, 20)
  ]);

  const topError = logs.find((log) => ['ERROR', 'FATAL'].includes(log.severity));
  return {
    environment: environmentName,
    query: queryText,
    summary: `${environmentName} RCA is scoped only to this environment. Current health is ${overview?.environment?.health_score ?? 'N/A'} with ${overview?.metrics?.active_alerts ?? 0} active alerts.`,
    likely_root_cause: topError ? topError.message : 'No critical error pattern found in the latest logs.',
    impact: alerts.slice(0, 3).map((alert) => alert.title),
    recommended_actions: [
      'Open the affected service and endpoint first.',
      'Inspect slow traces and backend latency split.',
      'Validate recent deployment impact for the same environment only.',
      'Do not compare or merge logs from other environments unless using an explicit compare screen.'
    ]
  };
}
