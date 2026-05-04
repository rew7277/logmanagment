const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

const state = {
  workspace: 'fsbl-prod-ops',
  environment: localStorage.getItem('observex-env') || 'PROD',
  theme: localStorage.getItem('observex-theme') || 'light',
  sidebar: localStorage.getItem('observex-sidebar') || 'open',
  page: (location.hash?.slice(1) === 'traces' ? 'logs' : (location.hash?.slice(1) || 'overview')),
  apiKey: localStorage.getItem('observex-ingest-key') || '',
  traceFilter: '',
  logPage: 1,
  logPageSize: 50,
  lastLogs: []
};

const icons = {
  overview:'<svg viewBox="0 0 24 24"><path d="M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-4H4v4Z"/></svg>',
  apis:'<svg viewBox="0 0 24 24"><path d="M8 8h8M8 12h8M8 16h5"/><rect x="4" y="4" width="16" height="16" rx="4"/></svg>',
  endpoints:'<svg viewBox="0 0 24 24"><path d="M6 7h12M6 17h12"/><circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/></svg>',
  logs:'<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
  alerts:'<svg viewBox="0 0 24 24"><path d="M12 4 3 20h18L12 4Z"/><path d="M12 9v5M12 17h.01"/></svg>',
  ops:'<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M3 12h4M17 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg>',
  rca:'<svg viewBox="0 0 24 24"><path d="M12 3a7 7 0 0 0-4 12.7V20h8v-4.3A7 7 0 0 0 12 3Z"/><path d="M9 21h6"/></svg>',
  docs:'<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v6h5M9 14h6M9 18h6"/></svg>'
};

function esc(v){return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function fmt(n){return new Intl.NumberFormat('en-IN').format(Number(n||0));}
function toast(msg, type='info'){const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=msg;($('toastHost')||document.body).appendChild(t);setTimeout(()=>t.remove(),4200);}
function endpoint(path){return `/api/${state.workspace}/${state.environment}${path}`;}
async function api(url,opt={}){const r=await fetch(url,opt);let j={};try{j=await r.json();}catch{}if(!r.ok)throw new Error(j.error||`Request failed (${r.status})`);return j.data ?? j;}
function applyTheme(){document.documentElement.classList.toggle('dark',state.theme==='dark');localStorage.setItem('observex-theme',state.theme);$('themeIcon')&&($('themeIcon').textContent=state.theme==='dark'?'☀':'☾');}
function applySidebar(){const closed=state.sidebar==='closed';$('appShell')&&$('appShell').classList.toggle('sidebar-collapsed',closed);localStorage.setItem('observex-sidebar',state.sidebar);}
function setPage(page){state.page=(page==='traces'?'logs':(page||'overview'));$$('.page').forEach(x=>x.classList.toggle('active',x.dataset.page===state.page));$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.pageLink===state.page));const titles={overview:'Overview',apis:'APIs / Services',endpoints:'Endpoints',logs:'Log Search',alerts:'Alerts',ops:'Ops',rca:'AI RCA',apiDocs:'API Docs'};setText('pageTitle',titles[state.page]||'Overview');$('topActions')&&$('topActions').classList.toggle('visible',state.page!=='logs');if(location.hash.slice(1)!==state.page)history.replaceState(null,'',`#${state.page}`);if(state.page==='logs')searchLogs(1);}
function empty(msg){return `<div class="empty">${esc(msg)}</div>`;}
function metric(label,value,sub,tone='neutral'){return `<div class="metric-card ${tone}"><span class="tag"><span class="dot"></span>${esc(label)}</span><h3>${value}</h3><p>${esc(sub)}</p></div>`;}
function healthScore(m){const logs=Number(m.logs_ingested||0);if(!logs)return 0;const error=Number(m.error_rate||0);const latency=Number(m.p95_latency_ms||0);const alerts=Number(m.active_alerts||0);return Math.round(Math.max(0,Math.min(100,100-(error*2)-Math.max(0,latency-500)/100-(alerts*3))));}
function scoreTone(score){if(!score)return 'empty';if(score>=95)return 'good';if(score>=85)return 'warn';return 'bad';}

