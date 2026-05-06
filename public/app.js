const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

const state = {
  workspace: 'fsbl-prod-ops',
  environment: localStorage.getItem('observex-env') || 'PROD',
  theme: localStorage.getItem('observex-theme') || 'light',
  sidebar: localStorage.getItem('observex-sidebar') || 'open',
  page: (location.hash?.slice(1) === 'traces' ? 'logs' : (location.hash?.slice(1) === 'endpoints' ? 'apis' : (location.hash?.slice(1) || 'overview'))),
  apiKey: localStorage.getItem('observex-ingest-key') || '',
  traceFilter: '',
  uploadFilter: '',
  logPage: 1,
  logPageSize: 50,
  lastLogs: [],
  uploadSelections: new Set(),
  uploadRows: [],
  expandedApis: new Set(),
  aeQuery: '',
  services: [],
  endpoints: []
};

const icons = {
  overview:'<svg viewBox="0 0 24 24"><path d="M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-4H4v4Z"/></svg>',
  apis:'<svg viewBox="0 0 24 24"><path d="M8 8h8M8 12h8M8 16h5"/><rect x="4" y="4" width="16" height="16" rx="4"/></svg>',
  endpoints:'<svg viewBox="0 0 24 24"><path d="M6 7h12M6 17h12"/><circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/></svg>',
  logs:'<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
  alerts:'<svg viewBox="0 0 24 24"><path d="M12 4 3 20h18L12 4Z"/><path d="M12 9v5M12 17h.01"/></svg>',
  ops:'<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M3 12h4M17 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg>',
  rca:'<svg viewBox="0 0 24 24"><path d="M12 3a7 7 0 0 0-4 12.7V20h8v-4.3A7 7 0 0 0 12 3Z"/><path d="M9 21h6"/></svg>',
  docs:'<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v6h5M9 14h6M9 18h6"/></svg>',
  uploads:'<svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z"/><path d="M12 17V11M9.5 13.5 12 11l2.5 2.5"/></svg>'
};

function esc(v){return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function fmt(n){return new Intl.NumberFormat('en-IN').format(Number(n||0));}
function fmtMs(n){return Number(n||0)>0 ? `${fmt(n)}ms` : '—';}
function fmtPct(n){return n===null||n===undefined||n==='' ? '—' : `${Number(n||0).toFixed(2)}%`;}
function toast(msg, type='info'){const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=msg;($('toastHost')||document.body).appendChild(t);setTimeout(()=>t.remove(),4200);}
function endpoint(path){return `/api/${state.workspace}/${state.environment}${path}`;}
function apiBaseUrl(){return window.location.origin;}
function fullEndpoint(path){return `${apiBaseUrl()}${endpoint(path)}`;}
async function api(url,opt={}){
  let r;
  try { r = await fetch(url,opt); }
  catch (networkError) { throw new Error(`Network error: ${networkError.message}`); }
  const contentType = r.headers.get('content-type') || '';
  let payload = null;
  if (contentType.includes('application/json')) {
    try { payload = await r.json(); } catch { payload = null; }
  } else {
    const text = await r.text().catch(()=> '');
    if(!r.ok) throw new Error(text?.slice(0,180) || `Request failed (${r.status})`);
    throw new Error(`Expected JSON from ${url}, but received ${contentType || 'unknown content type'}. Check backend route / API response.`);
  }
  if(!r.ok) throw new Error(payload?.error || payload?.message || `Request failed (${r.status})`);
  return payload?.data ?? payload;
}
function applyTheme(){document.documentElement.classList.toggle('dark',state.theme==='dark');localStorage.setItem('observex-theme',state.theme);$('themeIcon')&&($('themeIcon').textContent=state.theme==='dark'?'☀':'☾');}
function applySidebar(){const closed=state.sidebar==='closed';$('appShell')&&$('appShell').classList.toggle('sidebar-collapsed',closed);localStorage.setItem('observex-sidebar',state.sidebar);}
function setPage(page){
  state.page=(page==='traces'?'logs':(page==='endpoints'?'apis':(page||'overview')));
  $$('.page').forEach(x=>x.classList.toggle('active',x.dataset.page===state.page));
  $$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.pageLink===state.page));
  const titles={overview:'Overview',apis:'APIs & Endpoints',logs:'Log Search',uploads:'Upload History',alerts:'Alerts',ops:'Ops',rca:'AI RCA',apiDocs:'API Docs'};
  setText('pageTitle',titles[state.page]||'Overview');
  $('topActions')&&$('topActions').classList.toggle('visible',state.page!=='logs');
  if(location.hash.slice(1)!==state.page)history.replaceState(null,'',`#${state.page}`);
  // Load page-specific data on navigation
  if(state.page==='logs')    { searchLogs(1); loadApisEndpoints(); loadSavedSearches(); loadErrorGroups(); }
  if(state.page==='apis')    { loadApisEndpoints(); }
  if(state.page==='uploads') { loadUploadHistory(); loadDeployImpact(); }
  if(state.page==='alerts') { loadAlertsOps(); loadAlertRules(); }
  if(state.page==='ops') { loadAlertsOps(); }
  if(state.page==='apiDocs') { renderApiDoc('apiIngest'); }
}
function empty(msg){return `<div class="empty">${esc(msg)}</div>`;}

function metric(label,value,sub,tone='neutral',action='logs'){return `<button type="button" class="metric-card ${tone}" data-metric-action="${esc(action)}"><span class="tag"><span class="dot"></span>${esc(label)}</span><h3 title="${esc(String(value))}">${value}</h3><p title="${esc(sub)}">${esc(sub)}</p></button>`;}

function bindOverviewMetricCards(m={}){
  $$('.metric-card[data-metric-action]').forEach(card=>{
    card.onclick=()=>routeMetric(card.dataset.metricAction, m);
  });
}
function routeMetric(action, m={}){
  if(action==='alerts'){ setPage('alerts'); return; }
  if(action==='apis'){ setPage('apis'); return; }
  setPage('logs');
  const set = (id,val)=>{ const el=$(id); if(el) el.value=val; };
  set('serviceFilter',''); refreshPathFilter(); set('pathFilter',''); state.traceFilter=''; state.uploadFilter='';
  if(action==='errors' || action==='spike'){ set('severityFilter','ERROR'); set('quickTime', action==='spike'?'1h':'24h'); set('logQuery',''); }
  else if(action==='top-error'){ set('severityFilter','ERROR'); set('quickTime','24h'); set('logQuery', String(m.top_error_signature||'').slice(0,120)); }
  else if(action==='latency'){ set('severityFilter',''); set('quickTime','24h'); set('logQuery','latency'); }
  else { set('severityFilter',''); set('quickTime', action==='throughput'?'1h':'all'); set('logQuery',''); }
  searchLogs(1);
  toast('Opened related log view','success');
}

function renderOverviewPulse(m){
  const metricsEl=$('metrics'); if(!metricsEl) return;
  let pulse=$('overviewPulse');
  if(!pulse){ pulse=document.createElement('section'); pulse.id='overviewPulse'; pulse.className='overview-pulse card visual-pulse'; metricsEl.insertAdjacentElement('afterend',pulse); }
  const errRate=Number(m.error_rate||0);
  const spikePct=Number(m.error_spike_percent||0);
  const p95=Number(m.p95_latency_ms||0);
  const throughput=Number(m.throughput_1h||0);
  const recentErr=Number(m.recent_errors_1h||0);
  const prevErr=Number(m.previous_errors_1h||0);
  const errPct=Math.min(100,errRate);
  const spikeNorm=Math.min(100,Math.max(0,spikePct));
  const latPct=Math.min(100,(p95/2000)*100);
  const thrPct=Math.min(100,(throughput/10000)*100);
  const maxErr=Math.max(1,recentErr,prevErr);
  const prevW=Math.max(3,Math.round((prevErr/maxErr)*100));
  const recentW=Math.max(3,Math.round((recentErr/maxErr)*100));
  const risk=Math.min(100,Math.round((errPct*1.8)+(spikeNorm*.45)+(latPct*.35)));
  const riskTone=risk>70?'bad':risk>35?'warn':'good';
  pulse.innerHTML=`
    <div class="section-head"><h3>Operational pulse</h3><span>Visual health from error spike / latency / throughput</span></div>
    <div class="pulse-visual-grid">
      ${pulseGauge('Error rate', errPct, errRate.toFixed(2)+'%', errRate>5?'bad':errRate>1?'warn':'good', 'Click to open ERROR logs', 'errors')}
      ${pulseGauge('Spike growth', spikeNorm, spikePct.toFixed(2)+'%', spikePct>50?'bad':spikePct>0?'warn':'good', 'Click to open latest spike logs', 'spike')}
      ${pulseGauge('P95 latency', latPct, fmtMs(p95), latPct>50?'bad':latPct>20?'warn':'good', 'Click to inspect slow traces', 'latency')}
      ${pulseGauge('Throughput 1h', thrPct, fmt(throughput), 'neutral', 'Click to view last-hour log stream', 'throughput')}
    </div>
    <div class="pulse-analytics-grid">
      <button class="pulse-compare" data-metric-action="spike">
        <div><b>Error comparison</b><span>Previous 1h vs latest 1h</span></div>
        <div class="compare-row"><small>Previous</small><i><em style="width:${prevW}%"></em></i><strong>${fmt(prevErr)}</strong></div>
        <div class="compare-row danger"><small>Latest</small><i><em style="width:${recentW}%"></em></i><strong>${fmt(recentErr)}</strong></div>
      </button>
      <button class="pulse-risk ${riskTone}" data-metric-action="top-error">
        <div><b>Risk compass</b><span>Combined operational pressure</span></div>
        <div class="risk-meter"><i style="width:${Math.max(4,risk)}%"></i></div>
        <strong>${risk}/100</strong>
      </button>
      <button class="pulse-top-error" data-metric-action="top-error">
        <div><b>Dominant error</b><span>${fmt(m.top_error_count||0)} events</span></div>
        <p title="${esc(String(m.top_error_signature||'No errors observed'))}">${esc(String(m.top_error_signature||'No errors observed'))}</p>
      </button>
    </div>
    <div class="ai-insight"><b>AI investigation hint</b><span>${esc(buildInsight(m))}</span></div>`;
  $$('#overviewPulse [data-metric-action]').forEach(btn=>btn.onclick=()=>routeMetric(btn.dataset.metricAction,m));
}
function pulseGauge(label,pct,value,tone,hint,action){
  const safePct=Math.max(0,Math.min(100,Number(pct||0)));
  return `<button class="pulse-gauge ${tone}" data-metric-action="${esc(action)}" title="${esc(hint)}">
    <div class="gauge-ring" style="--pct:${safePct}"><span>${esc(value)}</span></div>
    <div><b>${esc(label)}</b><small>${esc(hint)}</small></div>
  </button>`;
}
function pulseBar(label,pct,value,tone){return `<div class="pulse-item ${tone}"><div><b>${esc(label)}</b><span>${esc(value)}</span></div><div class="pulse-track"><i style="width:${Math.max(3,Math.min(100,pct))}%"></i></div></div>`;}
function buildInsight(m){
  if(Number(m.error_spike_events||0)>0) return `Error spike detected: ${fmt(m.error_spike_events)} more errors than previous hour. Top error: ${String(m.top_error_signature||'Unknown').slice(0,90)}.`;
  if(Number(m.error_rate||0)>5) return `Error rate is high at ${Number(m.error_rate||0).toFixed(2)}%. Start with Top error and endpoint error grouping.`;
  if(Number(m.p95_latency_ms||0)>1000) return `Latency is elevated. Check slow traces and upstream dependency timings.`;
  return 'No major spike detected from the current ingested data. Continue monitoring throughput, P95, and top error groups.';
}
function healthScore(m){const logs=Number(m.logs_ingested||0);if(!logs)return 0;const error=Number(m.error_rate||0);const latency=Number(m.p95_latency_ms||0);const alerts=Number(m.active_alerts||0);return Math.round(Math.max(0,Math.min(100,100-(error*2)-Math.max(0,latency-500)/100-(alerts*3))));}
function scoreTone(score){if(!score)return 'empty';if(score>=95)return 'good';if(score>=85)return 'warn';return 'bad';}

