const state = { workspace: 'fsbl-prod-ops', environment: 'PROD' };
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const pct = (n) => `${Number(n || 0).toFixed(Number(n) % 1 ? 2 : 0)}%`;
const badge = (label, kind = '') => `<span class="badge ${kind}">${label}</span>`;

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function envPath(suffix) { return `/api/${state.workspace}/${state.environment}/${suffix}`; }

async function loadWorkspaces() {
  const select = $('workspaceSelect');
  const { data } = await api('/api/workspaces');
  select.innerHTML = data.map(w => `<option value="${w.slug}">${w.name}</option>`).join('');
  state.workspace = select.value || 'fsbl-prod-ops';
}

function setEnvLabels() {
  $('activeEnvText').textContent = state.environment;
  $('heroEnv').textContent = state.environment;
  $('summaryEnv').textContent = `${state.environment} only`;
}

function metricCard(label, value, sub, kind = '', bars = [38,66,48,82,58,92]) {
  return `<div class="card metric"><div class="metric-top">${badge(label, kind)}<span>24h</span></div><h3>${value}</h3><p>${sub}</p><div class="mini-chart">${bars.map(h=>`<i style="height:${h}%"></i>`).join('')}</div></div>`;
}

async function loadOverview() {
  const { data } = await api(envPath('overview'));
  const m = data.metrics;
  $('scoreRing').textContent = pct(data.environment.health_score);
  $('metrics').innerHTML = [
    metricCard(`● ${state.environment}`, pct(data.environment.health_score), 'Environment health score', data.environment.health_score < 95 ? 'warn' : ''),
    metricCard('● SLA', '99.94%', 'Environment uptime', 'info', [70,42,64,36,50,44]),
    metricCard('● Errors', pct(m.error_rate), 'Error rate', m.error_rate > 2 ? 'danger' : '', [30,54,76,62,46,35]),
    metricCard('● Latency', `${m.p95_latency_ms || 0}ms`, 'P95 latency', 'purple', [44,62,85,55,72,80]),
    metricCard('● Logs', fmt(m.logs_ingested), 'Logs ingested', '', [72,74,80,86,90,94])
  ].join('');
  $('summaryGrid').innerHTML = [
    ['Services', m.services], ['Endpoints', m.endpoints], ['Active Alerts', m.active_alerts], ['Masking', pct(m.masking_coverage)], ['Database', 'Connected'], ['Partition', state.environment]
  ].map(([k,v]) => `<div class="kv"><small>${k}</small><strong>${v}</strong></div>`).join('');
  $('infraGrid').innerHTML = [['CPU Avg','62%'],['Memory Avg','71%'],['Queue Lag','18m'],['DB Status','OK']].map(([k,v]) => `<div class="kv"><small>${k}</small><strong>${v}</strong></div>`).join('');
}

async function loadServices() {
  const { data } = await api(envPath('services'));
  $('serviceList').innerHTML = data.map(s => `<div class="service-card"><div class="service-title"><div><h4>${s.name}</h4><small>Owner: ${s.owner || '-'} · Runtime ${s.runtime_version || '-'} · Version ${s.app_version || '-'}</small></div>${badge(s.status, s.status === 'degraded' ? 'danger' : s.status === 'watch' ? 'warn' : '')}</div><div class="kv-grid"><div class="kv"><small>Health</small><strong>${pct(s.health_score)}</strong></div><div class="kv"><small>Error</small><strong>${pct(s.error_rate)}</strong></div><div class="kv"><small>P95</small><strong>${s.p95_latency_ms || 0}ms</strong></div></div></div>`).join('');
}

async function loadEndpoints() {
  const { data } = await api(envPath('endpoints'));
  $('endpointTable').innerHTML = `<div class="endpoint-row header"><span>Method</span><span>Endpoint</span><span>Service</span><span>Calls/hr</span><span>Error</span><span>P95</span><span>Backend</span><span>Action</span></div>` + data.map(e => `<div class="endpoint-row"><span class="method ${String(e.method).toLowerCase()}">${e.method}</span><span>${e.path}</span><span>${e.service_name}</span><span>${fmt(e.calls_per_hour)}</span><span class="${e.error_rate > 2 ? 'bad-t' : 'good'}">${pct(e.error_rate)}</span><span>${e.p95_latency_ms || 0}ms</span><span>${e.backend_ms || 0}ms</span><button onclick="askRca('${e.service_name} ${e.method} ${e.path}')">RCA</button></div>`).join('');
}

