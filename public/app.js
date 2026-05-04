const state = { workspace: 'fsbl-prod-ops', environment: 'PROD', theme: localStorage.getItem('observex-theme') || 'light', sidebar: localStorage.getItem('observex-sidebar') || 'open' };
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const pct = (n) => `${Number(n || 0).toFixed(Number(n) % 1 ? 2 : 0)}%`;
const badge = (label, kind = '') => `<span class="badge ${kind}">${escapeHtml(label)}</span>`;
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

async function api(path, options = {}) {
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

function envPath(suffix) { return `/api/${state.workspace}/${state.environment}/${suffix}`; }
function toast(message, type = 'ok') {
  const holder = $('toastHost') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toastHost', className: 'toast-host' }));
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  holder.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.body.classList.toggle('sidebar-collapsed', state.sidebar === 'closed');
  if ($('themeToggle')) $('themeToggle').textContent = state.theme === 'dark' ? '☀ Light' : '☾ Dark';
  if ($('sidebarToggle')) $('sidebarToggle').textContent = state.sidebar === 'closed' ? '☰ Open' : '☰ Close';
}

async function loadWorkspaces() {
  const select = $('workspaceSelect');
  const { data } = await api('/api/workspaces');
  select.innerHTML = data.map(w => `<option value="${escapeHtml(w.slug)}">${escapeHtml(w.name)}</option>`).join('');
  state.workspace = select.value || 'fsbl-prod-ops';
}

function setEnvLabels() {
  $('activeEnvText').textContent = state.environment;
  $('heroEnv').textContent = state.environment;
  $('summaryEnv').textContent = `${state.environment} only`;
}

function metricCard(label, value, sub, kind = '', bars = [38,66,48,82,58,92]) {
  return `<div class="card metric"><div class="metric-top">${badge(label, kind)}<span>24h</span></div><h3>${escapeHtml(value)}</h3><p>${escapeHtml(sub)}</p><div class="mini-chart">${bars.map(h=>`<i style="height:${Number(h)}%"></i>`).join('')}</div></div>`;
}

async function loadOverview() {
  const { data } = await api(envPath('overview'));
  const m = data.metrics;
  $('scoreRing').textContent = pct(data.environment.health_score);
  $('metrics').innerHTML = [
    metricCard(`● ${state.environment}`, pct(data.environment.health_score), 'Environment health score', data.environment.health_score < 95 ? 'warn' : ''),
    metricCard('● Error rate', pct(m.error_rate), 'Calculated from log_events', m.error_rate > 2 ? 'danger' : '', [30,54,76,62,46,35]),
    metricCard('● Latency', `${m.p95_latency_ms || 0}ms`, 'P95 from traces', 'purple', [44,62,85,55,72,80]),
    metricCard('● Logs', fmt(m.logs_ingested), 'Ingested in 24h', '', [72,74,80,86,90,94]),
    metricCard('● Alerts', fmt(m.active_alerts), 'Open incidents', m.active_alerts ? 'warn' : 'info', [12,20,36,30,42,25])
  ].join('');
  $('summaryGrid').innerHTML = [
    ['Services', m.services], ['Endpoints', m.endpoints], ['Active Alerts', m.active_alerts], ['Masking', pct(m.masking_coverage)], ['Database', 'Runtime checked'], ['Partition', state.environment]
  ].map(([k,v]) => `<div class="kv"><small>${escapeHtml(k)}</small><strong>${escapeHtml(v)}</strong></div>`).join('');
  $('infraGrid').innerHTML = [['Queue','Future worker'],['Archive','S3 ready'],['Search','Postgres FTS'],['DB Status','/ready']].map(([k,v]) => `<div class="kv"><small>${escapeHtml(k)}</small><strong>${escapeHtml(v)}</strong></div>`).join('');
}

async function loadServices() {
  const { data } = await api(envPath('services'));
  $('serviceList').innerHTML = data.map(s => `<div class="service-card"><div class="service-title"><div><h4>${escapeHtml(s.name)}</h4><small>Owner: ${escapeHtml(s.owner || '-')} · Runtime ${escapeHtml(s.runtime_version || '-')} · Version ${escapeHtml(s.app_version || '-')}</small></div>${badge(s.status, s.status === 'degraded' ? 'danger' : s.status === 'watch' ? 'warn' : '')}</div><div class="kv-grid"><div class="kv"><small>Health</small><strong>${pct(s.health_score)}</strong></div><div class="kv"><small>Error</small><strong>${pct(s.error_rate)}</strong></div><div class="kv"><small>P95</small><strong>${fmt(s.p95_latency_ms || 0)}ms</strong></div></div></div>`).join('') || '<p>No services yet.</p>';
}

async function loadEndpoints() {
  const { data } = await api(envPath('endpoints'));
  $('endpointTable').innerHTML = `<div class="endpoint-row header"><span>Method</span><span>Endpoint</span><span>Service</span><span>Calls/hr</span><span>Error</span><span>P95</span><span>Backend</span><span>Action</span></div>` + data.map(e => `<div class="endpoint-row"><span class="method ${String(e.method).toLowerCase()}">${escapeHtml(e.method)}</span><span>${escapeHtml(e.path)}</span><span>${escapeHtml(e.service_name)}</span><span>${fmt(e.calls_per_hour)}</span><span class="${e.error_rate > 2 ? 'bad-t' : 'good'}">${pct(e.error_rate)}</span><span>${fmt(e.p95_latency_ms || 0)}ms</span><span>${fmt(e.backend_ms || 0)}ms</span><button onclick="askRca('${escapeHtml(`${e.service_name} ${e.method} ${e.path}`)}')">RCA</button></div>`).join('');
}

async function loadTraces() {
  const { data } = await api(envPath('traces'));
  $('traceList').innerHTML = data.map(t => `<div class="trace-row"><div class="mono">${escapeHtml(t.trace_id)}</div><div class="wf"><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i></div><strong>${fmt(t.latency_ms || 0)}ms</strong>${badge(t.status || 'OK', t.status === 'error' ? 'danger' : t.status === 'watch' ? 'warn' : 'info')}</div>`).join('') || '<p>No traces yet.</p>';
}

async function loadLogs() {
  const q = encodeURIComponent($('searchBox')?.value || '');
  const { data } = await api(envPath(`logs?limit=50&q=${q}`));
  $('logStream').innerHTML = data.map(l => `<div class="log-row"><span>${new Date(l.timestamp).toLocaleTimeString('en-GB')}</span><span class="level ${escapeHtml(l.severity)}">${escapeHtml(l.severity)}</span><span>${l.trace_id ? `${escapeHtml(l.trace_id)} · ` : ''}${escapeHtml(l.message)}</span></div>`).join('') || '<p>No logs matched this environment/search.</p>';
}

async function loadAlertsAndOps() {
  const alerts = await api(envPath('alerts'));
  $('alertList').innerHTML = alerts.data.map(a => `<div class="alert"><div><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.description || a.service_name || '')}</small></div>${badge(a.severity, a.severity === 'P1' ? 'danger' : a.severity === 'P2' ? 'warn' : 'info')}</div>`).join('') || '<p>No alerts.</p>';
  const ops = await api(envPath('ops'));
  $('deploymentList').innerHTML = ops.data.deployments.map(d => `<div class="alert"><div><strong>${escapeHtml(d.service_name || 'Deployment')} ${escapeHtml(d.version)}</strong><small>Error ${pct(Number(d.before_error_rate || 0) * 100)} → ${pct(Number(d.after_error_rate || 0) * 100)} · P95 ${fmt(d.before_p95_ms || 0)}ms → ${fmt(d.after_p95_ms || 0)}ms</small></div>${badge('Review', Number(d.after_error_rate) > Number(d.before_error_rate) ? 'danger' : '')}</div>`).join('') || '<p>No deployments.</p>';
  $('ingestionList').innerHTML = ops.data.ingestion.map(i => `<div class="alert"><div><strong>${escapeHtml(i.source_type)} · ${escapeHtml(i.source_name)}</strong><small>Accepted ${fmt(i.accepted_count)} · Rejected ${fmt(i.rejected_count)} · Parser errors ${fmt(i.parser_errors)}</small></div>${badge(i.status, i.status === 'watch' ? 'warn' : '')}</div>`).join('') || '<p>No ingestion jobs.</p>';
  $('securityList').innerHTML = ops.data.security.map(s => `<div class="alert"><div><strong>${escapeHtml(s.event_type)}</strong><small>${escapeHtml(s.message)}</small></div>${badge(fmt(s.count), s.severity === 'WARN' ? 'warn' : '')}</div>`).join('') || '<p>No security events.</p>';
}

async function askRca(query = '') {
  const text = query || $('searchBox').value || `Analyze ${state.environment}`;
  const { data } = await api(envPath('rca'), { method: 'POST', body: JSON.stringify({ query: text }) });
  $('rcaContent').innerHTML = `<div class="insight"><h4>Summary</h4><p>${escapeHtml(data.summary)}</p></div><div class="insight"><h4>Likely root cause</h4><p>${escapeHtml(data.likely_root_cause)}</p></div><div class="insight"><h4>Evidence</h4><p>${fmt(data.evidence?.matched_logs)} matched logs · ${fmt(data.evidence?.errors)} errors · Services: ${escapeHtml((data.evidence?.affected_services || []).join(', ') || '-')}</p></div><div class="insight"><h4>Recommended actions</h4><p>${(data.recommended_actions || []).map(escapeHtml).join('<br>')}</p></div>`;
  location.hash = 'rca';
}

async function uploadLogs() {
  const body = $('logUpload').value.trim();
  if (!body) return toast('Paste or drop logs first.', 'warn');
  const res = await fetch(envPath('logs/upload'), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
  const result = await res.json();
  $('logUpload').value = '';
  await Promise.all([loadOverview(), loadLogs(), loadServices(), loadEndpoints(), loadAlertsAndOps()]);
  toast(`${fmt(result.inserted)} log lines uploaded to ${state.environment} only.`);
}

function bindDropZone() {
  const dz = $('dropZone');
  const ta = $('logUpload');
  if (!dz || !ta) return;
  ['dragenter','dragover'].forEach(evt => dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add('dragging'); }));
  ['dragleave','drop'].forEach(evt => dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove('dragging'); }));
  dz.addEventListener('drop', async (e) => {
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('File too large. Keep manual upload under 10 MB.', 'warn');
    ta.value = await file.text();
    toast(`${file.name} loaded. Click Upload Logs to ingest.`);
  });
}