function sparklineBars(points){
  const arr = Array.isArray(points) ? points.map(p=>Number(p.count||0)) : [];
  const nonZero = arr.filter(v => v > 0);
  const unique = new Set(nonZero).size;
  // Do not show decorative/fake-looking sparklines. Only render when real daily data has variation.
  if (arr.length < 2 || nonZero.length < 2 || unique < 2) {
    return `<span class="spark-empty" title="Trend needs at least two active days with different volumes">No trend</span>`;
  }
  const max = Math.max(1, ...arr);
  const tooltip = (points||[]).map(p=>`${String(p.day||'').slice(0,10)}: ${fmt(p.count)}`).join(' | ');
  return `<span class="spark-bars real" title="${esc(tooltip)}">${arr.map(v=>`<i style="height:${Math.max(3,Math.round((v/max)*22))}px"></i>`).join('')}</span>`;
}
function serviceEndpointOptions(serviceName=''){
  const seen=new Set();
  return state.endpoints
    .filter(e => !serviceName || e.service_name === serviceName)
    .filter(e => e.path && !seen.has(`${e.method||''}|${e.path}`) && seen.add(`${e.method||''}|${e.path}`))
    .map(e=>`<option value="${esc(e.path)}">${esc((e.method||'')+' '+e.path)}</option>`).join('');
}
function refreshPathFilter(){
  const pf=$('pathFilter'); if(!pf) return;
  const cur=pf.value;
  const svc=$('serviceFilter')?.value || '';
  pf.innerHTML='<option value="">All endpoints</option>'+serviceEndpointOptions(svc);
  if([...pf.options].some(o=>o.value===cur)) pf.value=cur;
}
async function loadSavedSearches(){
  const host=$('savedSearches'); if(!host) return;
  try{
    const rows=await api(endpoint('/saved-searches'));
    host.innerHTML=rows.length?rows.map(r=>`<button class="saved-chip" data-filters='${esc(JSON.stringify(r.filters||{}))}'>${esc(r.name)}</button>`).join(''):'<span class="saved-empty">No saved searches yet</span>';
    $$('.saved-chip').forEach(btn=>btn.onclick=()=>{const f=JSON.parse(btn.dataset.filters||'{}');$('logQuery').value=f.q||'';$('severityFilter').value=f.severity||'';$('serviceFilter').value=f.service||'';refreshPathFilter();$('pathFilter').value=f.path||'';$('quickTime').value=f.range||'all';searchLogs(1);});
  }catch(e){ host.innerHTML='<span class="saved-empty">Saved search unavailable</span>'; }
}
async function saveCurrentSearch(){
  const name=prompt('Name this saved search', $('serviceFilter')?.value ? `${$('serviceFilter').value} errors` : 'Production investigation');
  if(!name) return;
  const filters={q:$('logQuery')?.value||'',severity:$('severityFilter')?.value||'',service:$('serviceFilter')?.value||'',path:$('pathFilter')?.value||'',range:$('quickTime')?.value||'all'};
  await api(endpoint('/saved-searches'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,filters})});
  toast('Saved search created','success');
  loadSavedSearches();
}
async function runAnomalyCheck(){
  const res=await api(endpoint('/anomalies/run'),{method:'POST'});
  toast(res.created?`Created ${res.created} anomaly alert(s)`:'No anomaly detected','success');
  await Promise.allSettled([loadAlertsOps(),loadOverview()]);
}

async function loadErrorGroups(){
  const host=$('errorGroups'); if(!host) return;
  try{
    const params=new URLSearchParams({service:$('serviceFilter')?.value||'',path:$('pathFilter')?.value||'',range:$('quickTime')?.value||'24h'});
    const rows=await api(endpoint('/error-groups?'+params));
    const card = host.closest('.error-groups-card');
    if (!rows.length) { host.innerHTML=''; if(card) card.hidden = true; return; }
    if(card) card.hidden = false;
    host.innerHTML=`<div class="error-group-grid">${rows.slice(0,6).map(g=>`<button class="error-group-chip" data-sig="${esc(g.signature||'')}"><b>${fmt(g.occurrences)}</b><span>${esc(String(g.signature||'Unknown').slice(0,58))}</span><small>Last ${new Date(g.last_seen).toLocaleTimeString()}</small></button>`).join('')}</div>`;
    $$('.error-group-chip').forEach(btn=>btn.onclick=()=>{$('logQuery').value=btn.dataset.sig||'';$('severityFilter').value='ERROR';searchLogs(1);});
  }catch(e){const card=host.closest('.error-groups-card'); if(card) card.hidden=true; host.innerHTML='';}
}

async function loadDeployImpact(){
  const host=$('deployImpactList'); if(!host) return;
  try{
    const rows=await api(endpoint('/deploy-impact'));
    host.innerHTML=rows.length?`<div class="impact-list">${rows.slice(0,5).map(r=>{const delta=Number(r.error_delta_pct||0);return `<div class="impact-row"><div><strong>${esc(r.source_name||'upload')}</strong><small>${new Date(r.created_at).toLocaleString()}</small></div><div><small>Before</small><b>${fmtPct(r.before_error_rate)}</b></div><div><small>After</small><b style="color:${delta>1?'var(--bad)':delta>0?'var(--warn)':'var(--good)'}">${fmtPct(r.after_error_rate)}</b></div><div><small>Delta</small><b>${delta>0?'+':''}${delta.toFixed(2)}%</b></div></div>`;}).join('')}</div>`:empty('Upload at least two time windows to see before-after impact.');
  }catch(e){host.innerHTML=empty('Deploy impact unavailable');}
}

async function openTraceDetail(traceId){
  if(!traceId) return;
  try{
    const data=await api(endpoint('/traces/'+encodeURIComponent(traceId)));
    state.selectedTrace=data;
    setText('modalTitle',`Trace waterfall · ${traceId}`);
    const steps=data.waterfall||[];
    const summary=data.summary||{};
    const summaryHtml=`<div class="modal-section trace-summary"><div class="modal-grid">
      <div><small>Trace ID</small><b class="copy-field" title="Click to copy">${esc(traceId)}</b></div>
      <div><small>Events</small><b>${fmt(summary.events ?? steps.length)}</b></div>
      <div><small>Status</small><b style="color:${summary.errors?'var(--bad)':'var(--good)'}">${summary.errors?'error':'healthy'}</b></div>
      <div><small>Duration</small><b>${fmtMs(summary.duration_ms||0)}</b></div>
      <div><small>Services</small><b>${esc((summary.services||[]).join(', ')||'-')}</b></div>
      <div><small>Errors</small><b>${fmt(summary.errors||0)}</b></div>
    </div></div>`;
    const body=steps.length?`<div class="trace-waterfall">${steps.map((st,idx)=>`<button type="button" class="trace-step ${esc(st.severity)}" data-event-index="${idx}"><span class="step-dot"></span><div><b>${esc(st.service_name||'Unknown service')}</b><small>${esc((st.method||'')+' '+(st.path||''))}</small><p>${esc(String(st.message||'').slice(0,220))}</p></div><div><small>+${fmt(st.at_ms)}ms</small><b>${fmtMs(st.latency_ms)}</b><small>${esc(st.severity||'')}</small></div></button>`).join('')}</div><div id="traceEventPopup" class="trace-event-popup" hidden></div>`:empty('No events found for this trace ID. Try searching the trace/event/correlation ID in Log Search.');
    setHtml('modalBody', summaryHtml+body);
    $('modalTraceBtn')&&($('modalTraceBtn').disabled=true);
    $('logModal')&&$('logModal').classList.add('open');
    $$('.trace-step[data-event-index]').forEach(btn=>btn.onclick=()=>showTraceEventPopup(Number(btn.dataset.eventIndex)));
    $$('.copy-field').forEach(el=>el.onclick=()=>{navigator.clipboard?.writeText(el.textContent).then(()=>toast('Copied!','success'));});
  }catch(e){toast(e.message,'error');}
}

function showTraceEventPopup(index){
  const event=(state.selectedTrace?.events||[])[index];
  const host=$('traceEventPopup');
  if(!event || !host) return;
  host.hidden=false;
  host.innerHTML=`<div class="trace-popup-head"><div><b>Full trace log payload</b><small>${esc(event.service_name||'Unknown service')} · ${esc(event.severity||'-')}</small></div><button class="secondary tiny" type="button" id="closeTraceEventPopup">Close</button></div>
    <div class="modal-grid">
      <div><small>Timestamp</small><b>${esc(new Date(event.timestamp).toLocaleString())}</b></div>
      <div><small>Endpoint</small><b>${esc((event.method||'')+' '+(event.path||''))}</b></div>
      <div><small>Latency</small><b>${fmtMs(event.latency_ms||event.raw?.latency_ms||0)}</b></div>
      <div><small>Trace ID</small><b class="copy-field">${esc(event.trace_id||event.raw?.event_id||'-')}</b></div>
    </div>
    <div class="modal-section-title">Message</div>
    <pre class="modal-pre">${esc(event.message||'')}</pre>
    <div class="modal-section-title">Raw JSON</div>
    <pre class="modal-pre json-pre">${esc(JSON.stringify(event.raw||event,null,2))}</pre>`;
  $('closeTraceEventPopup')&&($('closeTraceEventPopup').onclick=()=>{host.hidden=true;host.innerHTML='';});
  $$('.copy-field').forEach(el=>el.onclick=()=>{navigator.clipboard?.writeText(el.textContent).then(()=>toast('Copied!','success'));});
  host.scrollIntoView({block:'nearest',behavior:'smooth'});
}

function openEndpointErrors(service,path){
  setPage('logs');
  $('serviceFilter').value=service||'';
  refreshPathFilter();
  $('pathFilter').value=path||'';
  $('severityFilter').value='ERROR';
  $('quickTime').value='24h';
  searchLogs(1);
}

