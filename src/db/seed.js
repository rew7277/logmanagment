import { query, hasDatabase } from './pool.js';
import { migrate } from './migrate.js';

const services = [
  ['payment-engine-api', 'Payments Team', '4.4.0', '1.0.8', 'degraded', 92.1],
  ['employee-portal-api', 'EP Integration Team', '4.4.0', '2.3.1', 'healthy', 97.8],
  ['bbps-integration-api', 'Banking Team', '4.4.0', '1.5.2', 'watch', 96.8],
  ['pennydrop-api', 'Banking Team', '4.4.0', '1.2.4', 'healthy', 99.5]
];

const endpoints = {
  'payment-engine-api': [
    ['POST', '/payment/status', 'degraded'],
    ['POST', '/payment/initiate', 'healthy'],
    ['PUT', '/mandate/update', 'healthy']
  ],
  'employee-portal-api': [
    ['GET', '/employee/profile/{id}', 'healthy'],
    ['POST', '/employee/sync', 'watch']
  ],
  'bbps-integration-api': [
    ['POST', '/bbps/bill/fetch', 'watch'],
    ['POST', '/bbps/payment/confirm', 'healthy']
  ],
  'pennydrop-api': [
    ['POST', '/pennydrop/verify', 'healthy']
  ]
};

async function ensureCoreData() {
  const org = await query(
    `INSERT INTO organizations(name, slug) VALUES($1,$2)
     ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name
     RETURNING id`,
    ['Five Star Business Finance', 'fsbl']
  );
  const orgId = org.rows[0].id;

  const ws = await query(
    `INSERT INTO workspaces(org_id, name, slug) VALUES($1,$2,$3)
     ON CONFLICT(org_id, slug) DO UPDATE SET name=EXCLUDED.name
     RETURNING id`,
    [orgId, 'FSBL Production Ops', 'fsbl-prod-ops']
  );
  const workspaceId = ws.rows[0].id;

  const envRows = [];
  for (const env of ['PROD', 'UAT', 'DEV', 'DR']) {
    const health = env === 'PROD' ? 92 : env === 'UAT' ? 96 : env === 'DEV' ? 99 : 100;
    const status = env === 'PROD' ? 'degraded' : env === 'UAT' ? 'watch' : 'healthy';
    const result = await query(
      `INSERT INTO environments(workspace_id, name, display_name, health_score, status)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(workspace_id, name) DO UPDATE SET health_score=EXCLUDED.health_score, status=EXCLUDED.status
       RETURNING id, name`,
      [workspaceId, env, env, health, status]
    );
    envRows.push(result.rows[0]);
  }

  for (const envRow of envRows) {
    for (const [name, owner, runtime, version, status, health] of services) {
      const service = await query(
        `INSERT INTO services(environment_id, name, owner, runtime_version, app_version, status, health_score)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(environment_id, name) DO UPDATE SET owner=EXCLUDED.owner, runtime_version=EXCLUDED.runtime_version, app_version=EXCLUDED.app_version, status=EXCLUDED.status, health_score=EXCLUDED.health_score
         RETURNING id`,
        [envRow.id, name, owner, runtime, version, envRow.name === 'PROD' ? status : status === 'degraded' ? 'watch' : status, envRow.name === 'PROD' ? health : Math.min(100, Number(health) + 2)]
      );
      for (const [method, path, epStatus] of endpoints[name] || []) {
        await query(
          `INSERT INTO endpoints(service_id, method, path, status)
           VALUES($1,$2,$3,$4)
           ON CONFLICT(service_id, method, path) DO UPDATE SET status=EXCLUDED.status`,
          [service.rows[0].id, method, path, envRow.name === 'PROD' ? epStatus : 'healthy']
        );
      }
    }
  }

  return { orgId, workspaceId };
}