async function loadTraces() {
  const { data } = await api(envPath('traces'));
  $('traceList').innerHTML = (data.length ? data : []).map(t => `<div class="trace-row"><div class="mono">${t.trace_id}</div><div class="wf"><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i></div><strong>${t.latency_ms || 0}ms</strong>${badge(t.status || 'OK', t.status === 'error' ? 'danger' : t.status === 'watch' ? 'warn' : 'info')}</div>`).join('') || '<p>No traces yet.</p>';
}

async function loadLogs() {
  const { data } = await api(envPath('logs?limit=50'));
  $('logStream').innerHTML = data.map(l => `<div class="log-row"><span>${new Date(l.timestamp).toLocaleTimeString('en-GB')}</span><span class="level ${l.severity}">${l.severity}</span><span>${l.trace_id ? `${l.trace_id} · ` : ''}${l.message}</span></div>`).join('') || '<p>No logs yet.</p>';
}

async function loadAlertsAndOps() {
  const alerts = await api(envPath('alerts'));
  $('alertList').innerHTML = alerts.data.map(a => `<div class="alert"><div><strong>${a.title}</strong><small>${a.description || a.service_name || ''}</small></div>${badge(a.severity, a.severity === 'P1' ? 'danger' : a.severity === 'P2' ? 'warn' : 'info')}</div>`).join('') || '<p>No alerts.</p>';
  const ops = await api(envPath('ops'));
  $('deploymentList').innerHTML = ops.data.deployments.map(d => `<div class="alert"><div><strong>${d.service_name || 'Deployment'} ${d.version}</strong><small>Error ${pct(Number(d.before_error_rate || 0) * 100)} → ${pct(Number(d.after_error_rate || 0) * 100)} · P95 ${d.before_p95_ms || 0}ms → ${d.after_p95_ms || 0}ms</small></div>${badge('Review', Number(d.after_error_rate) > Number(d.before_error_rate) ? 'danger' : '')}</div>`).join('') || '<p>No deployments.</p>';
  $('ingestionList').innerHTML = ops.data.ingestion.map(i => `<div class="alert"><div><strong>${i.source_type} · ${i.source_name}</strong><small>Accepted ${fmt(i.accepted_count)} · Rejected ${fmt(i.rejected_count)} · Parser errors ${fmt(i.parser_errors)}</small></div>${badge(i.status, i.status === 'watch' ? 'warn' : '')}</div>`).join('') || '<p>No ingestion jobs.</p>';
  $('securityList').innerHTML = ops.data.security.map(s => `<div class="alert"><div><strong>${s.event_type}</strong><small>${s.message}</small></div>${badge(fmt(s.count), s.severity === 'WARN' ? 'warn' : '')}</div>`).join('') || '<p>No security events.</p>';
}

async function askRca(query = '') {
  const text = query || $('searchBox').value || `Analyze ${state.environment}`;
  const { data } = await api(envPath('rca'), { method: 'POST', body: JSON.stringify({ query: text }) });
  $('rcaContent').innerHTML = `<div class="insight"><h4>Summary</h4><p>${data.summary}</p></div><div class="insight"><h4>Likely root cause</h4><p>${data.likely_root_cause}</p></div><div class="insight"><h4>Recommended actions</h4><p>${data.recommended_actions.join('<br>')}</p></div>`;
  location.hash = 'rca';
}

async function uploadLogs() {
  const body = $('logUpload').value.trim();
  if (!body) return alert('Paste logs first.');
  await fetch(envPath('logs/upload'), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
  $('logUpload').value = '';
  await Promise.all([loadOverview(), loadLogs(), loadServices(), loadEndpoints()]);
  alert('Logs uploaded to selected environment only.');
}

async function refreshAll() {
  setEnvLabels();
  await Promise.all([loadOverview(), loadServices(), loadEndpoints(), loadTraces(), loadLogs(), loadAlertsAndOps()]);
}

$('environmentSelect').addEventListener('change', async (e) => { state.environment = e.target.value; await refreshAll(); });
$('workspaceSelect').addEventListener('change', async (e) => { state.workspace = e.target.value; await refreshAll(); });
$('askRcaBtn').addEventListener('click', () => askRca());
$('uploadBtn').addEventListener('click', uploadLogs);

(async function boot() {
  try {
    await loadWorkspaces();
    await refreshAll();
    setInterval(loadLogs, 6000);
  } catch (error) {
    console.error(error);
    document.body.insertAdjacentHTML('afterbegin', `<div style="position:fixed;z-index:99;left:16px;right:16px;top:16px;padding:14px;border-radius:16px;background:#fee2e2;color:#991b1b;font-weight:800">${error.message}</div>`);
  }
})();