async function initWorkspaces(){try{const ws=await api('/api/workspaces');state.workspace=ws[0]?.slug||state.workspace;const name=ws[0]?.name||'FSBL Production Ops';$('brandWorkspaceName')&&($('brandWorkspaceName').textContent=name);await loadEnvironmentList();}catch{$('brandWorkspaceName')&&($('brandWorkspaceName').textContent='FSBL Production Ops');state.environments=['PROD','UAT','DEV','DR'];}}

async function loadOverview(){
  try{
    const {metrics:m}=await api(endpoint('/overview'));
    const score=healthScore(m);
    const tone=scoreTone(score);
    setText('heroEnv', state.environment);
    const ring=$('scoreRing');
    if(ring){ ring.className=`score-ring ${tone}`; ring.style.setProperty('--score',score); ring.innerHTML=`<span>${score?score+'%':'--'}</span>`; }
    setHtml('metrics',[
      metric(state.environment,score?score+'%':'--','Calculated health',tone,'apis'),
      metric('Error rate',`${Number(m.error_rate||0).toFixed(2)}%`,'From ERROR/FATAL logs',Number(m.error_rate)>5?'bad':'good','errors'),
      metric('Error spike',fmt(m.error_spike_events||0),'Errors in latest hour above previous hour',Number(m.error_spike_events)>20?'bad':Number(m.error_spike_events)>0?'warn':'good','spike'),
      metric('P95 latency',fmtMs(m.p95_latency_ms),'From traces',Number(m.p95_latency_ms)>1000?'bad':'neutral','latency'),
      metric('Throughput 1h',fmt(m.throughput_1h||0),'Events received in last hour','neutral','throughput'),
      metric('Top error',fmt(m.top_error_count||0),String(m.top_error_signature||'No errors observed').slice(0,70),Number(m.top_error_count)?'warn':'good','top-error'),
      metric('Logs',fmt(m.logs_ingested),'Total ingested logs','neutral','logs'),
      metric('Alerts',fmt(m.active_alerts),'Open incidents',Number(m.active_alerts)?'warn':'good','alerts')
    ].join(''));
    setText('summaryEnv',`${state.environment} only`);
    setHtml('summaryGrid',[['Services',m.services],['Endpoints',m.endpoints],['Success rate',`${Number(m.success_rate||Math.max(0,100-Number(m.error_rate||0))).toFixed(2)}%`],['P99 latency',fmtMs(m.p99_latency_ms||0)],['Error budget burn',`${Number(m.error_budget_burn||0).toFixed(2)}x`],['APDEX',Number(m.apdex||0).toFixed(2)],['Throughput/min',fmt(m.throughput_per_min||0)],['Recent errors 1h',fmt(m.recent_errors_1h||0)],['Previous errors 1h',fmt(m.previous_errors_1h||0)]].map(([k,v])=>`<div class="kv"><small>${k}</small><b>${esc(v)}</b></div>`).join(''));
    bindOverviewMetricCards(m);
    renderOverviewPulse(m);
    setHtml('infraGrid',[['Upload engine','10 parallel files'],['Recommended path','S3 pre-signed / chunked'],['Search','Filters + FTS'],['Max file','Configurable 500MB+']].map(([k,v])=>`<div class="kv"><small>${k}</small><b>${esc(v)}</b></div>`).join(''));
  }catch(e){toast(e.message,'error');}
}
async function loadApisEndpoints(q){
  q = (q !== undefined ? q : state.aeQuery || '').toLowerCase().trim();
  state.aeQuery = q;
  try {
    const [services, endpoints] = await Promise.all([
      api(endpoint('/services')),
      api(endpoint('/endpoints'))
    ]);
    state.services=services; state.endpoints=endpoints;
    const sf=$('serviceFilter');
    if(sf){ const cur=sf.value; sf.innerHTML='<option value="">All APIs / services</option>'+services.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join(''); if([...sf.options].some(o=>o.value===cur))sf.value=cur; }
    refreshPathFilter();
    const list = $('apiEndpointList');
    if(!list) return;
    const epByService = {};
    for (const ep of endpoints) { const sn=ep.service_name||'__unknown__'; if(!epByService[sn])epByService[sn]=[]; epByService[sn].push(ep); }
    const filteredServices = services.filter(s => !q || s.name.toLowerCase().includes(q) || (epByService[s.name]||[]).some(ep=>(ep.path||'').toLowerCase().includes(q)||(ep.method||'').toLowerCase().includes(q)));
    if (!filteredServices.length) { list.innerHTML=empty(q?`No APIs or endpoints match "“${q}”"`:'No APIs found. Upload logs to auto-discover services.'); return; }
    list.innerHTML = filteredServices.map(s => {
      const errRate=Number(s.error_rate||0);
      const errColor=errRate>5?'var(--bad)':errRate>1?'var(--warn)':'var(--good)';
      const health=Number(s.health_score||0);
      const svcEps=(epByService[s.name]||[]).filter(ep=>!q||(ep.path||'').toLowerCase().includes(q)||(ep.method||'').toLowerCase().includes(q)||s.name.toLowerCase().includes(q));
      const isOpen=state.expandedApis.has(s.name);
      return `<div class="api-accordion ${isOpen?'open':''}" data-api-name="${esc(s.name)}">
        <button class="api-accordion-header" data-api="${esc(s.name)}" aria-expanded="${isOpen}">
          <div class="api-acc-left">
            <span class="api-acc-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>
            <div class="api-acc-name"><strong>${esc(s.name)}</strong><small>${svcEps.length} endpoint${svcEps.length!==1?'s':''} · Auto-discovered · ${esc(s.owner||'Unowned')} ${s.last_seen?'· Last seen '+new Date(s.last_seen).toLocaleTimeString():''} ${s.traffic_delta_pct!==null&&s.traffic_delta_pct!==undefined?'· Traffic '+(Number(s.traffic_delta_pct)>0?'+':'')+Number(s.traffic_delta_pct).toFixed(1)+'%':''}</small></div>
          </div>
          <div class="api-acc-stats metrics-clean compact-api-stats">
            <div class="api-acc-stat status-metric"><small>Status</small><b class="status-badge ${esc(s.status||'observed')}"><span class="status-dot"></span>${esc(s.status||'observed')}</b></div>
            <div class="api-acc-stat"><small>Error</small><b style="color:${errColor}">${errRate.toFixed(2)}%</b></div>
            <div class="api-acc-stat"><small>P95</small><b>${fmtMs(s.p95_latency_ms)}</b></div>
            <div class="api-acc-stat"><small>Health</small><b style="color:${health>=80?'var(--good)':health>=50?'var(--warn)':'var(--bad)'}">${health?health+'%':'—'}</b></div>
            <span class="mini-link danger delete-api api-delete-inline" data-service="${esc(s.name)}" title="Delete API from selected environment" role="button" tabindex="0">Delete</span>
          </div>
        </button>
        <div class="api-accordion-body"><div class="api-accordion-body-inner"><div class="api-manage-row api-manage-row-note"><span>Manual delete hides this API/endpoint from the selected environment.</span></div>
          ${(s.top_errors&&s.top_errors.length)?`<div class="top-errors-mini"><b>Top errors</b>${s.top_errors.map(e=>`<span>${esc(String(e.signature||'Unknown').slice(0,34))} · ${fmt(e.count)}</span>`).join('')}</div>`:''}${svcEps.length?`<div class="ep-inner-table"><div class="ep-inner-header"><span>Method</span><span>Path</span><span>Status</span><span>Calls</span><span>Error %</span><span>P95</span><span>Action</span></div>${svcEps.map(ep=>{const er=Number(ep.error_rate||0);const meth=(ep.method||'?').toUpperCase();return `<div class="ep-inner-row"><span><span class="method-badge meth-${esc(meth)}">${esc(meth)}</span></span><span class="ep-path">${esc(ep.path||'-')}</span><span><span class="status-badge ${esc(ep.status||'observed')}">${esc(ep.status||'observed')}</span></span><span><b>${fmt(ep.calls_total??ep.calls_per_hour)}</b></span><span><b style="color:${er>5?'var(--bad)':er>1?'var(--warn)':'var(--good)'}">${er.toFixed(2)}%</b></span><span><b>${fmtMs(ep.p95_latency_ms)}</b></span><span class="endpoint-actions"><button class="mini-link endpoint-errors" data-service="${esc(s.name)}" data-path="${esc(ep.path||'')}">View errors →</button><button class="mini-link danger delete-endpoint" data-service="${esc(s.name)}" data-method="${esc(meth)}" data-path="${esc(ep.path||'')}">Delete</button></span></div>`;}).join('')}</div>`:'<div class="ep-inner-empty">No endpoints discovered yet for this API.</div>'}
        </div></div>
      </div>`;
    }).join('');
    $$('.api-accordion-header').forEach(btn=>{
      btn.onclick=()=>{
        const n=btn.dataset.api;
        if(state.expandedApis.has(n))state.expandedApis.delete(n); else state.expandedApis.add(n);
        const acc=btn.closest('.api-accordion');
        const open=state.expandedApis.has(n);
        acc.classList.toggle('open',open);
        btn.setAttribute('aria-expanded',open);
      };
    });
    $$('.endpoint-errors').forEach(btn=>btn.onclick=(ev)=>{ev.stopPropagation();openEndpointErrors(btn.dataset.service, btn.dataset.path);});
    $$('.delete-endpoint').forEach(btn=>btn.onclick=(ev)=>{ev.stopPropagation();deleteApiRegistry({service_name:btn.dataset.service, method:btn.dataset.method, path:btn.dataset.path});});
    $$('.delete-api').forEach(btn=>btn.onclick=(ev)=>{ev.stopPropagation();deleteApiRegistry({service_name:btn.dataset.service});});
  } catch(e){toast('APIs & Endpoints: '+e.message,'error');}
}
async function loadTraces(){const rows=await api(endpoint('/traces'));$('traceList').innerHTML=rows.length?rows.map(t=>`<div class="row"><div><strong>${esc(t.trace_id)}</strong><small>${esc(t.service_name||'service unknown')} ${esc(t.method||'')} ${esc(t.path||'')}</small></div><div><small>Status</small><b>${esc(t.status)}</b></div><div><small>Latency</small><b>${fmtMs(t.latency_ms)}</b></div><div><small>Started</small><b>${new Date(t.started_at).toLocaleString()}</b></div><div><small>Env</small><b>${state.environment}</b></div></div>`).join(''):empty('No traces yet. Logs with trace_id are searchable; trace waterfall needs trace ingestion.');}