async function insertDemoEvents() {
  const env = await query(`SELECT e.id, e.name, w.id workspace_id, o.id org_id
    FROM environments e
    JOIN workspaces w ON w.id = e.workspace_id
    JOIN organizations o ON o.id = w.org_id
    WHERE e.name = 'PROD'
    LIMIT 1`);
  if (!env.rows.length) return;
  const { id: environmentId, workspace_id: workspaceId, org_id: orgId } = env.rows[0];

  const svc = await query(`SELECT id, name FROM services WHERE environment_id=$1`, [environmentId]);
  const serviceMap = Object.fromEntries(svc.rows.map((row) => [row.name, row.id]));
  const endpoint = await query(`SELECT ep.id, s.name service_name, ep.path FROM endpoints ep JOIN services s ON s.id=ep.service_id WHERE s.environment_id=$1`, [environmentId]);
  const endpointMap = Object.fromEntries(endpoint.rows.map((row) => [`${row.service_name}:${row.path}`, row.id]));

  const existing = await query(`SELECT count(*)::int count FROM log_events WHERE environment_id=$1`, [environmentId]);
  if (existing.rows[0].count > 0) return;

  const samples = [
    ['ERROR', 'TR-8FA91C', 'payment-engine-api', '/payment/status', 'Backend timeout on payment-engine connector after 800ms'],
    ['WARN', 'TR-8FA91C', 'payment-engine-api', '/payment/status', 'Retry policy triggered for external bank dependency'],
    ['INFO', 'TR-77A10E', 'employee-portal-api', '/employee/profile/{id}', 'Request completed employee-profile-api'],
    ['WARN', 'TR-23BD77', 'bbps-integration-api', '/bbps/bill/fetch', 'Partner API latency above threshold'],
    ['INFO', 'TR-90CD21', 'pennydrop-api', '/pennydrop/verify', 'Sensitive fields masked before indexing']
  ];

  for (const [severity, traceId, serviceName, path, message] of samples) {
    await query(
      `INSERT INTO log_events(org_id, workspace_id, environment_id, service_id, endpoint_id, severity, trace_id, message, raw)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [orgId, workspaceId, environmentId, serviceMap[serviceName], endpointMap[`${serviceName}:${path}`], severity, traceId, message, { source: 'seed' }]
    );
  }

  await query(
    `INSERT INTO traces(environment_id, service_id, endpoint_id, trace_id, status, latency_ms, meta)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(environment_id, trace_id) DO NOTHING`,
    [environmentId, serviceMap['payment-engine-api'], endpointMap['payment-engine-api:/payment/status'], 'TR-8FA91C', 'error', 842, { backend_ms: 720 }]
  );

  await query(
    `INSERT INTO alerts(environment_id, service_id, endpoint_id, severity, title, description)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [environmentId, serviceMap['payment-engine-api'], endpointMap['payment-engine-api:/payment/status'], 'P1', 'PROD error rate crossed 5%', 'Payment status endpoint timeout cluster detected.']
  );

  await query(
    `INSERT INTO deployments(environment_id, service_id, version, deployed_by, before_error_rate, after_error_rate, before_p95_ms, after_p95_ms, notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [environmentId, serviceMap['payment-engine-api'], '1.0.8', 'release-bot', 0.008, 0.051, 286, 842, 'Spike detected after latest deployment']
  );

  await query(
    `INSERT INTO ingestion_jobs(environment_id, source_type, source_name, status, last_received_at, accepted_count, rejected_count, parser_errors)
     VALUES($1,'S3','prod/app-logs/hourly','healthy',now() - interval '2 minutes',128000,12,3),
           ($1,'API','mulesoft-log-push','healthy',now() - interval '1 minute',42000,4,0),
           ($1,'UPLOAD','manual-incident-upload','watch',now() - interval '18 minutes',840,12,12)`,
    [environmentId]
  );

  await query(
    `INSERT INTO security_events(environment_id, event_type, severity, message, count)
     VALUES($1,'PII_MASKING','INFO','Aadhaar, PAN, mobile and email masked before indexing',987),
           ($1,'RATE_LIMIT','WARN','Suspicious IP burst blocked by rate limiting',284),
           ($1,'SECRET_SCAN','INFO','No active secret detected in recent logs',1)`,
    [environmentId]
  );
}

export async function seed() {
  if (!hasDatabase) return;
  await migrate();
  await ensureCoreData();
  await insertDemoEvents();
  console.log('[db] seed completed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[db] seed failed', error);
      process.exit(1);
    });
}