async function refreshAll() {
  setEnvLabels();
  await Promise.all([loadOverview(), loadServices(), loadEndpoints(), loadTraces(), loadLogs(), loadAlertsAndOps()]);
}

$('environmentSelect').addEventListener('change', async (e) => { state.environment = e.target.value; await refreshAll(); });
$('workspaceSelect').addEventListener('change', async (e) => { state.workspace = e.target.value; await refreshAll(); });
$('askRcaBtn').addEventListener('click', () => askRca());
$('uploadBtn').addEventListener('click', () => uploadLogs().catch(e => toast(e.message, 'error')));
$('searchBox').addEventListener('input', () => { clearTimeout(window.__logSearchTimer); window.__logSearchTimer = setTimeout(loadLogs, 300); });
$('themeToggle')?.addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('observex-theme', state.theme); applyTheme(); });
$('sidebarToggle')?.addEventListener('click', () => { state.sidebar = state.sidebar === 'closed' ? 'open' : 'closed'; localStorage.setItem('observex-sidebar', state.sidebar); applyTheme(); });

(async function boot() {
  try {
    applyTheme();
    bindDropZone();
    await loadWorkspaces();
    await refreshAll();
    setInterval(loadLogs, 6000);
  } catch (error) {
    console.error(error);
    toast(error.message, 'error');
  }
})();