function logParams(page=state.logPage){return new URLSearchParams({limit:String(state.logPageSize),page:String(page),q:$('logQuery')?.value||'',severity:$('severityFilter')?.value||'',service:$('serviceFilter')?.value||'',path:$('pathFilter')?.value||'',trace_id:state.traceFilter||'',upload_id:state.uploadFilter||'',range:$('quickTime')?.value||'all'});}
async function searchLogs(page=state.logPage){
  state.logPage=Math.max(page,1);
  const result=await api(endpoint('/logs?'+logParams(state.logPage)));
    loadErrorGroups();
  const rows=Array.isArray(result)?result:(result.items||[]);
  state.lastLogs=rows;
  const total=Array.isArray(result)?rows.length:result.total;
  if($('activeTracePill')){
    if(state.traceFilter){
      $('activeTracePill').hidden=false;
      $('activeTracePill').innerHTML=`Trace investigation active: <b>${esc(state.traceFilter)}</b> <button id="clearTraceInvestigation">Clear trace</button>`;
      setTimeout(()=>{$('clearTraceInvestigation')&&($('clearTraceInvestigation').onclick=()=>{state.traceFilter='';state.uploadFilter='';searchLogs(1);});});
    } else {$('activeTracePill').hidden=true;$('activeTracePill').innerHTML='';}
  }
  $('logResultCount')&&($('logResultCount').textContent=`${fmt(total)} logs · page ${result.page||state.logPage} of ${result.total_pages||1}`);

  function sevColor(s){return{ERROR:'#ff4d6d',FATAL:'#c9184a',WARN:'#f77f00',INFO:'#4cc9f0',DEBUG:'#adb5bd'}[s]||'#adb5bd';}
  function latencyBadge(raw){
    const direct=raw?.latency_ms||raw?.analytics?.latency_ms; const m=String(raw?.original||'').match(/(?:took|latency|duration|elapsed|response[_-]?time)\s*[:=]?\s*(\d+)\s*ms/i);
    if(!direct&&!m) return '';
    const ms=Number(direct||m[1]);
    const color=ms>2000?'#ff4d6d':ms>500?'#f77f00':'#2dc653';
    return `<span class="latency-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${ms}ms</span>`;
  }
  function httpBadge(raw){
    const p=raw?.payload; const st=raw?.http_status||raw?.analytics?.http_status||p?.exit?.HttpStatus||p?.statusCode||p?.status;
    if(!st) return '';
    const s=Number(st); const color=s>=500?'#ff4d6d':s>=400?'#f77f00':s>=200?'#2dc653':'#adb5bd';
    return `<span class="http-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">HTTP ${s}</span>`;
  }
  function flowBadge(raw){
    const fn=raw?.payload?.entry?.FlowName||raw?.payload?.common?.ApplicationName;
    if(!fn) return '';
    return `<span class="flow-badge" title="Flow: ${esc(fn)}">${esc(fn.length>22?fn.slice(0,20)+'…':fn)}</span>`;
  }
  function traceChip(l){
    const tid=l.trace_id||l.raw?.event_id||l.raw?.correlation_id;
    if(!tid) return '';
    return `<span class="trace-chip" data-trace-id="${esc(tid)}" title="Open trace waterfall: ${esc(tid)}">⛓ Trace</span>`;
  }
  function msgHighlight(msg,q){
    if(!q||!msg) return esc(msg||'');
    const re=new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');
    return esc(msg).replace(re,'<mark>$1</mark>');
  }
  const q=($('logQuery')?.value||'').trim();

  setHtml('logStream', rows.length ? `
    <div class="log-analytics-bar">
      <span class="lag-stat">
        ${['ERROR','WARN','INFO','DEBUG','FATAL'].map(s=>{const c=rows.filter(r=>r.severity===s).length; return c?`<span class="lag-pill" style="background:${sevColor(s)}22;color:${sevColor(s)}">${s} <b>${c}</b></span>`:''}).join('')}
      </span>
      <span class="lag-meta">${fmt(total)} total · ${rows.length} shown</span>
    </div>
    ${rows.map((l,i)=>`
    <button class="log-line v21 ${esc(l.severity)}" data-log-index="${i}" style="border-left:3px solid ${sevColor(l.severity)}">
      <div class="log-meta v21">
        <span class="level ${esc(l.severity)}">${esc(l.severity)}</span>
        <span class="log-ts">${new Date(l.timestamp).toLocaleTimeString()}<span class="log-date"> ${new Date(l.timestamp).toLocaleDateString()}</span></span>
        <span class="log-svc">${esc(l.service_name||'—')}</span>
        ${l.method?`<span class="method-badge meth-${esc(l.method)}">${esc(l.method)}</span>`:''}
        ${l.path?`<span class="log-path" title="${esc(l.path)}">${esc(l.path.length>40?l.path.slice(0,38)+'…':l.path)}</span>`:''}
        ${latencyBadge(l.raw)} ${httpBadge(l.raw)} ${traceChip(l)} ${flowBadge(l.raw)}
      </div>
      <div class="log-message v21">${msgHighlight(l.message,q)}</div>
    </button>`).join('')}` :
    empty('No logs matched. Upload logs from Overview or relax filters.'));

  if($('prevLogsBtn')) $('prevLogsBtn').disabled=(result.page||1)<=1;
  if($('nextLogsBtn')) $('nextLogsBtn').disabled=(result.page||1)>=(result.total_pages||1);
  $$('.log-line[data-log-index]').forEach(btn=>btn.onclick=()=>openLogModal(state.lastLogs[Number(btn.dataset.logIndex)]));
  $$('.trace-chip[data-trace-id]').forEach(chip=>chip.onclick=(ev)=>{ev.stopPropagation();openTraceDetail(chip.dataset.traceId);});
}
function openLogModal(log){
  if(!log) return;
  state.selectedLog=log;
  const sevColors={ERROR:'#ff4d6d',FATAL:'#c9184a',WARN:'#f77f00',INFO:'#4cc9f0',DEBUG:'#adb5bd'};
  const sc=sevColors[log.severity]||'#adb5bd';
  setText('modalTitle',`${log.severity||'LOG'} · ${log.service_name||'Unknown service'}`);
  $('modalTraceBtn')&&($('modalTraceBtn').disabled=!log.trace_id);

  // Extract analytics from raw
  const raw=log.raw||{};
  const payload=raw.payload||{};
  const entry=payload.entry||{};
  const exit_=payload.exit||{};
  const common=payload.common||{};
  const latMs=String(raw.original||log.message||'').match(/(?:took|latency|duration|elapsed|response[_-]?time)\s*[:=]?\s*(\d+)\s*ms/i)?.[1];
  const httpSt=exit_?.HttpStatus||payload?.statusCode||payload?.status;
  const flowIn=entry?.FlowName; const flowOut=exit_?.FlowName;
  const tsIn=entry?.TimestampIST; const tsOut=exit_?.TimestampIST;
  const durationMs = (tsIn&&tsOut) ? Math.round((new Date(tsOut)-new Date(tsIn))) : null;
  const appName=common?.ApplicationName||null;
  const reqUri=common?.RequestUri||null;
  const corrId=common?.correlationId||raw?.correlation_id||log.trace_id;

  // Analytics section (only shown if we have enriched data)
  const hasAnalytics = latMs||httpSt||flowIn||appName||reqUri||durationMs;
  const analyticsHtml = hasAnalytics ? `
    <div class="modal-section analytics-section">
      <div class="modal-section-title">📊 Analytics</div>
      <div class="modal-grid analytics-grid">
        ${appName?`<div><small>Application</small><b>${esc(appName)}</b></div>`:''}
        ${reqUri?`<div><small>Request URI</small><b>${esc(reqUri)}</b></div>`:''}
        ${flowIn?`<div><small>Flow</small><b>${esc(flowIn)}</b></div>`:''}
        ${httpSt?`<div><small>HTTP Status</small><b style="color:${Number(httpSt)>=400?'#ff4d6d':'#2dc653'}">${esc(String(httpSt))}</b></div>`:''}
        ${latMs?`<div><small>Observed Latency</small><b style="color:${Number(latMs)>2000?'#ff4d6d':Number(latMs)>500?'#f77f00':'#2dc653'}">${latMs}ms</b></div>`:''}
        ${durationMs!==null?`<div><small>End-to-End Duration</small><b style="color:${durationMs>3000?'#ff4d6d':durationMs>1000?'#f77f00':'#2dc653'}">${durationMs}ms</b></div>`:''}
      </div>
    </div>` : '';

  setHtml('modalBody',`
    <div class="modal-section" style="border-left:3px solid ${sc};padding-left:12px">
      <div class="modal-grid">
        <div><small>Timestamp</small><b>${esc(new Date(log.timestamp).toLocaleString())}</b></div>
        <div><small>Severity</small><b style="color:${sc}">${esc(log.severity||'-')}</b></div>
        <div><small>Service</small><b>${esc(log.service_name||'-')}</b></div>
        <div><small>Endpoint</small><b>${esc((log.method||'')+' '+(log.path||''))}</b></div>
        <div><small>Trace / Event ID</small><b class="copy-field" title="Click to copy">${esc(log.trace_id||raw?.event_id||'-')}</b></div>
        <div><small>Correlation ID</small><b class="copy-field" title="Click to copy">${esc(corrId||'-')}</b></div>
        <div><small>Transaction ID</small><b>${esc(raw?.transaction_id||'-')}</b></div>
      </div>
    </div>
    ${analyticsHtml}
    <div class="modal-section">
      <div class="modal-section-title">💬 Message</div>
      <pre class="modal-pre">${esc(log.message||'')}</pre>
    </div>
    <div class="modal-section">
      <div class="modal-section-title">🗂 Raw Event</div>
      <pre class="modal-pre json-pre">${esc(JSON.stringify(log.raw||log,null,2))}</pre>
    </div>
  `);
  // Copy-on-click
  $$('.copy-field').forEach(el=>el.onclick=()=>{navigator.clipboard?.writeText(el.textContent).then(()=>toast('Copied!','success'));});
  $('logModal')&&$('logModal').classList.add('open');
}
function closeLogModal(){ $('logModal')&&$('logModal').classList.remove('open'); }


