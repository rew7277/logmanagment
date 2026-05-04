const workspaceSelect = document.getElementById('workspaceSelect');
const environmentSelect = document.getElementById('environmentSelect');
const activeEnvText = document.getElementById('activeEnvText');
const heroEnv = document.getElementById('heroEnv');
const summaryEnv = document.getElementById('summaryEnv');
const metricCards = document.getElementById('metricCards');
const summaryGrid = document.getElementById('summaryGrid');
const infraGrid = document.getElementById('infraGrid');
const scoreRing = document.getElementById('scoreRing');
const serviceList = document.getElementById('serviceList');
const endpointTable = document.getElementById('endpointTable');
const traceList = document.getElementById('traceList');
const logStream = document.getElementById('logStream');
const alertList = document.getElementById('alertList');
const rcaContent = document.getElementById('rcaContent');

async function api(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`API failed: ${path}`);
  return response.json();
}

function badgeClass(value, warnAt = 2, dangerAt = 5) {
  if (Number(value) >= dangerAt) return 'danger';
  if (Number(value) >= warnAt) return 'warn';
  return '';
}

function metricCard(label, value, subtext, badge, badgeType = '', bars = [38,66,48,82,58,92]) {
  return `<div class="card metric">
    <div class="metric-top"><span class="badge ${badgeType}">${badge}</span><span>${label}</span></div>
    <h3>${value}</h3><p>${subtext}</p>
    <div class="mini-chart">${bars.map(h => `<i style="height:${h}%"></i>`).join('')}</div>
  </div>`;
}

function renderOverview(data) {
  const { environment, metrics, summary } = data;
  activeEnvText.textContent = environment;
  heroEnv.textContent = environment;
  summaryEnv.textContent = `${environment} only`;
  scoreRing.textContent = `${metrics.health}%`;
  metricCards.innerHTML = [
    metricCard('Health', `${metrics.health}%`, 'Environment health score', `● ${environment}`, metrics.health < 95 ? 'warn' : ''),
    metricCard('24h', `${metrics.uptime}%`, 'Environment uptime', '● SLA', 'info', [70,42,64,36,50,44]),
    metricCard('Open', `${metrics.errorRate}%`, 'Error rate', '● Errors', badgeClass(metrics.errorRate), [30,54,76,62,46,35]),
    metricCard('P95', `${metrics.p95}ms`, 'Selected env latency', '● Latency', 'purple', [44,62,85,55,72,80]),
    metricCard('Today', metrics.logs, 'Logs ingested', '● Logs', '', [72,74,80,86,90,94])
  ].join('');

  summaryGrid.innerHTML = `
    <div class="kv"><small>Applications</small><strong>${summary.applications}</strong></div>
    <div class="kv"><small>External APIs</small><strong>${summary.externalApis}</strong></div>
    <div class="kv"><small>Internal APIs</small><strong>${summary.internalApis}</strong></div>
    <div class="kv"><small>Active Alerts</small><strong class="bad-t">${metrics.alerts}</strong></div>
    <div class="kv"><small>Deployments</small><strong>${summary.deployments}</strong></div>
    <div class="kv"><small>Ingestion Jobs</small><strong>${summary.ingestionJobs}</strong></div>`;

  infraGrid.innerHTML = `
    <div class="kv"><small>Critical Incidents</small><strong>${metrics.critical}</strong></div>
    <div class="kv"><small>Queue Lag</small><strong class="warn-t">${metrics.queueLag}</strong></div>
    <div class="kv"><small>DB Status</small><strong class="good">${metrics.db}</strong></div>
    <div class="kv"><small>Partition</small><strong>${environment}</strong></div>`;
}

function renderServices(services) {
  serviceList.innerHTML = services.map(s => `
    <div class="service-card">
      <div class="service-title">
        <div><h4>${s.name}</h4><small>Owner: ${s.owner} · Runtime ${s.runtime} · Version ${s.version} · Last deploy ${s.lastDeploy}</small></div>
        <span class="badge ${s.status === 'Degraded' ? 'danger' : s.status === 'Watch' ? 'warn' : ''}">${s.status}</span>
      </div>
      <div class="kv-grid"><div class="kv"><small>Health</small><strong>${s.health}%</strong></div><div class="kv"><small>Error</small><strong>${s.errorRate}%</strong></div><div class="kv"><small>P95</small><strong>${s.p95}ms</strong></div></div>
    </div>`).join('');
}