async function initWorkspaces(){try{const ws=await api('/api/workspaces');state.workspace=ws[0]?.slug||state.workspace;const name=ws[0]?.name||'FSBL Production Ops';$('brandWorkspaceName')&&($('brandWorkspaceName').textContent=name);}catch{$('brandWorkspaceName')&&($('brandWorkspaceName').textContent='FSBL Production Ops');}}

async function loadOverview(){
  try{
    const {metrics:m}=await api(endpoint('/overview'));
    const score=healthScore(m);
    const tone=scoreTone(score);
    setText('heroEnv', state.environment);
    const ring=$('scoreRing');
    if(ring){ ring.className=`score-ring ${tone}`; ring.style.setProperty('--score',score); ring.innerHTML=`<span>${score?score+'%':'--'}</span>`; }
    setHtml('metrics',[
      metric(state.environment,score?score+'%':'--','Calculated health',tone),
      metric('Error rate',`${Number(m.error_rate||0).toFixed(2)}%`,'From ERROR/FATAL logs',Number(m.error_rate)>5?'bad':'good'),
      metric('P95 latency',`${fmt(m.p95_latency_ms)}ms`,'From traces',Number(m.p95_latency_ms)>1000?'bad':'neutral'),
      metric('Logs',fmt(m.logs_ingested),'Total ingested logs','neutral'),
      metric('Alerts',fmt(m.active_alerts),'Open incidents',Number(m.active_alerts)?'warn':'good')
    ].join(''));
    setText('summaryEnv',`${state.environment} only`);
    setHtml('summaryGrid',[['Services',m.services],['Endpoints',m.endpoints],['Data source',m.logs_ingested?'Live ingestion':'No logs yet'],['Database','Connected'],['Partition',state.environment],['Masking','Policy ready']].map(([k,v])=>`<div class="kv"><small>${k}</small><b>${esc(v)}</b></div>`).join(''));
    setHtml('infraGrid',[['Upload engine','Streaming'],['Recommended path','S3 pre-signed / chunked'],['Search','Filters + FTS'],['Max file','Configurable 500MB+']].map(([k,v])=>`<div class="kv"><small>${k}</small><b>${esc(v)}</b></div>`).join(''));
  }catch(e){toast(e.message,'error');}
}
async function loadServices(){const rows=await api(endpoint('/services'));const sf=$('serviceFilter');if(sf){const current=sf.value;sf.innerHTML='<option value="">All APIs / services</option>'+rows.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');sf.value=[...sf.options].some(o=>o.value===current)?current:'';}$('serviceList').innerHTML=rows.length?rows.map(s=>`<div class="row"><div><strong>${esc(s.name)}</strong><small>Auto-discovered from ingested logs</small></div><div><small>Status</small><b>${esc(s.status||'observed')}</b></div><div><small>Error events</small><b>${Number(s.error_rate||0).toFixed(2)}%</b></div><div><small>P95</small><b>${fmt(s.p95_latency_ms)}ms</b></div><div><small>Runtime</small><b>${esc(s.runtime_version||'-')}</b></div></div>`).join(''):empty('No services found yet. Upload Mule/generic logs to populate APIs automatically.');}
async function loadEndpoints(){const rows=await api(endpoint('/endpoints'));const pf=$('pathFilter');if(pf){const current=pf.value;const seen=new Set();pf.innerHTML='<option value="">All endpoints</option>'+rows.filter(e=>e.path&&!seen.has(e.path)&&seen.add(e.path)).map(e=>`<option value="${esc(e.path)}">${esc((e.method||'')+' '+e.path)} · ${esc(e.service_name||'')}</option>`).join('');pf.value=[...pf.options].some(o=>o.value===current)?current:'';}$('endpointTable').innerHTML=rows.length?`<div class="table">${rows.map(e=>`<div class="row"><div><b>${esc(e.method||'-')}</b></div><div><strong>${esc(e.path||'-')}</strong><small>${esc(e.service_name||'service unknown')}</small></div><div><small>Status</small><b>${esc(e.status||'observed')}</b></div><div><small>Calls</small><b>${fmt(e.calls_total ?? e.calls_per_hour)}</b></div><div><small>Errors</small><b>${Number(e.error_rate||0).toFixed(2)}%</b></div><div><small>P95</small><b>${fmt(e.p95_latency_ms)}ms</b></div></div>`).join('')}</div>`:empty('No endpoints yet. Upload Mule logs or structured logs with method/path.');}
async function loadTraces(){const rows=await api(endpoint('/traces'));$('traceList').innerHTML=rows.length?rows.map(t=>`<div class="row"><div><strong>${esc(t.trace_id)}</strong><small>${esc(t.service_name||'service unknown')} ${esc(t.method||'')} ${esc(t.path||'')}</small></div><div><small>Status</small><b>${esc(t.status)}</b></div><div><small>Latency</small><b>${fmt(t.latency_ms)}ms</b></div><div><small>Started</small><b>${new Date(t.started_at).toLocaleString()}</b></div><div><small>Env</small><b>${state.environment}</b></div></div>`).join(''):empty('No traces yet. Logs with trace_id are searchable; trace waterfall needs trace ingestion.');}

function logParams(page=state.logPage){return new URLSearchParams({limit:String(state.logPageSize),page:String(page),q:$('logQuery')?.value||'',severity:$('severityFilter')?.value||'',service:$('serviceFilter')?.value||'',path:$('pathFilter')?.value||'',trace_id:state.traceFilter||'',range:$('quickTime')?.value||'24h'});}
async function searchLogs(page=state.logPage){state.logPage=Math.max(page,1);const result=await api(endpoint('/logs?'+logParams(state.logPage)));const rows=Array.isArray(result)?result:(result.items||[]);state.lastLogs=rows;const total=Array.isArray(result)?rows.length:result.total;if($('activeTracePill')){if(state.traceFilter){$('activeTracePill').hidden=false;$('activeTracePill').innerHTML=`Trace investigation active: <b>${esc(state.traceFilter)}</b> <button id="clearTraceInvestigation">Clear trace</button>`;setTimeout(()=>{$('clearTraceInvestigation')&&($('clearTraceInvestigation').onclick=()=>{state.traceFilter='';searchLogs(1);});});}else{$('activeTracePill').hidden=true;$('activeTracePill').innerHTML='';}}$('logResultCount')&&($('logResultCount').textContent=`${fmt(total)} logs · page ${result.page||state.logPage} of ${result.total_pages||1}`);setHtml('logStream', rows.length?rows.map((l,i)=>`<button class="log-line ${esc(l.severity)}" data-log-index="${i}"><div class="log-meta"><span class="level ${esc(l.severity)}">${esc(l.severity)}</span><span>${new Date(l.timestamp).toLocaleString()}</span><span>${esc(l.service_name||'-')}</span><span>${esc((l.method||'')+' '+(l.path||''))}</span>${l.trace_id?'<span class="trace-chip">Trace</span>':''}</div><div class="log-message">${esc(l.message)}</div></button>`).join(''):empty('No logs matched. Upload logs from Overview or relax filters.'));if($('prevLogsBtn')) $('prevLogsBtn').disabled=(result.page||1)<=1;if($('nextLogsBtn')) $('nextLogsBtn').disabled=(result.page||1)>=(result.total_pages||1);$$('.log-line[data-log-index]').forEach(btn=>btn.onclick=()=>openLogModal(state.lastLogs[Number(btn.dataset.logIndex)]));}
function openLogModal(log){if(!log)return;state.selectedLog=log;setText('modalTitle',`${log.severity||'LOG'} · ${log.service_name||'Unknown service'}`);$('modalTraceBtn')&&($('modalTraceBtn').disabled=!log.trace_id);setHtml('modalBody',`<div class="modal-grid"><div><small>Timestamp</small><b>${esc(new Date(log.timestamp).toLocaleString())}</b></div><div><small>Service</small><b>${esc(log.service_name||'-')}</b></div><div><small>Endpoint</small><b>${esc((log.method||'')+' '+(log.path||''))}</b></div><div><small>Trace ID</small><b>${esc(log.trace_id||'-')}</b></div><div><small>Severity</small><b>${esc(log.severity||'-')}</b></div></div><h4>Message</h4><pre>${esc(log.message||'')}</pre><h4>Raw event</h4><pre>${esc(JSON.stringify(log.raw||log,null,2))}</pre>`);$('logModal')&&$('logModal').classList.add('open');}
function closeLogModal(){ $('logModal')&&$('logModal').classList.remove('open'); }

async function loadAlertsOps(){try{const a=await api(endpoint('/alerts'));$('alertList').innerHTML=a.length?a.map(x=>`<div class="row"><div><strong>${esc(x.title)}</strong><small>${esc(x.description||'')}</small></div><div><small>Severity</small><b>${esc(x.severity)}</b></div><div><small>Status</small><b>${esc(x.status)}</b></div><div><small>Service</small><b>${esc(x.service_name||'-')}</b></div><div><small>Created</small><b>${new Date(x.created_at).toLocaleDateString()}</b></div></div>`).join(''):empty('No active alerts.');const o=await api(endpoint('/ops'));$('deploymentList').innerHTML=(o.deployments||[]).map(x=>`<div class="insight"><b>${esc(x.version)}</b><p>${esc(x.notes||'')}</p></div>`).join('')||empty('No deployments');$('ingestionList').innerHTML=(o.ingestion||o.ingestion_jobs||[]).map(x=>`<div class="insight"><b>${esc(x.source_type)} · ${esc(x.source_name)}</b><p>${fmt(x.accepted_count)} accepted / ${fmt(x.rejected_count)} rejected</p></div>`).join('')||empty('No ingestion jobs');$('securityList').innerHTML=(o.security||o.security_events||[]).map(x=>`<div class="insight"><b>${esc(x.event_type)}</b><p>${esc(x.message)} (${fmt(x.count)})</p></div>`).join('')||empty('No security events');}catch(e){}}
async function runRca(){setPage('rca');const query=$('rcaQuery').value||'Analyze current environment issues';const data=await api(endpoint('/rca'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});$('rcaContent').innerHTML=`<div class="insight"><h4>${esc(data.likely_root_cause||'Environment RCA')}</h4><p>${esc(data.summary||'No summary')}</p></div>${(data.recommended_actions||data.recommendations||[]).map(r=>`<div class="insight"><b>Action</b><p>${esc(r)}</p></div>`).join('')}`;}

async function clearUploadedLogs(){
  const ok = confirm(`Delete all logs, discovered APIs/endpoints, traces, alerts and ingestion records for ${state.environment}? This is useful after a bad parser upload.`);
  if(!ok) return;
  try{
    const res = await api(endpoint('/logs'), {method:'DELETE'});
    toast(`Deleted ${fmt(res?.deleted||0)} log events from ${state.environment}`,'success');
    await refreshAll();
  }catch(e){toast(e.message,'error');}
}

async function uploadBody(body,name='pasted logs'){
  const headers={'Content-Type':'text/plain','X-File-Name':name};
  setText('uploadStatus',`Uploading ${name}...`); 
  try{
    const start=performance.now();
    const res=await api(endpoint('/logs/upload'),{method:'POST',headers,body});
    const sec=Math.max((performance.now()-start)/1000,.1).toFixed(1);
    toast(`Parsed ${fmt(res.parsed||res.inserted||0)} events, inserted ${fmt(res.inserted||0)} in ${sec}s`,'success');
    setText('uploadStatus',`Upload completed · ${fmt(res.inserted||0)} events · parser: ${esc(res.parser||'auto')} · ${sec}s`);
    if($('logUpload')) $('logUpload').value='';
    await Promise.allSettled([loadOverview(),loadServices(),loadEndpoints(),loadAlertsOps(),searchLogs(1)]);
    toast('Upload complete. Open Log Search to filter or inspect logs.','success');
  }catch(e){setText('uploadStatus','Upload failed');toast(e.message,'error');}
}

function renderEnvButtons(){const host=$('envButtons'); if(!host) return; host.innerHTML=['PROD','UAT','DEV','DR'].map(env=>`<button type="button" class="env-btn ${env===state.environment?'active':''}" data-env="${env}">${env}</button>`).join(''); $$('.env-btn').forEach(b=>b.onclick=()=>{state.environment=b.dataset.env; localStorage.setItem('observex-env',state.environment); refreshAll();});}
function bind(){Object.entries(icons).forEach(([k,v])=>$$(`[data-icon="${k}"]`).forEach(x=>x.innerHTML=v));if($('edgeToggle')) $('edgeToggle').onclick=()=>{state.sidebar=state.sidebar==='closed'?'open':'closed';applySidebar();};if($('themeToggle')) $('themeToggle').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();};$$('[data-page-link]').forEach(a=>a.onclick=(e)=>{e.preventDefault();setPage(a.dataset.pageLink);});if($('searchLogsBtn')) $('searchLogsBtn').onclick=()=>searchLogs(1);if($('prevLogsBtn')) $('prevLogsBtn').onclick=()=>searchLogs(state.logPage-1);if($('nextLogsBtn')) $('nextLogsBtn').onclick=()=>searchLogs(state.logPage+1);if($('clearFiltersBtn')) $('clearFiltersBtn').onclick=()=>{['logQuery','severityFilter','serviceFilter','pathFilter'].forEach(id=>$(id)&&($(id).value=''));state.traceFilter='';searchLogs(1);};if($('clearLogsBtn'))$('clearLogsBtn').onclick=clearUploadedLogs;if($('askRcaBtn')) $('askRcaBtn').onclick=runRca;if($('rcaPageBtn')) $('rcaPageBtn').onclick=runRca;if($('modalClose')) $('modalClose').onclick=closeLogModal;if($('modalTraceBtn')) $('modalTraceBtn').onclick=()=>{const tid=state.selectedLog?.trace_id;if(!tid)return;closeLogModal();state.traceFilter=tid;setPage('logs');$('logQuery').value='';searchLogs(1);toast(`Tracing ${tid}`,'success');};if($('logModal')) $('logModal').onclick=e=>{if(e.target.id==='logModal')closeLogModal();};const dz=$('dropZone'),fi=$('fileInput');if(dz&&fi){dz.onclick=()=>fi.click();['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('dragover');}));['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('dragover');}));dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)uploadBody(f,f.name);});fi.onchange=()=>{if(fi.files[0])uploadBody(fi.files[0],fi.files[0].name);};if($('uploadBtn')) $('uploadBtn').onclick=()=>{const text=($('logUpload')?.value||'').trim();if(!text)return toast('Paste logs or choose a file first','error');uploadBody(text);};}}
async function refreshAll(){$('tenantEnvChip')&&($('tenantEnvChip').textContent=state.environment);renderEnvButtons();await Promise.allSettled([loadOverview(),loadServices(),loadEndpoints(),searchLogs(1),loadAlertsOps()]);}
(async function boot(){applyTheme();applySidebar();bind();await initWorkspaces();setPage(state.page);await refreshAll();})();