function fileSize(bytes){
  const n=Number(bytes||0); if(!n)return '0 KB';
  const units=['B','KB','MB','GB']; let v=n, i=0; while(v>=1024 && i<units.length-1){v/=1024;i++;}
  return `${v>=10?Math.round(v):v.toFixed(1)} ${units[i]}`;
}
function statusBadge(status){
  const s=String(status||'unknown').toLowerCase();
  const label=s==='healthy'?'completed':s;
  return `<span class="status-badge ${esc(label)}">${esc(label)}</span>`;
}
function updateUploadBulkButtons(){
  const count=state.uploadSelections.size;
  const btn=$('deleteSelectedUploadsBtn');
  if(btn){btn.disabled=!count;btn.textContent=count?`Delete selected (${count})`:'Delete selected';}
}
async function loadUploadHistory(){
  try{
    const rows=await api(endpoint('/uploads'));
    state.uploadRows=rows||[];
    state.uploadSelections=new Set([...state.uploadSelections].filter(id=>state.uploadRows.some(r=>r.id===id)));
    const completed=state.uploadRows.filter(r=>['completed','healthy'].includes(String(r.status||'').toLowerCase())).length;
    const failed=state.uploadRows.filter(r=>String(r.status||'').toLowerCase()==='failed').length;
    const logs=state.uploadRows.reduce((a,r)=>a+Number(r.stored_logs ?? r.total_logs ?? 0),0);
    setHtml('uploadHistorySummary', [
      ['Files', state.uploadRows.length], ['Completed', completed], ['Failed', failed], ['Stored logs', fmt(logs)]
    ].map(([k,v])=>`<div class="history-stat"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join(''));
    renderUploadHistoryTable();
  }catch(e){toast(e.message,'error');}
}
function renderUploadHistoryTable(){
  const host=$('uploadHistoryTable'); if(!host)return;
  const rows=state.uploadRows||[];
  if(!rows.length){host.innerHTML=empty('No upload history yet. Upload a log file from Overview to see file-level tracking here.'); updateUploadBulkButtons(); return;}
  const allChecked=rows.length && rows.every(r=>state.uploadSelections.has(r.id));
  host.innerHTML=`<div class="history-table">
    <div class="history-row history-header">
      <label class="check-cell"><input id="selectAllUploads" type="checkbox" ${allChecked?'checked':''}/><span></span></label>
      <div>File</div><div>Status</div><div>Logs</div><div>Size</div><div>Uploaded at</div><div>Actions</div>
    </div>
    ${rows.map(r=>{
      const id=esc(r.id), selected=state.uploadSelections.has(r.id);
      const logs=Number(r.stored_logs ?? r.total_logs ?? 0);
      return `<div class="history-row">
        <label class="check-cell"><input class="upload-check" data-upload-id="${id}" type="checkbox" ${selected?'checked':''}/><span></span></label>
        <div class="file-cell"><strong>${esc(r.file_name||r.source_name||'upload.log')}</strong><small>${esc(r.meta?.stage||r.meta?.error||'Environment scoped upload')}</small></div>
        <div>${statusBadge(r.status)}</div>
        <div><b>${fmt(logs)}</b><small>events</small></div>
        <div>${fileSize(r.file_size||r.meta?.bytes)}</div>
        <div><b>${new Date(r.created_at).toLocaleString()}</b><small>${esc(state.environment)}</small></div>
        <div class="row-actions"><button class="secondary tiny view-upload-logs" data-upload-id="${id}" type="button">View logs</button><button class="danger-subtle tiny delete-upload" data-upload-id="${id}" type="button">Delete</button></div>
      </div>`;
    }).join('')}
  </div>`;
  $('selectAllUploads')&&($('selectAllUploads').onchange=e=>{state.uploadSelections=e.target.checked?new Set(rows.map(r=>r.id)):new Set();renderUploadHistoryTable();});
  $$('.upload-check').forEach(c=>c.onchange=e=>{const id=e.target.dataset.uploadId;if(e.target.checked)state.uploadSelections.add(id);else state.uploadSelections.delete(id);updateUploadBulkButtons();});
  $$('.delete-upload').forEach(b=>b.onclick=()=>deleteUploads([b.dataset.uploadId]));
  $$('.view-upload-logs').forEach(b=>b.onclick=()=>{setPage('logs');$('logQuery').value=b.dataset.fileName||'';state.traceFilter='';state.uploadFilter='';searchLogs(1);});
  updateUploadBulkButtons();
}
async function deleteUploads(ids){
  const selected=(ids||[]).filter(Boolean);
  if(!selected.length)return;
  const ok=confirm(`Delete ${selected.length} uploaded file record(s) and only their stored logs from ${state.environment}?`);
  if(!ok)return;
  try{
    const res=await api(endpoint('/uploads'),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:selected})});
    toast(`Deleted ${fmt(res.deleted_logs||0)} logs from ${fmt(res.deleted_uploads||0)} upload(s)`,'success');
    state.uploadSelections=new Set();
    await Promise.allSettled([loadUploadHistory(),loadOverview(),loadApisEndpoints(),searchLogs(1),loadAlertsOps()]);
  }catch(e){toast(e.message,'error');}
}
async function deleteAllUploads(){
  const ok=confirm(`Delete ALL upload history and ALL uploaded logs for ${state.environment}? This cannot be undone.`);
  if(!ok)return;
  try{
    const res=await api(endpoint('/uploads'),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({all:true})});
    toast(`Deleted ${fmt(res.deleted_logs||0)} logs and ${fmt(res.deleted_uploads||0)} upload record(s)`,'success');
    state.uploadSelections=new Set();
    await Promise.allSettled([loadUploadHistory(),refreshAll()]);
  }catch(e){toast(e.message,'error');}
}

async function loadAlertRules(){
  const host=$('alertRules'); if(!host) return;
  try{
    const rows=await api(endpoint('/alert-rules'));
    host.innerHTML=rows.map(r=>`<div class="rule-item ${r.builtin?'builtin':''}"><div><b>${esc(r.name)}</b><small>${esc(r.description||`${r.metric} ${r.operator} ${r.threshold}`)}</small></div><span class="severity-pill ${esc(r.severity)}">${esc(r.severity)}</span><code>${esc(r.metric)} ${esc(r.operator)} ${esc(r.threshold)}</code></div>`).join('')||empty('No rules configured');
  }catch(e){host.innerHTML=empty('Alert rules unavailable');}
}

async function createCustomRule(){
  const payload={
    name:$('ruleName')?.value||'', metric:$('ruleMetric')?.value||'error_rate_pct', operator:$('ruleOperator')?.value||'>',
    threshold:Number($('ruleThreshold')?.value||1), severity:$('ruleSeverity')?.value||'P2',
    service_name:$('ruleService')?.value||'', window_minutes:Number($('ruleWindow')?.value||15)
  };
  if(!payload.name.trim()) return toast('Enter alert rule name','error');
  try{await api(endpoint('/alert-rules'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});toast('Custom alert rule created','success');$('ruleName').value='';await loadAlertRules();}
  catch(e){toast(e.message,'error');}
}

async function evaluateAlertsNow(){
  try{const res=await api(endpoint('/alerts/evaluate'),{method:'POST'});toast(res.created?`Created ${res.created} alert(s)`:`Checked ${res.checked || 0} signals. No new alert.`,'success');await Promise.allSettled([loadAlertsOps(),loadOverview()]);}
  catch(e){toast(e.message,'error');}
}

function alertCard(x){
  const sev=x.severity||'INFO';
  const value=x.current_value!==null&&x.current_value!==undefined?`<span>${esc(x.metric||'metric')}: <b>${Number(x.current_value).toFixed(2)}</b> / ${esc(x.threshold??'-')}</span>`:'';
  const service=x.service_name||x.path||'Environment';
  return `<div class="incident-card ${esc(sev)}"><div class="incident-main"><span class="severity-pill ${esc(sev)}">${esc(sev)}</span><div><b>${esc(x.title)}</b><p>${esc(x.description||'')}</p><small>${esc(service)} · ${new Date(x.created_at).toLocaleString()}</small></div></div><div class="incident-meta">${value}<button class="mini-link" data-alert-filter="${esc(x.service_name||'')}">Investigate →</button></div></div>`;
}

async function loadAlertsOps(){try{
  const [a,o]=await Promise.all([api(endpoint('/alerts')),api(endpoint('/ops')).catch(()=>({}))]);
  if($('alertKpis')){
    const p1=a.filter(x=>x.severity==='P1').length,p2=a.filter(x=>x.severity==='P2').length,open=a.filter(x=>x.status==='open').length;
    $('alertKpis').innerHTML=[['Open',open],['P1 Critical',p1],['P2 High',p2],['Environment',state.environment]].map(([k,v])=>`<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('');
  }
  if($('alertList')) $('alertList').innerHTML=a.length?a.map(alertCard).join(''):empty('No active alerts. Use “Evaluate now” or create custom alert rules.');
  $$('.incident-meta [data-alert-filter]').forEach(b=>b.onclick=()=>{setPage('logs');$('serviceFilter').value=b.dataset.alertFilter||'';refreshPathFilter();$('severityFilter').value='ERROR';$('quickTime').value='24h';searchLogs(1);});

  const deployments=o.deployments||[];
  if($('deploymentList')) $('deploymentList').innerHTML=deployments.length?deployments.map(x=>`<div class="ops-row"><div><b>${esc(x.version||x.source_name||'Upload / release')}</b><small>${esc(x.service_name||'Environment')} · ${new Date(x.deployed_at||x.created_at||Date.now()).toLocaleString()}</small></div><div><small>Before</small><b>${fmtPct(x.before_error_rate)}</b></div><div><small>After</small><b>${fmtPct(x.after_error_rate)}</b></div><p>${esc(x.notes||'Track release risk by comparing error rate and latency before/after deployment.')}</p></div>`).join(''):empty('No deployment records yet. Upload impact appears under Upload History after logs are available.');

  const ingestion=o.ingestion||o.ingestion_jobs||[];
  if($('ingestionList')) $('ingestionList').innerHTML=ingestion.length?ingestion.map(x=>{const bad=Number(x.rejected_count||0)+Number(x.parser_errors||0);return `<div class="ops-row ${bad?'warn':''}"><div><b>${esc(x.source_type)} · ${esc(x.source_name)}</b><small>${esc(x.status||'observed')} · ${x.last_received_at?new Date(x.last_received_at).toLocaleString():new Date(x.created_at||Date.now()).toLocaleString()}</small></div><div><small>Accepted</small><b>${fmt(x.accepted_count)}</b></div><div><small>Rejected</small><b>${fmt(x.rejected_count)}</b></div><p>${bad?'Parser rejects detected. Review parser rules or source format.':'Ingestion healthy for this source.'}</p></div>`;}).join(''):empty('No ingestion jobs yet. Configure S3, API ingestion, or upload a log file.');

  const security=o.security||o.security_events||[];
  if($('securityList')) $('securityList').innerHTML=(security.length?security:[{event_type:'PII masking policy',message:'Mask passwords, tokens, authorization headers, Aadhaar/PAN-like identifiers before indexing.',severity:'INFO',count:0},{event_type:'Header hygiene',message:'Store only required headers; redact cookies and secrets by default.',severity:'INFO',count:0}]).map(x=>`<div class="ops-row"><div><b>${esc(x.event_type)}</b><small>${esc(x.severity||'INFO')}</small></div><p>${esc(x.message)} ${x.count?`· ${fmt(x.count)} events`:''}</p></div>`).join('');

  await loadEnvironmentConfig();

  const prompts=['Why did error rate increase in last 24 hours?','Show top failing endpoint and likely Mule flow root cause.','Compare latest upload with previous logs and explain regression.','Find security/masking issues in recent ERROR logs.'];
  if($('rcaPromptList')) $('rcaPromptList').innerHTML=prompts.map(p=>`<button class="prompt-chip">${esc(p)}</button>`).join('');
  if($('rcaQuickPrompts')) $('rcaQuickPrompts').innerHTML=prompts.map(p=>`<button class="prompt-chip">${esc(p)}</button>`).join('');
  $$('.prompt-chip').forEach(b=>b.onclick=()=>{setPage('rca');$('rcaQuery').value=b.textContent;runRca();});
}catch(e){console.warn(e);}}


async function loadEnvironmentConfig(){
  try{
    const cfg = await api(endpoint('/config'));
    const p = cfg.policy || {};
    if($('retentionDays')) $('retentionDays').value = p.retention_days ?? 30;
    if($('rateLimitPerMin')) $('rateLimitPerMin').value = p.rate_limit_per_minute ?? 180;
    if($('ingestRateLimitPerMin')) $('ingestRateLimitPerMin').value = p.ingest_rate_limit_per_minute ?? 30;
    if($('archiveToS3')) $('archiveToS3').checked = !!p.archive_to_s3;
    if($('policyList')) $('policyList').innerHTML = [
      ['Retention', `${p.retention_days ?? 30} days${p.archive_to_s3 ? ' + S3 archive' : ''}`],
      ['Rate limit', `${p.rate_limit_per_minute ?? 180}/min app, ${p.ingest_rate_limit_per_minute ?? 30}/min ingestion`],
      ['Sources', (p.allowed_ingestion_sources || ['UPLOAD','API','S3']).join(', ')],
      ['Environment isolation', `Current scope: ${state.environment}. Analytics are not merged across environments.`]
    ].map(([k,v])=>`<div class="policy-item"><b>${esc(k)}</b><p>${esc(v)}</p></div>`).join('');
    const rules = cfg.masking_rules || [];
    if($('maskingRuleList')) $('maskingRuleList').innerHTML = rules.map(r=>`<div class="mask-rule-card"><div class="mask-rule-main"><div class="mask-rule-title"><b>${esc(r.field_name)}</b>${r.builtin?'<span class="tiny-badge">Default</span>':''}</div><p><code>${esc(r.pattern || 'Field-name based masking')}</code></p><small>Replacement: <b>${esc(r.replacement || '[MASKED]')}</b> · ${r.enabled?'enabled':'disabled'}</small></div><div class="mask-rule-actions"><button class="icon-btn edit-mask" title="Edit masking rule" data-id="${esc(r.id||r.field_name)}" data-field="${esc(r.field_name)}" data-pattern="${esc(r.pattern||'')}" data-replacement="${esc(r.replacement||'[MASKED]')}">Edit</button><button class="icon-btn danger delete-mask" title="Delete masking rule" data-id="${esc(r.id||r.field_name)}" data-field="${esc(r.field_name)}">Delete</button></div></div>`).join('') || empty('No masking rules configured yet.');
    $$('.edit-mask').forEach(b=>b.onclick=()=>{ if($('maskFieldName')) $('maskFieldName').value=b.dataset.field||''; if($('maskPattern')) $('maskPattern').value=b.dataset.pattern||''; if($('maskReplacement')) $('maskReplacement').value=b.dataset.replacement||'[MASKED]'; $('maskFieldName')?.focus(); });
    $$('.delete-mask').forEach(b=>b.onclick=()=>deleteMaskRule(b.dataset.id, b.dataset.field));
    const rca = cfg.rca || {};
    if($('aiProvider')) $('aiProvider').value = rca.provider || 'local';
    if($('aiModel')) $('aiModel').value = rca.model || '';
    if($('aiEnabled')) $('aiEnabled').checked = rca.enabled !== false;
    if($('aiProviderInfo')) $('aiProviderInfo').innerHTML = `<div><span class="tiny-badge">Current Provider</span><h4>${esc(rca.provider || 'local')}</h4><p>Model: <b>${esc(rca.model || 'local-rule-engine')}</b></p><small>${rca.enabled ? 'External AI enabled when API key is present.' : 'Local rule engine only. No external API calls.'}</small></div>`;
    await Promise.allSettled([loadIngestKeys(), loadAuditLogs()]);
  }catch(e){ console.warn('config unavailable', e); }
}


async function loadIngestKeys(){
  const host=$('ingestKeyList'); if(!host) return;
  try{
    const rows=await api(endpoint('/ingest-keys'));
    host.innerHTML=rows.length?rows.map(k=>`<div class="key-card"><div><b>${esc(k.key_name)}</b><small>${esc(k.masked_key || (k.key_prefix+'••••'))} · ${esc(k.status)} · last used: ${k.last_used_at?new Date(k.last_used_at).toLocaleString():'never'}</small></div><div class="row-actions"><button class="mini-link danger revoke-key" data-id="${esc(k.id)}">Revoke</button><button class="mini-link danger delete-key" data-id="${esc(k.id)}">Delete</button></div></div>`).join(''):empty('No ingestion keys yet. Generate one for API ingestion from MuleSoft or external systems.');
    $$('.revoke-key').forEach(b=>b.onclick=()=>revokeIngestKey(b.dataset.id));
    $$('.delete-key').forEach(b=>b.onclick=()=>deleteIngestKey(b.dataset.id));
  }catch(e){host.innerHTML=empty('Ingestion keys unavailable');}
}
async function createIngestKey(){
  const name=($('newIngestKeyName')?.value||'Default ingestion key').trim();
  try{
    const row=await api(endpoint('/ingest-keys'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key_name:name,allowed_sources:['API']})});
    if($('newIngestKeyOutput')) $('newIngestKeyOutput').textContent=`Copy now. This key is shown only once:\n${row.plain_key}\n\nUse as: Authorization: Bearer ${row.plain_key}`;
    toast('Ingestion API key generated','success');
    await Promise.allSettled([loadIngestKeys(),loadAuditLogs()]);
  }catch(e){toast(e.message,'error');}
}
async function revokeIngestKey(id){
  if(!confirm('Revoke this ingestion key? Existing integrations using this key will stop.')) return;
  try{await api(endpoint(`/ingest-keys/${encodeURIComponent(id)}/revoke`),{method:'POST'});toast('Key revoked','success');await Promise.allSettled([loadIngestKeys(),loadAuditLogs()]);}catch(e){toast(e.message,'error');}
}
async function deleteIngestKey(id){
  if(!confirm('Delete this ingestion key record? Prefer revoke if integrations still reference it.')) return;
  try{await api(endpoint(`/ingest-keys/${encodeURIComponent(id)}`),{method:'DELETE'});toast('Key deleted','success');await Promise.allSettled([loadIngestKeys(),loadAuditLogs()]);}catch(e){toast(e.message,'error');}
}
async function loadAuditLogs(){
  const host=$('auditLogList'); if(!host) return;
  try{
    const rows=await api(endpoint('/audit-logs?limit=20'));
    host.innerHTML=rows.length?rows.map(a=>`<div class="audit-row"><b>${esc(a.action)} ${esc(a.entity_type||'')}</b><small>${new Date(a.created_at).toLocaleString()} · ${esc(a.actor||'system')}</small></div>`).join(''):empty('No audit activity yet.');
  }catch(e){host.innerHTML=empty('Audit history unavailable');}
}
async function testMasking(){
  const sample=$('maskTestInput')?.value||'';
  if(!sample.trim()) return toast('Paste sample text to test masking','error');
  try{
    const res=await api(endpoint('/masking-rules/test'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sample})});
    if($('maskTestOutput')) $('maskTestOutput').textContent=`Hits: ${(res.hits||[]).join(', ') || 'none'}\n\n${res.masked || ''}`;
  }catch(e){toast(e.message,'error');}
}