function renderEndpoints(endpoints) {
  endpointTable.innerHTML = `<div class="endpoint-row header"><span>Method</span><span>Endpoint</span><span>Calls/hr</span><span>Error</span><span>P95</span><span>Backend</span><span>Last Fail</span><span>Action</span></div>` + endpoints.map(e => `
    <div class="endpoint-row"><span class="method ${e.method.toLowerCase()}">${e.method}</span><span>${e.path}</span><span>${e.callsPerHour.toLocaleString()}</span><span class="${e.errorRate > 2 ? 'bad-t' : e.errorRate > 1 ? 'warn-t' : 'good'}">${e.errorRate}%</span><span>${e.p95}ms</span><span>${e.backendMs}ms</span><span>${e.lastFailure}</span><button>RCA</button></div>`).join('');
}

function renderTraces(traces) {
  traceList.innerHTML = traces.map(t => `
    <div class="trace-row"><div class="mono">${t.traceId}</div><div class="wf">${t.spans.map((s, i) => `<i class="c${i+1}" style="width:${s}%"></i>`).join('')}</div><strong>${t.latency}ms</strong><span class="badge ${t.status === 'Slow' ? 'danger' : t.status === 'Watch' ? 'warn' : 'info'}">${t.status}</span></div>`).join('');
}

function renderLogs(logs) {
  logStream.innerHTML = logs.map(l => `<div class="log-row"><span>${l.time}</span><span class="level ${l.level}">${l.level}</span><span>${l.message}</span></div>`).join('');
}

function renderAlerts(alerts) {
  alertList.innerHTML = alerts.map(a => `<div class="alert"><div><strong>${a.title}</strong><small>${a.detail}</small></div><span class="badge ${a.priority === 'P1' ? 'danger' : a.priority === 'P2' ? 'warn' : 'info'}">${a.priority}</span></div>`).join('');
}

function renderRca(rca) {
  rcaContent.innerHTML = `
    <div class="insight"><h4>Detected pattern</h4><p>${rca.detectedPattern}</p></div>
    <div class="insight"><h4>Likely root cause</h4><p>${rca.likelyRootCause}</p></div>
    <div class="insight"><h4>Recommended action</h4><p>${rca.recommendation}</p></div>`;
}

async function loadOptions() {
  const [workspaceData, envData] = await Promise.all([api('/api/workspaces'), api('/api/environments')]);
  workspaceSelect.innerHTML = workspaceData.workspaces.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  environmentSelect.innerHTML = envData.environments.map(e => `<option value="${e}">${e}</option>`).join('');
}

async function refreshDashboard() {
  const workspaceId = workspaceSelect.value || 'fsbl';
  const env = environmentSelect.value || 'PROD';
  const base = `/api/${workspaceId}/${env}`;
  const [overview, services, endpoints, traces, logs, alerts, rca] = await Promise.all([
    api(`${base}/overview`),
    api(`${base}/services`),
    api(`${base}/endpoints`),
    api(`${base}/traces`),
    api(`${base}/logs`),
    api(`${base}/alerts`),
    api(`${base}/rca`)
  ]);
  renderOverview(overview);
  renderServices(services.services);
  renderEndpoints(endpoints.endpoints);
  renderTraces(traces.traces);
  renderLogs(logs.logs);
  renderAlerts(alerts.alerts);
  renderRca(rca);
}

async function boot() {
  await loadOptions();
  await refreshDashboard();
  workspaceSelect.addEventListener('change', refreshDashboard);
  environmentSelect.addEventListener('change', refreshDashboard);
  setInterval(async () => {
    const workspaceId = workspaceSelect.value || 'fsbl';
    const env = environmentSelect.value || 'PROD';
    const data = await api(`/api/${workspaceId}/${env}/logs`);
    renderLogs(data.logs);
  }, 10000);
}

boot().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', `<div style="padding:12px;background:#fee2e2;color:#991b1b;font-weight:800">Failed to load dashboard: ${err.message}</div>`);
});
