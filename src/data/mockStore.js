export const workspaces = [
  { id: 'fsbl', name: 'FSBL Production Ops' },
  { id: 'payments', name: 'Payments Platform' },
  { id: 'internal', name: 'Internal APIs' }
];

export const environments = ['PROD', 'UAT', 'DEV', 'DR'];

const base = {
  PROD: { health: 92, uptime: 99.94, errorRate: 5.1, p95: 842, logs: '12.8M', alerts: 17, critical: 3, queueLag: '18m', db: 'OK' },
  UAT: { health: 96, uptime: 99.70, errorRate: 1.8, p95: 610, logs: '3.6M', alerts: 6, critical: 0, queueLag: '9m', db: 'OK' },
  DEV: { health: 99, uptime: 99.50, errorRate: 0.4, p95: 420, logs: '1.1M', alerts: 2, critical: 0, queueLag: '0m', db: 'OK' },
  DR: { health: 100, uptime: 100, errorRate: 0, p95: 180, logs: '128K', alerts: 0, critical: 0, queueLag: '0m', db: 'READY' }
};

export function getOverview(workspaceId, environment) {
  const metrics = base[environment] ?? base.PROD;
  return {
    workspaceId,
    environment,
    metrics,
    summary: {
      applications: 54,
      externalApis: 31,
      internalApis: 23,
      deployments: 8,
      ingestionJobs: 12
    }
  };
}

export function getServices(workspaceId, environment) {
  return [
    {
      id: 'payment-engine-api',
      name: 'payment-engine-api',
      owner: 'Payments Team',
      runtime: '4.4',
      version: '1.8.4',
      health: environment === 'PROD' ? 92.1 : 97.2,
      errorRate: environment === 'PROD' ? 5.1 : 1.2,
      p95: environment === 'PROD' ? 842 : 530,
      status: environment === 'PROD' ? 'Degraded' : 'Healthy',
      lastDeploy: '1d ago'
    },
    {
      id: 'employee-portal-api',
      name: 'employee-portal-api',
      owner: 'EP Integration Team',
      runtime: '4.4',
      version: '2.3.1',
      health: 97.8,
      errorRate: 0.42,
      p95: 420,
      status: 'Healthy',
      lastDeploy: '2h ago'
    },
    {
      id: 'bbps-integration-api',
      name: 'bbps-integration-api',
      owner: 'Banking Team',
      runtime: '4.4',
      version: '1.4.0',
      health: 96.8,
      errorRate: 1.9,
      p95: 610,
      status: 'Watch',
      lastDeploy: '5h ago'
    }
  ].map(service => ({ ...service, workspaceId, environment }));
}

export function getEndpoints(workspaceId, environment, serviceId = 'payment-engine-api') {
  return [
    { method: 'POST', path: '/payment/status', callsPerHour: 8240, errorRate: 4.8, p95: 880, backendMs: 720, lastFailure: '2m ago', serviceId },
    { method: 'GET', path: '/employee/profile/{id}', callsPerHour: 14820, errorRate: 0.2, p95: 260, backendMs: 90, lastFailure: '46m ago', serviceId: 'employee-portal-api' },
    { method: 'POST', path: '/bbps/bill/fetch', callsPerHour: 5740, errorRate: 1.9, p95: 610, backendMs: 480, lastFailure: '8m ago', serviceId: 'bbps-integration-api' },
    { method: 'PUT', path: '/mandate/update', callsPerHour: 3120, errorRate: 0.6, p95: 340, backendMs: 180, lastFailure: '1h ago', serviceId }
  ].map(endpoint => ({ ...endpoint, workspaceId, environment }));
}

export function getTraces(workspaceId, environment) {
  return [
    { traceId: 'TR-8FA91C', endpoint: '/payment/status', latency: 842, status: 'Slow', spans: [22, 33, 16, 29] },
    { traceId: 'TR-23BD77', endpoint: '/bbps/bill/fetch', latency: 691, status: 'Watch', spans: [14, 48, 12, 26] },
    { traceId: 'TR-77A10E', endpoint: '/employee/profile/{id}', latency: 514, status: 'OK', spans: [38, 20, 16, 26] }
  ].map(trace => ({ ...trace, workspaceId, environment }));
}

export function getLogs(workspaceId, environment) {
  return [
    { time: '11:24:12', level: 'ERROR', message: 'TR-8FA91C payment timeout after 800ms' },
    { time: '11:24:09', level: 'WARN', message: 'Retry policy triggered for backend connector' },
    { time: '11:24:05', level: 'INFO', message: 'Request completed employee-profile-api' },
    { time: '11:23:58', level: 'INFO', message: 'Masked PII fields: mobile,email,pan' }
  ].map(log => ({ ...log, workspaceId, environment }));
}

export function getAlerts(workspaceId, environment) {
  return [
    { priority: 'P1', title: 'Error rate crossed 5%', detail: 'payment-engine-api · /payment/status' },
    { priority: 'P2', title: 'Retry burst detected', detail: 'External bank dependency' },
    { priority: 'Info', title: 'Masking rule recommendation', detail: 'Mobile, PAN, Aadhaar' }
  ].map(alert => ({ ...alert, workspaceId, environment }));
}

export function getRca(workspaceId, environment) {
  return {
    workspaceId,
    environment,
    detectedPattern: 'payment-engine-api has timeout bursts after retry amplification in the selected environment.',
    likelyRootCause: 'External partner API latency increased while retry policy amplified traffic.',
    recommendation: 'Verify partner API health, reduce retry burst, enable circuit breaker and validate /payment/status.',
    businessImpact: {
      failedPayments: 128,
      affectedConsumers: 317,
      delayedLeadUpdates: 42
    }
  };
}