async function saveEnvironmentPolicy(){
  const payload={ policy:{ retention_days:Number($('retentionDays')?.value||30), archive_to_s3:!!$('archiveToS3')?.checked, rate_limit_per_minute:Number($('rateLimitPerMin')?.value||180), ingest_rate_limit_per_minute:Number($('ingestRateLimitPerMin')?.value||30), allowed_ingestion_sources:['UPLOAD','API','S3'] } };
  await api(endpoint('/config'),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  toast('Environment policy saved','success'); await loadEnvironmentConfig();
}

async function resetEnvironmentPolicy(){
  if(!confirm(`Reset policy for ${state.environment} to defaults?`)) return;
  await api(endpoint('/config/policy'),{method:'DELETE'});
  toast('Environment policy reset','success'); await loadEnvironmentConfig();
}

async function saveMaskRule(){
  const field=$('maskFieldName')?.value?.trim(); if(!field) return toast('Enter business field name to mask','error');
  const payload={ field_name:field, pattern:$('maskPattern')?.value||null, replacement:$('maskReplacement')?.value||'[MASKED]', enabled:true };
  await api(endpoint('/masking-rules'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  toast('Masking rule saved','success'); ['maskFieldName','maskPattern','maskReplacement'].forEach(id=>$(id)&&($(id).value='')); await loadEnvironmentConfig();
}

async function deleteMaskRule(id, field){
  const key = id || field;
  if(!key) return;
  if(!confirm(`Delete masking rule ${field || key}?`)) return;
  const res = await api(endpoint(`/masking-rules/${encodeURIComponent(key)}`),{method:'DELETE'});
  if(res?.deleted || res?.disabled_builtin){
    toast('Masking rule deleted','success');
  } else {
    toast('Rule was already removed or not found','info');
  }
  await loadEnvironmentConfig();
}


async function saveAiProvider(){
  const payload={ rca:{ provider:$('aiProvider')?.value||'local', model:$('aiModel')?.value||'', enabled:!!$('aiEnabled')?.checked } };
  await api(endpoint('/config'),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  toast('AI RCA provider saved','success'); await loadEnvironmentConfig();
}

async function loadEnvironmentList(){
  try{ const envs = await api(`/api/${state.workspace}/environments`); state.environments = [...new Set([...(envs||[]).map(e=>e.name||e).filter(Boolean),'PROD','UAT','DEV','DR'])]; }
  catch{ state.environments=[...new Set(['PROD','UAT','DEV','DR',...getExtraEnvs()])]; }
}
async function createCustomEnvironment(){
  const name=$('newEnvironmentName')?.value?.trim(); if(!name) return toast('Enter environment name','error');
  await api(`/api/${state.workspace}/environments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  $('newEnvironmentName').value=''; toast('Environment added','success'); await loadEnvironmentList(); renderEnvButtons();
}
async function renameEnvironment(oldName){
  const next=prompt('Environment name', oldName); if(!next || next.toUpperCase()===oldName) return;
  const env=await api(`/api/${state.workspace}/environments/${encodeURIComponent(oldName)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:next})});
  if(state.environment===oldName){state.environment=env.name||next.toUpperCase();localStorage.setItem('observex-env',state.environment);}
  toast('Environment updated','success'); await loadEnvironmentList(); await refreshAll();
}
async function removeEnvironment(name){
  name=String(name||'').toUpperCase();
  if(name==='PROD') return toast('PROD cannot be deleted','error');
  if(!confirm(`Delete environment ${name}? This removes its scoped logs, rules, alerts and policies.`)) return;
  try{
    const res = await api(`/api/${state.workspace}/environments/${encodeURIComponent(name)}`,{method:'DELETE'});
    // Optimistic UI removal so stale cached rows do not remain visible.
    state.environments = (state.environments||[]).filter(e=>String(e).toUpperCase()!==name);
    const row = document.querySelector(`[data-env-row="${CSS.escape(name)}"]`); if(row) row.remove();
    if(state.environment===name){state.environment='PROD';localStorage.setItem('observex-env','PROD');}
    await loadEnvironmentList();
    state.environments = (state.environments||[]).filter(e=>String(e).toUpperCase()!==name);
    renderEnvButtons();
    toast((res?.deleted===0?'Environment was already removed':'Environment deleted'),'success');
    if(state.environment==='PROD') await refreshAll();
  }catch(e){ toast(e.message || 'Delete failed','error'); }
}
function getExtraEnvs(){try{return JSON.parse(localStorage.getItem('observex-extra-envs')||'[]')}catch{return []}}

async function runRca(){setPage('rca');const query=$('rcaQuery').value||'Analyze current environment issues';const data=await api(endpoint('/rca'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});$('rcaContent').innerHTML=`<div class="insight"><h4>${esc(data.likely_root_cause||'Environment RCA')}</h4><p>${esc(data.summary||'No summary')}</p><small>RCA engine: ${esc(data.ai_provider||'local')} · ${esc(data.ai_model||'local-rule-engine')}</small></div>${data.ai_summary?`<div class="insight"><b>AI Analysis</b><p>${esc(data.ai_summary)}</p></div>`:''}${data.ai_error?`<div class="insight warn"><b>AI Provider Error</b><p>${esc(data.ai_error)}</p></div>`:''}${(data.recommended_actions||data.recommendations||[]).map(r=>`<div class="insight"><b>Action</b><p>${esc(r)}</p></div>`).join('')}`;}

async function clearUploadedLogs(){
  const ok = confirm(`Delete all logs, discovered APIs/endpoints, traces, alerts and ingestion records for ${state.environment}? This is useful after a bad parser upload.`);
  if(!ok) return;
  try{
    const res = await api(endpoint('/logs'), {method:'DELETE'});
    toast(`Deleted ${fmt(res?.deleted||0)} log events from ${state.environment}`,'success');
    await refreshAll();
  }catch(e){toast(e.message,'error');}
}

function showIngestProgress(job){
  const box=$('ingestProgress'); if(!box) return;
  box.hidden=false;
  const totalBytes = Number(job.bytes || 0);
  const inserted   = Number(job.inserted || 0);
  const parsed     = Number(job.parsed   || 0);
  const speed      = Number(job.speed    || 0);
  const parseMs    = Number(job.parse_ms || 0);
  const insertMs   = Number(job.insert_ms|| 0);
  const peakHeap   = Number(job.peak_heap_mb || 0);

  let pct = 8;
  if(job.status==='queued')      pct = 18;
  else if(job.status==='processing'){
    // Use parsed vs inserted to show two-phase progress
    const parsePhase   = parsed  ? Math.min(50, 18 + Math.round(parsed  / Math.max(parsed, 1)  * 40)) : 18;
    const insertPhase  = inserted? Math.min(96, 58 + Math.round(inserted/ Math.max(parsed||inserted,1) * 38)) : parsePhase;
    pct = Math.max(parsePhase, insertPhase);
  }
  else if(job.status==='completed') pct = 100;
  else if(job.status==='failed')    pct = 100;

  setText('ingestStage',   job.stage || job.status || 'Processing');
  setText('ingestMeta',    `${esc(job.fileName||'upload')} · ${fmt(Math.round(totalBytes/1024))} KB · ${esc(job.status||'')}`);
  setText('ingestPercent', `${pct}%`);
  setText('ingestParsed',  `${fmt(parsed)} parsed`);
  setText('ingestInserted',`${fmt(inserted)} inserted`);
  setText('ingestSpeed',   `${fmt(speed)} logs/sec`);

  // v21: extra telemetry fields
  const telEl=$('ingestTelemetry');
  if(telEl){
    const parts=[];
    if(parseMs>0)  parts.push(`Parse ${parseMs<1000?parseMs+'ms':((parseMs/1000).toFixed(1)+'s')}`);
    if(insertMs>0) parts.push(`DB ${insertMs<1000?insertMs+'ms':((insertMs/1000).toFixed(1)+'s')}`);
    if(peakHeap>0) parts.push(`Peak ${peakHeap}MB heap`);
    telEl.hidden  = parts.length===0;
    telEl.textContent = parts.join(' · ');
  }

  const errEl=$('ingestError');
  if(errEl){
    const err=job.error || job.meta?.error || '';
    errEl.hidden      = !(job.status==='failed' && err);
    errEl.textContent = err ? `Reason: ${err}` : '';
  }
  const bar=$('ingestBar');
  if(bar){
    bar.style.width      = pct+'%';
    bar.style.background = job.status==='failed'?'#ff4d6d':job.status==='completed'?'#2dc653':'';
  }
}

async function pollIngestionJob(jobId, silent=false){
  for(let i=0;i<720;i++){
    const job = await api(endpoint(`/ingestion/${jobId}`));
    if(!silent) showIngestProgress(job);
    if(job.status==='completed') return job;
    if(job.status==='failed') throw new Error(job.error || job.meta?.error || 'Ingestion failed. Open Upload History to see details.');
    await new Promise(r=>setTimeout(r, 1000));
  }
  throw new Error('Ingestion is still running. Please check Ops → Ingestion Jobs.');
}

async function uploadManyFiles(files){
  const list=Array.from(files||[]).filter(Boolean).slice(0, 200);
  if(!list.length) return;
  const MAX_CONCURRENT_UPLOADS = 10;
  const totalBytes=list.reduce((a,f)=>a+(f.size||0),0);
  const results=list.map(f=>({file:f.name,status:'queued'}));
  const renderBatch=()=>{
    const done=results.filter(r=>['completed','failed'].includes(r.status)).length;
    const ok=results.filter(r=>r.status==='completed').length;
    const failed=results.filter(r=>r.status==='failed').length;
    setText('uploadStatus',`Batch ${done}/${results.length} · running up to ${MAX_CONCURRENT_UPLOADS} files · ${ok} completed${failed?` · ${failed} failed`:''}`);
    const progress=$('ingestProgress'); if(progress) progress.hidden=false;
    setText('ingestStage',`Batch upload running (${Math.min(MAX_CONCURRENT_UPLOADS, list.length)} parallel)`);
    setText('ingestMeta',`${fmt(results.length)} files · ${fileSize(totalBytes)} total`);
    setText('ingestPercent',`${Math.round((done/Math.max(results.length,1))*100)}%`);
    setText('ingestParsed',`${fmt(ok)} completed`); setText('ingestInserted',`${fmt(failed)} failed`); setText('ingestSpeed',`${fmt(results.length-done)} active/queued`);
    const bar=$('ingestBar'); if(bar) bar.style.width=`${Math.round((done/Math.max(results.length,1))*100)}%`;
  };
  toast(`Queued ${list.length} file(s) · processing ${Math.min(MAX_CONCURRENT_UPLOADS, list.length)} at a time`,'info');
  renderBatch();
  let cursor=0;
  async function worker(workerNo){
    while(cursor<list.length){
      const i=cursor++;
      const f=list[i];
      results[i].status='uploading'; renderBatch();
      try{
        await uploadBody(f,f.name,{batchIndex:i+1,batchTotal:list.length,refresh:false,silent:true});
        results[i].status='completed';
      }catch(e){
        results[i].status='failed'; results[i].error=e.message;
        toast(`${f.name}: ${e.message}`,'error');
      }
      renderBatch();
    }
  }
  await Promise.all(Array.from({length:Math.min(MAX_CONCURRENT_UPLOADS, list.length)},(_,i)=>worker(i+1)));
  const ok=results.filter(r=>r.status==='completed').length;
  const failed=results.length-ok;
  setText('uploadStatus',`Batch completed · ${ok}/${results.length} succeeded${failed?` · ${failed} failed`:''}`);
  await Promise.allSettled([loadOverview(),loadApisEndpoints(),loadAlertsOps(),loadUploadHistory(),searchLogs(1)]);
  toast(`Batch upload finished: ${ok} succeeded${failed?`, ${failed} failed`:''}` , failed?'error':'success');
}

async function uploadBody(body,name='pasted logs',opts={}){
  const headers={'Content-Type':'text/plain','X-File-Name':name};
  const isFile = typeof File !== 'undefined' && body instanceof File;
  const size = isFile ? body.size : new Blob([body]).size;
  if(!opts.silent){
    setText('uploadStatus',`${opts.batchTotal?`File ${opts.batchIndex}/${opts.batchTotal} · `:''}Starting ingestion for ${name}...`);
    showIngestProgress({fileName:name,status:'receiving',stage:'Preparing upload',bytes:size,parsed:0,inserted:0,speed:0});
  }
  try{
    const start=performance.now();
    const startRes=await api(endpoint('/logs/upload-async'),{method:'POST',headers,body});
    if(!opts.silent){ showIngestProgress(startRes); setText('uploadStatus',`Queued ${name}. Parsing in background...`); }
    const job=await pollIngestionJob(startRes.id, opts.silent);
    const sec=Math.max((performance.now()-start)/1000,.1).toFixed(1);
    if(!opts.batchTotal && !opts.silent) toast(`Ingested ${fmt(job.inserted||0)} events in ${sec}s`,'success');
    if(!opts.silent) setText('uploadStatus',`Upload completed · ${fmt(job.inserted||0)} events · ${fmt(job.speed||0)} logs/sec · ${sec}s`);
    if($('logUpload')) $('logUpload').value='';
    if($('quickTime')) $('quickTime').value='all';
    if(opts.refresh!==false){
      await Promise.allSettled([loadOverview(),loadApisEndpoints(),loadAlertsOps(),loadUploadHistory(),searchLogs(1)]);
      toast('Upload complete. Metrics, services, endpoints and search are refreshed.','success');
    }
  }catch(e){if(!opts.silent){setText('uploadStatus','Upload failed');toast(e.message,'error');showIngestProgress({fileName:name,status:'failed',stage:'Failed',bytes:size,parsed:0,inserted:0,speed:0,error:e.message});}
    await Promise.allSettled([loadUploadHistory(), loadOverview()]);
    if(opts.batchTotal) throw e;
  }
}

function renderEnvButtons(){
  const host=$('envButtons'); if(!host) return;
  const source = [...(state.environments||[]), 'PROD','UAT','DEV','DR'];
  const envs=[...new Set(source.map(e=>String(e||'').toUpperCase()).filter(Boolean))];
  host.innerHTML=envs.map(env=>`<button type="button" class="env-btn ${env===state.environment?'active':''}" data-env="${esc(env)}">${esc(env)}</button>`).join('');
  if($('environmentList')) $('environmentList').innerHTML=envs.map(env=>`<div class="policy-item editable env-policy-card" data-env-row="${esc(env)}"><div><b>${esc(env)}</b><p>${env===state.environment?'Currently selected environment':'Available environment scope'}</p></div><div class="row-actions env-actions"><button class="mini-link edit-env" data-env="${esc(env)}">Rename</button>${env==='PROD'?'':`<button class="mini-link danger delete-env" data-env="${esc(env)}">Delete</button>`}</div></div>`).join('');
  $$('.edit-env').forEach(b=>b.onclick=()=>renameEnvironment(b.dataset.env));
  $$('.delete-env').forEach(b=>b.onclick=()=>removeEnvironment(b.dataset.env));
  $$('.env-btn').forEach(b=>b.onclick=async()=>{
    const next=b.dataset.env;
    state.environment=next; localStorage.setItem('observex-env',state.environment); renderEnvButtons();
    try{ await api(`/api/${state.workspace}/environments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:next})}); }catch{}
    await refreshAll();
  });
}

const apiDocTemplates = {
  apiIngest: {
    title: 'POST API Ingest', method: 'POST', path: '/logs',
    description: 'Ingest structured log events directly from MuleSoft or another system. Generate a workspace + environment scoped key from Ops → Ingestion API Keys, then send Authorization: Bearer <key>.',
    headers: {'Content-Type':'application/json','Authorization':'Bearer <INGEST_API_KEY>'},
    body: JSON.stringify([{timestamp:new Date().toISOString(),severity:'ERROR',service:'s-paymentengine-api',method:'GET',path:'/paymentEngine/loanDetails',trace_id:'TR-DEMO-1001',correlation_id:'CORR-DEMO-1001',message:'HTTP:NOT_FOUND while calling payment engine loan details',latency_ms:842,error_type:'HTTP:NOT_FOUND'}], null, 2)
  },
  asyncUpload: {
    title: 'POST Async File Upload', method: 'POST', path: '/logs/upload-async',
    description: 'Upload large raw MuleSoft log files. This queues ingestion and returns a job id that can be polled from the ingestion endpoint.',
    headers: {'Content-Type':'text/plain','X-File-Name':'sample-mulesoft.log'},
    body: '2026-05-05 10:48:02 ERROR s-paymentengine-api [correlationId=CORR-1001] GET /paymentEngine/loanDetails HTTP:NOT_FOUND'
  },
  upload: {
    title: 'POST Sync Logs Upload', method: 'POST', path: '/logs/upload',
    description: 'Upload raw MuleSoft logs, JSONL, or plain text synchronously into the selected workspace/environment. Use async upload for larger files.',
    headers: {'Content-Type':'text/plain','X-File-Name':'sample.log'},
    body: '2026-05-05 10:48:02 ERROR s-paymentengine-api GET /paymentEngine/loanDetails HTTP:NOT_FOUND trace_id=TR-1001'
  },
  search: {
    title: 'GET Search Logs', method: 'GET', path: '/logs?q=timeout&severity=ERROR&limit=10',
    description: 'Search indexed logs by text, severity, service, endpoint, trace ID, and time range.',
    headers: {}, body: ''
  },
  errorGroups: {
    title: 'GET Error Groups', method: 'GET', path: '/error-groups?range=24h',
    description: 'Get grouped error signatures for faster RCA and incident triage.',
    headers: {}, body: ''
  },
  rca: {
    title: 'POST AI RCA', method: 'POST', path: '/rca',
    description: 'Run local or configured AI RCA against the selected environment data.',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({query:'Analyze top production errors and suggest RCA'}, null, 2)
  }
};
function renderApiDoc(key='upload'){
  const t = apiDocTemplates[key] || apiDocTemplates.upload;
  $$('.endpoint-doc').forEach(b=>b.classList.toggle('active', b.dataset.docEndpoint===key));
  if($('apiDocDetails')) $('apiDocDetails').innerHTML = `<h4>${esc(t.title)}</h4><p>${esc(t.description)}</p><div class="doc-meta"><span>Base URL: ${esc(apiBaseUrl())}</span><span>Workspace: ${esc(state.workspace)}</span><span>Environment: ${esc(state.environment)}</span><span>Full path includes /api/{workspace}/{environment}</span></div>`;
  if($('apiDocMethod')) $('apiDocMethod').value = t.method;
  if($('apiDocUrl')) $('apiDocUrl').value = fullEndpoint(t.path);
  if($('apiDocHeaders')) $('apiDocHeaders').value = JSON.stringify(t.headers, null, 2);
  if($('apiDocBody')) $('apiDocBody').value = t.body || '';
  if($('apiDocStatus')) $('apiDocStatus').textContent = 'Ready';
}
async function sendApiDocRequest(){
  const method = $('apiDocMethod')?.value || 'GET';
  const url = $('apiDocUrl')?.value || endpoint('/logs?limit=10');
  let headers = {};
  try { headers = JSON.parse($('apiDocHeaders')?.value || '{}'); } catch { return toast('Headers must be valid JSON','error'); }
  const body = $('apiDocBody')?.value || '';
  const started = performance.now();
  if($('apiDocStatus')) $('apiDocStatus').textContent = 'Sending...';
  try{
    const opt = { method, headers };
    if(method !== 'GET' && method !== 'HEAD' && body) opt.body = body;
    const r = await fetch(url, opt);
    const text = await r.text();
    let parsed = text; try { parsed = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    if($('apiDocStatus')) $('apiDocStatus').textContent = `${r.status} ${r.ok?'Success':'Failed'} · ${Math.round(performance.now()-started)}ms`;
    if($('apiDocResponse')) $('apiDocResponse').textContent = parsed || '(empty response)';
  }catch(e){
    if($('apiDocStatus')) $('apiDocStatus').textContent = 'Connection failed';
    if($('apiDocResponse')) $('apiDocResponse').textContent = e.message;
  }
}


async function createManualApi(){
  const service_name=($('manualService')?.value||'').trim();
  const method=($('manualMethod')?.value||'GET').trim();
  const path=($('manualPath')?.value||'').trim();
  if(!service_name) return toast('Enter API/service name','error');
  if(path && !path.startsWith('/')) return toast('Endpoint path must start with /','error');
  try{
    await api(endpoint('/api-registry'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service_name,method,path})});
    toast(path?'Endpoint added':'API added','success');
    ['manualService','manualPath'].forEach(id=>$(id)&&($(id).value=''));
    await loadApisEndpoints();
  }catch(e){toast(e.message,'error');}
}
async function deleteApiRegistry(payload){
  const label = payload.path ? `${payload.method||''} ${payload.path}` : payload.service_name;
  if(!confirm(`Delete/hide ${label} from ${state.environment}? Existing logs stay searchable, but it will be hidden from API catalogue.`)) return;
  try{
    await api(endpoint('/api-registry'),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    toast('API catalogue updated','success');
    await loadApisEndpoints();
  }catch(e){toast(e.message,'error');}
}

function bind(){Object.entries(icons).forEach(([k,v])=>$$(`[data-icon="${k}"]`).forEach(x=>x.innerHTML=v));if($('edgeToggle')) $('edgeToggle').onclick=()=>{state.sidebar=state.sidebar==='closed'?'open':'closed';applySidebar();}; $$('.endpoint-doc').forEach(b=>b.onclick=()=>renderApiDoc(b.dataset.docEndpoint)); if($('sendApiDocBtn')) $('sendApiDocBtn').onclick=sendApiDocRequest; if($('aeSearch')){$('aeSearch').addEventListener('input',e=>{loadApisEndpoints(e.target.value);});};if($('addApiBtn'))$('addApiBtn').onclick=()=>{$('apiRegistryPanel').hidden=!$('apiRegistryPanel').hidden;};if($('saveManualApiBtn'))$('saveManualApiBtn').onclick=createManualApi;if($('themeToggle')) $('themeToggle').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();};if($('appSignOutBtn')) $('appSignOutBtn').onclick=async()=>{try{await fetch('/api/auth/logout',{method:'POST',credentials:'include'});}catch(e){} location.href='/signin.html';};$$('[data-page-link]').forEach(a=>a.onclick=(e)=>{e.preventDefault();setPage(a.dataset.pageLink);});if($('serviceFilter')) $('serviceFilter').onchange=()=>{refreshPathFilter(); if($('pathFilter')) $('pathFilter').value=''; loadErrorGroups();}; if($('pathFilter')) $('pathFilter').onchange=loadErrorGroups; if($('quickTime')) $('quickTime').onchange=loadErrorGroups;if($('saveSearchBtn')) $('saveSearchBtn').onclick=saveCurrentSearch;if($('runAnomalyBtn')) $('runAnomalyBtn').onclick=runAnomalyCheck;if($('evaluateAlertsBtn')) $('evaluateAlertsBtn').onclick=evaluateAlertsNow;if($('createRuleBtn')) $('createRuleBtn').onclick=createCustomRule;if($('savePolicyBtn'))$('savePolicyBtn').onclick=saveEnvironmentPolicy;if($('resetPolicyBtn'))$('resetPolicyBtn').onclick=resetEnvironmentPolicy;if($('saveMaskRuleBtn'))$('saveMaskRuleBtn').onclick=saveMaskRule;if($('saveAiProviderBtn'))$('saveAiProviderBtn').onclick=saveAiProvider;if($('createEnvironmentBtn'))$('createEnvironmentBtn').onclick=createCustomEnvironment;if($('createIngestKeyBtn'))$('createIngestKeyBtn').onclick=createIngestKey;if($('testMaskingBtn'))$('testMaskingBtn').onclick=testMasking;if($('searchLogsBtn')) $('searchLogsBtn').onclick=()=>searchLogs(1);if($('prevLogsBtn')) $('prevLogsBtn').onclick=()=>searchLogs(state.logPage-1);if($('nextLogsBtn')) $('nextLogsBtn').onclick=()=>searchLogs(state.logPage+1);if($('clearFiltersBtn')) $('clearFiltersBtn').onclick=()=>{['logQuery','severityFilter','serviceFilter','pathFilter'].forEach(id=>$(id)&&($(id).value=''));if($('quickTime'))$('quickTime').value='all';state.traceFilter='';state.uploadFilter='';searchLogs(1);};if($('clearLogsBtn'))$('clearLogsBtn').onclick=clearUploadedLogs;if($('refreshUploadsBtn'))$('refreshUploadsBtn').onclick=loadUploadHistory;if($('deleteSelectedUploadsBtn'))$('deleteSelectedUploadsBtn').onclick=()=>deleteUploads([...state.uploadSelections]);if($('deleteAllUploadsBtn'))$('deleteAllUploadsBtn').onclick=deleteAllUploads;if($('askRcaBtn')) $('askRcaBtn').onclick=runRca;if($('rcaPageBtn')) $('rcaPageBtn').onclick=runRca;if($('modalClose')) $('modalClose').onclick=closeLogModal;if($('modalTraceBtn')) $('modalTraceBtn').onclick=()=>{const tid=state.selectedLog?.trace_id||state.selectedLog?.raw?.event_id||state.selectedLog?.raw?.correlation_id;if(!tid)return;openTraceDetail(tid);};if($('logModal')) $('logModal').onclick=e=>{if(e.target.id==='logModal')closeLogModal();};const dz=$('dropZone'),fi=$('fileInput');if(dz&&fi){dz.onclick=()=>fi.click();['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('dragover');}));['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('dragover');}));dz.addEventListener('drop',e=>{const files=e.dataTransfer.files;if(files&&files.length)uploadManyFiles(files);});fi.onchange=()=>{if(fi.files&&fi.files.length)uploadManyFiles(fi.files);};if($('uploadBtn')) $('uploadBtn').onclick=()=>{const text=($('logUpload')?.value||'').trim();if(!text)return toast('Paste logs or choose a file first','error');uploadBody(text);};}}
async function refreshAll(){$('tenantEnvChip')&&($('tenantEnvChip').textContent=state.environment);renderEnvButtons();await Promise.allSettled([loadOverview(),loadApisEndpoints(),searchLogs(1),loadAlertsOps(),loadUploadHistory(),loadSavedSearches()]);}
(async function boot(){applyTheme();applySidebar();bind();await initWorkspaces();setPage(state.page);await refreshAll();})();
