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
async function api(url,opt={}){const r=await fetch(url,opt);let j={};try{j=await r.json();}catch{}if(!r.ok)throw new Error(j.error||`Request failed (${r.status})`);return j.data ?? j;}
function applyTheme(){document.documentElement.classList.toggle('dark',state.theme==='dark');localStorage.setItem('observex-theme',state.theme);$('themeIcon')&&($('themeIcon').textContent=state.theme==='dark'?'☀':'☾');}
function applySidebar(){const closed=state.sidebar==='closed';$('appShell')&&$('appShell').classList.toggle('sidebar-collapsed',closed);localStorage.setItem('observex-sidebar',state.sidebar);}
function setPage(page){
  state.page=(page==='traces'?'logs':(page==='endpoints'?'apis':(page||'overview')));
  $$('.page').forEach(x=>x.classList.toggle('active',x.dataset.page===state.page));
  $$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.pageLink===state.page));
  const titles={
    overview:'Overview',apis:'APIs & Endpoints',logs:'Log Search',
    uploads:'Upload History',alerts:'Alerts',ops:'Ops',rca:'AI RCA',
    apiDocs:'API Docs',topology:'Service Topology',settings:'Settings'
  };
  setText('pageTitle',titles[state.page]||'ObserveX');
  $('topActions')&&$('topActions').classList.toggle('visible',!['logs','settings','topology'].includes(state.page));
  if(location.hash.slice(1)!==state.page)history.replaceState(null,'',`#${state.page}`);
  // Load page-specific data on navigation
  if(state.page==='logs')     { searchLogs(1); loadApisEndpoints(); loadSavedSearches(); loadErrorGroups(); }
  if(state.page==='apis')     { loadApisEndpoints(); }
  if(state.page==='uploads')  { loadUploadHistory(); loadDeployImpact(); }
  if(state.page==='alerts')   { loadAlertsOps(); loadAlertRules(); }
  if(state.page==='ops')      { loadAlertsOps(); }
  if(state.page==='apiDocs')  { renderApiDoc('apiIngest'); }
  if(state.page==='topology') { setTimeout(initTopo,100); }
  if(state.page==='settings') { setTimeout(()=>{initSettings();loadSettingsTab('profile');},50); }
}
function empty(msg){return `<div class="empty">${esc(msg)}</div>`;}
function metric(label,value,sub,tone='neutral'){return `<div class="metric-card ${tone}"><span class="tag"><span class="dot"></span>${esc(label)}</span><h3>${value}</h3><p>${esc(sub)}</p></div>`;}
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
    setText('modalTitle',`Trace waterfall · ${traceId}`);
    const steps=data.waterfall||[];
    setHtml('modalBody', steps.length?`<div class="trace-waterfall">${steps.map(st=>`<div class="trace-step ${esc(st.severity)}"><span class="step-dot"></span><div><b>${esc(st.service_name||'Unknown service')}</b><small>${esc((st.method||'')+' '+(st.path||''))}</small><p>${esc(String(st.message||'').slice(0,180))}</p></div><div><small>+${fmt(st.at_ms)}ms</small><b>${fmtMs(st.latency_ms)}</b></div></div>`).join('')}</div>`:empty('No events found for this trace ID.'));
    $('logModal')&&$('logModal').classList.add('open');
  }catch(e){toast(e.message,'error');}
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
      metric(state.environment,score?score+'%':'--','Calculated health',tone),
      metric('Error rate',`${Number(m.error_rate||0).toFixed(2)}%`,'From ERROR/FATAL logs',Number(m.error_rate)>5?'bad':'good'),
      metric('P95 latency',fmtMs(m.p95_latency_ms),'From traces',Number(m.p95_latency_ms)>1000?'bad':'neutral'),
      metric('Logs',fmt(m.logs_ingested),'Total ingested logs','neutral'),
      metric('Alerts',fmt(m.active_alerts),'Open incidents',Number(m.active_alerts)?'warn':'good')
    ].join(''));
    setText('summaryEnv',`${state.environment} only`);
    setHtml('summaryGrid',[['Services',m.services],['Endpoints',m.endpoints],['Data source',m.logs_ingested?'Live ingestion':'No logs yet'],['Database','Connected'],['Partition',state.environment],['Masking','Policy ready']].map(([k,v])=>`<div class="kv"><small>${k}</small><b>${esc(v)}</b></div>`).join(''));
    setHtml('infraGrid',[['Upload engine','Streaming'],['Recommended path','S3 pre-signed / chunked'],['Search','Filters + FTS'],['Max file','Configurable 500MB+']].map(([k,v])=>`<div class="kv"><small>${k}</small><b>${esc(v)}</b></div>`).join(''));
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
          <div class="api-acc-stats metrics-clean">
            <div class="api-acc-stat trend"><small>7-day volume</small>${sparklineBars(s.volume_7d)}</div>
            <div class="api-acc-stat status-metric"><small>Status</small><b class="status-badge ${esc(s.status||'observed')}"><span class="status-dot"></span>${esc(s.status||'observed')}</b></div>
            <div class="api-acc-stat"><small>Error</small><b style="color:${errColor}">${errRate.toFixed(2)}%</b></div>
            <div class="api-acc-stat"><small>P95</small><b>${fmtMs(s.p95_latency_ms)}</b></div>
            <div class="api-acc-stat"><small>Health</small><b style="color:${health>=80?'var(--good)':health>=50?'var(--warn)':'var(--bad)'}">${health?health+'%':'—'}</b></div>
          </div>
        </button>
        <div class="api-accordion-body"><div class="api-accordion-body-inner"><div class="api-manage-row"><button class="mini-link danger delete-api" data-service="${esc(s.name)}">Delete API</button><span>Manual delete hides this API/endpoint from the selected environment.</span></div>
          ${(s.top_errors&&s.top_errors.length)?`<div class="top-errors-mini"><b>Top errors</b>${s.top_errors.map(e=>`<span>${esc(String(e.signature||'Unknown').slice(0,34))} · ${fmt(e.count)}</span>`).join('')}</div>`:''}${svcEps.length?`<div class="ep-inner-table"><div class="ep-inner-header"><span>Method</span><span>Path</span><span>Status</span><span>Calls</span><span>Error %</span><span>P95</span><span>Action</span></div>${svcEps.map(ep=>{const er=Number(ep.error_rate||0);const meth=(ep.method||'?').toUpperCase();return `<div class="ep-inner-row"><span><span class="method-badge meth-${esc(meth)}">${esc(meth)}</span></span><span class="ep-path">${esc(ep.path||'-')}</span><span><span class="status-badge ${esc(ep.status||'observed')}">${esc(ep.status||'observed')}</span></span><span><b>${fmt(ep.calls_total??ep.calls_per_hour)}</b></span><span><b style="color:${er>5?'var(--bad)':er>1?'var(--warn)':'var(--good)'}">${er.toFixed(2)}%</b></span><span><b>${fmtMs(ep.p95_latency_ms)}</b></span><div class="ep-action-cell"><button class="mini-link endpoint-errors" data-service="${esc(s.name)}" data-path="${esc(ep.path||'')}">Errors →</button><button class="mini-link danger delete-endpoint" data-service="${esc(s.name)}" data-method="${esc(meth)}" data-path="${esc(ep.path||'')}">Delete</button></div></div>`;}).join('')}</div>`:'<div class="ep-inner-empty">No endpoints discovered yet for this API.</div>'}
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
    return `<span class="trace-chip" title="Trace: ${esc(tid)}">⛓ Trace</span>`;
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
  try{ const envs = await api(`/api/${state.workspace}/environments`); state.environments = (envs||[]).map(e=>e.name||e).filter(Boolean); }
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

async function pollIngestionJob(jobId){
  for(let i=0;i<720;i++){
    const job = await api(endpoint(`/ingestion/${jobId}`));
    showIngestProgress(job);
    if(job.status==='completed') return job;
    if(job.status==='failed') throw new Error(job.error || job.meta?.error || 'Ingestion failed. Open Upload History to see details.');
    await new Promise(r=>setTimeout(r, 1000));
  }
  throw new Error('Ingestion is still running. Please check Ops → Ingestion Jobs.');
}

async function uploadBody(body,name='pasted logs'){
  const headers={'Content-Type':'text/plain','X-File-Name':name};
  const isFile = typeof File !== 'undefined' && body instanceof File;
  const size = isFile ? body.size : new Blob([body]).size;
  setText('uploadStatus',`Starting ingestion for ${name}...`);
  showIngestProgress({fileName:name,status:'receiving',stage:'Preparing upload',bytes:size,parsed:0,inserted:0,speed:0});
  try{
    const start=performance.now();
    const startRes=await api(endpoint('/logs/upload-async'),{method:'POST',headers,body});
    showIngestProgress(startRes);
    setText('uploadStatus',`Queued ${name}. Parsing in background...`);
    const job=await pollIngestionJob(startRes.id);
    const sec=Math.max((performance.now()-start)/1000,.1).toFixed(1);
    toast(`Ingested ${fmt(job.inserted||0)} events in ${sec}s`,'success');
    setText('uploadStatus',`Upload completed · ${fmt(job.inserted||0)} events · ${fmt(job.speed||0)} logs/sec · ${sec}s`);
    if($('logUpload')) $('logUpload').value='';
    if($('quickTime')) $('quickTime').value='all';
    await Promise.allSettled([loadOverview(),loadApisEndpoints(),loadAlertsOps(),loadUploadHistory(),searchLogs(1)]);
    toast('Upload complete. Metrics, services, endpoints and search are refreshed.','success');
  }catch(e){setText('uploadStatus','Upload failed');toast(e.message,'error');showIngestProgress({fileName:name,status:'failed',stage:'Failed',bytes:size,parsed:0,inserted:0,speed:0,error:e.message});
    await Promise.allSettled([loadUploadHistory(), loadOverview()]);}
}

function renderEnvButtons(){
  const host=$('envButtons'); if(!host) return;
  const source = state.environments && state.environments.length ? state.environments : ['PROD','UAT','DEV','DR'];
  const envs=[...new Set(source.map(e=>String(e||'').toUpperCase()).filter(Boolean))];
  host.innerHTML=envs.map(env=>`<button type="button" class="env-btn ${env===state.environment?'active':''}" data-env="${esc(env)}">${esc(env)}</button>`).join('');
  if($('environmentList')) $('environmentList').innerHTML=envs.map(env=>`<div class="policy-item editable env-policy-card" data-env-row="${esc(env)}"><div><b>${esc(env)}</b><p>${env===state.environment?'Currently selected environment':'Available environment scope'}</p></div><div class="row-actions env-actions"><button class="mini-link edit-env" data-env="${esc(env)}">Rename</button>${env==='PROD'?'':`<button class="mini-link danger delete-env" data-env="${esc(env)}">Delete</button>`}</div></div>`).join('');
  $$('.edit-env').forEach(b=>b.onclick=()=>renameEnvironment(b.dataset.env));
  $$('.delete-env').forEach(b=>b.onclick=()=>removeEnvironment(b.dataset.env));
  $$('.env-btn').forEach(b=>b.onclick=()=>{state.environment=b.dataset.env; localStorage.setItem('observex-env',state.environment); refreshAll();});
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

function bind(){Object.entries(icons).forEach(([k,v])=>$$(`[data-icon="${k}"]`).forEach(x=>x.innerHTML=v));if($('edgeToggle')) $('edgeToggle').onclick=()=>{state.sidebar=state.sidebar==='closed'?'open':'closed';applySidebar();}; $$('.endpoint-doc').forEach(b=>b.onclick=()=>renderApiDoc(b.dataset.docEndpoint)); if($('sendApiDocBtn')) $('sendApiDocBtn').onclick=sendApiDocRequest; if($('aeSearch')){$('aeSearch').addEventListener('input',e=>{loadApisEndpoints(e.target.value);});};if($('addApiBtn'))$('addApiBtn').onclick=()=>{$('apiRegistryPanel').hidden=!$('apiRegistryPanel').hidden;};if($('saveManualApiBtn'))$('saveManualApiBtn').onclick=createManualApi;if($('themeToggle')) $('themeToggle').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();};$$('[data-page-link]').forEach(a=>a.onclick=(e)=>{e.preventDefault();setPage(a.dataset.pageLink);});if($('serviceFilter')) $('serviceFilter').onchange=()=>{refreshPathFilter(); if($('pathFilter')) $('pathFilter').value=''; loadErrorGroups();}; if($('pathFilter')) $('pathFilter').onchange=loadErrorGroups; if($('quickTime')) $('quickTime').onchange=loadErrorGroups;if($('saveSearchBtn')) $('saveSearchBtn').onclick=saveCurrentSearch;if($('runAnomalyBtn')) $('runAnomalyBtn').onclick=runAnomalyCheck;if($('evaluateAlertsBtn')) $('evaluateAlertsBtn').onclick=evaluateAlertsNow;if($('createRuleBtn')) $('createRuleBtn').onclick=createCustomRule;if($('savePolicyBtn'))$('savePolicyBtn').onclick=saveEnvironmentPolicy;if($('resetPolicyBtn'))$('resetPolicyBtn').onclick=resetEnvironmentPolicy;if($('saveMaskRuleBtn'))$('saveMaskRuleBtn').onclick=saveMaskRule;if($('saveAiProviderBtn'))$('saveAiProviderBtn').onclick=saveAiProvider;if($('createEnvironmentBtn'))$('createEnvironmentBtn').onclick=createCustomEnvironment;if($('createIngestKeyBtn'))$('createIngestKeyBtn').onclick=createIngestKey;if($('testMaskingBtn'))$('testMaskingBtn').onclick=testMasking;if($('searchLogsBtn')) $('searchLogsBtn').onclick=()=>searchLogs(1);if($('prevLogsBtn')) $('prevLogsBtn').onclick=()=>searchLogs(state.logPage-1);if($('nextLogsBtn')) $('nextLogsBtn').onclick=()=>searchLogs(state.logPage+1);if($('clearFiltersBtn')) $('clearFiltersBtn').onclick=()=>{['logQuery','severityFilter','serviceFilter','pathFilter'].forEach(id=>$(id)&&($(id).value=''));if($('quickTime'))$('quickTime').value='all';state.traceFilter='';state.uploadFilter='';searchLogs(1);};if($('clearLogsBtn'))$('clearLogsBtn').onclick=clearUploadedLogs;if($('refreshUploadsBtn'))$('refreshUploadsBtn').onclick=loadUploadHistory;if($('deleteSelectedUploadsBtn'))$('deleteSelectedUploadsBtn').onclick=()=>deleteUploads([...state.uploadSelections]);if($('deleteAllUploadsBtn'))$('deleteAllUploadsBtn').onclick=deleteAllUploads;if($('askRcaBtn')) $('askRcaBtn').onclick=runRca;if($('rcaPageBtn')) $('rcaPageBtn').onclick=runRca;if($('modalClose')) $('modalClose').onclick=closeLogModal;if($('modalTraceBtn')) $('modalTraceBtn').onclick=()=>{const tid=state.selectedLog?.trace_id||state.selectedLog?.raw?.event_id||state.selectedLog?.raw?.correlation_id;if(!tid)return;openTraceDetail(tid);};if($('logModal')) $('logModal').onclick=e=>{if(e.target.id==='logModal')closeLogModal();};const dz=$('dropZone'),fi=$('fileInput');if(dz&&fi){dz.onclick=()=>fi.click();['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('dragover');}));['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('dragover');}));dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)uploadBody(f,f.name);});fi.onchange=()=>{if(fi.files[0])uploadBody(fi.files[0],fi.files[0].name);};if($('uploadBtn')) $('uploadBtn').onclick=()=>{const text=($('logUpload')?.value||'').trim();if(!text)return toast('Paste logs or choose a file first','error');uploadBody(text);};}}
async function refreshAll(){$('tenantEnvChip')&&($('tenantEnvChip').textContent=state.environment);renderEnvButtons();await Promise.allSettled([loadOverview(),loadApisEndpoints(),searchLogs(1),loadAlertsOps(),loadUploadHistory(),loadSavedSearches()]);}
(async function boot(){applyTheme();applySidebar();bind();await initWorkspaces();setPage(state.page);await refreshAll();})();

/* ═══════════════════════════════════════════════════════════
   v36 ADDITIONS — Auth guard, Settings, Topology,
   RBAC, Notifications, Approvals, Delete endpoints, etc.
   ═══════════════════════════════════════════════════════════ */

// ── AUTH GUARD ──
function getSession(){try{return JSON.parse(sessionStorage.getItem('ox_session'));}catch{return null;}}
function guardAuth(){
  const sess=getSession();
  if(!sess){ window.location.href='/login.html'; return false; }
  return sess;
}
function renderUserChip(sess){
  const chip=$('userChip'); if(!chip) return;
  chip.hidden=false;
  const av=$('userAvatar'); if(av) av.textContent=(sess.name||'?')[0].toUpperCase();
  const nm=$('userChipName'); if(nm) nm.textContent=sess.name||sess.email;
  const rl=$('userChipRole'); if(rl) rl.textContent=(sess.role||'viewer').charAt(0).toUpperCase()+(sess.role||'viewer').slice(1);
  chip.onclick=()=>setPage('settings');
}

// ── ICONS EXTENDED ──
const iconsExtra={
  topology:'<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M8.5 17.5l3-4.5 4.5 4.5M5.5 17.5 12 11"/></svg>',
  settings:'<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
};

// ── STORAGE HELPERS ──
function getUsers(){try{return JSON.parse(localStorage.getItem('ox_users')||'[]');}catch{return[];}}
function saveUsers(u){localStorage.setItem('ox_users',JSON.stringify(u));}
function getInviteCodes(){try{return JSON.parse(localStorage.getItem('ox_invite_codes')||'["OX-INIT-2026"]');}catch{return['OX-INIT-2026'];}}
function saveInviteCodes(c){localStorage.setItem('ox_invite_codes',JSON.stringify(c));}
function getNotifChannels(){try{return JSON.parse(localStorage.getItem('ox_notif_channels')||'[]');}catch{return[];}}
function saveNotifChannels(c){localStorage.setItem('ox_notif_channels',JSON.stringify(c));}
function getApprovals(){try{return JSON.parse(localStorage.getItem('ox_approvals')||'[]');}catch{return[];}}
function saveApprovals(a){localStorage.setItem('ox_approvals',JSON.stringify(a));}
function getAuditLog(){try{return JSON.parse(localStorage.getItem('ox_audit_log')||'[]');}catch{return[];}}
function addAuditEntry(action,detail,severity='low'){
  const sess=getSession();
  const log=getAuditLog();
  log.unshift({ts:new Date().toISOString(),actor:sess?.email||'system',action,detail,severity});
  if(log.length>200) log.length=200;
  localStorage.setItem('ox_audit_log',JSON.stringify(log));
}
function getKeyUsage(){try{return JSON.parse(localStorage.getItem('ox_key_usage')||'{}');}catch{return {};}}
function bumpKeyUsage(keyId){const u=getKeyUsage();u[keyId]=(u[keyId]||0)+Math.floor(Math.random()*12+1);localStorage.setItem('ox_key_usage',JSON.stringify(u));}
function getIngestKeys(){try{return JSON.parse(localStorage.getItem('ox_ingest_keys')||'[]');}catch{return[];}}
function saveIngestKeys(k){localStorage.setItem('ox_ingest_keys',JSON.stringify(k));}

// ── SETTINGS TABS ──
function initSettings(){
  $$('[data-stab]').forEach(btn=>{
    btn.onclick=()=>{
      $$('[data-stab]').forEach(b=>b.classList.remove('active'));
      $$('[data-stab-panel]').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      const panel=document.querySelector(`[data-stab-panel="${btn.dataset.stab}"]`);
      if(panel) panel.classList.add('active');
      loadSettingsTab(btn.dataset.stab);
    };
  });
}
function loadSettingsTab(tab){
  if(tab==='profile') loadProfileTab();
  if(tab==='team') loadTeamTab();
  if(tab==='invites') loadInvitesTab();
  if(tab==='apikeys') loadApiKeysTab();
  if(tab==='keyanalytics') loadKeyAnalytics();
  if(tab==='notifications') loadNotificationsTab();
  if(tab==='rbac') loadRbacTab();
  if(tab==='audit') loadAuditTab();
  if(tab==='approvals') loadApprovalsTab();
}

// ── PROFILE ──
async function hashPwd(password){
  const enc=new TextEncoder();
  const buf=await crypto.subtle.digest('SHA-256',enc.encode(password+'observex-salt-2026'));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function loadProfileTab(){
  const sess=getSession(); if(!sess) return;
  const f=id=>$(id); if(!f('profileName')) return;
  f('profileName').value=sess.name||'';
  f('profileEmail').value=sess.email||'';
  f('profileRole').value=(sess.role||'viewer').charAt(0).toUpperCase()+(sess.role||'viewer').slice(1);
  f('profileWorkspace').value=sess.workspace||'';
}
function bindProfileSave(){
  if($('saveProfileBtn')) $('saveProfileBtn').onclick=async()=>{
    const sess=getSession(); if(!sess) return;
    const users=getUsers();
    const idx=users.findIndex(u=>u.email===sess.email);
    if(idx<0) return;
    const newName=($('profileName')?.value||'').trim();
    const oldPwd=$('profileOldPwd')?.value||'';
    const newPwd=$('profileNewPwd')?.value||'';
    if(newPwd){
      if(!oldPwd){ toast('Enter current password to change it','error'); return; }
      const oldHash=await hashPwd(oldPwd);
      if(oldHash!==users[idx].hash){ toast('Current password incorrect','error'); return; }
      users[idx].hash=await hashPwd(newPwd);
    }
    if(newName) users[idx].name=newName;
    saveUsers(users);
    sess.name=users[idx].name;
    sessionStorage.setItem('ox_session',JSON.stringify(sess));
    renderUserChip(sess);
    addAuditEntry('profile.update','User updated profile');
    toast('Profile saved','success');
    if($('profileOldPwd')) $('profileOldPwd').value='';
    if($('profileNewPwd')) $('profileNewPwd').value='';
  };
  if($('logoutBtn')) $('logoutBtn').onclick=()=>{
    sessionStorage.removeItem('ox_session');
    addAuditEntry('auth.logout','User signed out');
    window.location.href='/login.html';
  };
}

// ── TEAM ──
function loadTeamTab(){
  const users=getUsers(); const el=$('teamMemberList'); if(!el) return;
  if(!users.length){el.innerHTML='<div class="empty">No users yet. Create the first account via login.</div>';return;}
  el.innerHTML=users.map(u=>`
    <div class="team-member-row">
      <div class="member-avatar">${(u.name||u.email)[0].toUpperCase()}</div>
      <div><div class="member-name">${esc(u.name||'')}</div><div class="member-email">${esc(u.email)}</div></div>
      <span class="role-badge ${esc(u.role||'viewer')}">${esc(u.role||'viewer')}</span>
      <small style="color:var(--muted)">${new Date(u.createdAt||Date.now()).toLocaleDateString()}</small>
      <button class="secondary" style="padding:6px 10px;font-size:11px" onclick="removeUser('${esc(u.id)}')">Remove</button>
    </div>`).join('');
}
function removeUser(id){
  const sess=getSession();
  if(sess?.uid===id){ toast('Cannot remove yourself','error'); return; }
  if(!confirm('Remove this user?')) return;
  const users=getUsers().filter(u=>u.id!==id);
  saveUsers(users);
  addAuditEntry('team.remove',`Removed user ${id}`,'high');
  loadTeamTab();
  toast('User removed','success');
}

// ── INVITES ──
function loadInvitesTab(){
  const codes=getInviteCodes(); const el=$('inviteCodeList'); if(!el) return;
  if(!codes.length){el.innerHTML='<div class="empty">No active invite codes.</div>';return;}
  el.innerHTML=`<div class="stg-note" style="margin-bottom:12px">Active codes — share with new teammates. Each code is single-use.</div>`+
    codes.map((c,i)=>`
      <div class="invite-code-row">
        <span class="invite-code-val">${esc(c)}</span>
        <span style="font-size:11px;color:var(--muted);font-weight:800">Single-use</span>
        <span class="role-badge member">Member</span>
        <button class="secondary" style="padding:6px 10px;font-size:11px" onclick="navigator.clipboard.writeText('${esc(c)}').then(()=>toast('Copied!','success'))">Copy</button>
        <button class="secondary danger" style="padding:6px 10px;font-size:11px" onclick="revokeInvite('${esc(c)}')">Revoke</button>
      </div>`).join('');
}
function revokeInvite(code){
  const codes=getInviteCodes().filter(c=>c!==code);
  saveInviteCodes(codes);
  addAuditEntry('invite.revoke',`Revoked invite code ${code}`,'med');
  loadInvitesTab();
  toast('Code revoked','success');
}
function bindGenInvite(){
  if($('genInviteBtn')) $('genInviteBtn').onclick=()=>{
    const role=$('inviteRoleSelect')?.value||'member';
    const code=`OX-${Math.random().toString(36).slice(2,6).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    const codes=getInviteCodes();
    codes.push(code);
    saveInviteCodes(codes);
    addAuditEntry('invite.create',`Generated invite code for role: ${role}`, 'med');
    loadInvitesTab();
    toast(`Code: ${code}  (copied)`, 'success');
    navigator.clipboard.writeText(code).catch(()=>{});
  };
}

// ── API KEYS (Settings) ──
function loadApiKeysTab(){
  const keys=getIngestKeys(); const el=$('stgKeyList'); if(!el) return;
  if(!keys.length){el.innerHTML='<div class="empty">No keys yet. Generate one below.</div>';return;}
  el.innerHTML=keys.map(k=>`
    <div class="key-card-stg">
      <div><b>${esc(k.name)}</b><small>${esc(k.id.slice(0,18))}…</small></div>
      <span class="key-scope">${esc(k.env||'PROD')}</span>
      <span class="role-badge ${k.role==='full'?'admin':k.role==='read'?'member':'viewer'}">${esc(k.role||'ingest')}</span>
      <small style="color:var(--muted)">${new Date(k.createdAt||Date.now()).toLocaleDateString()}</small>
      <button class="secondary danger" style="padding:6px 10px;font-size:11px" onclick="deleteLocalIngestKey('${esc(k.id)}')">Delete</button>
    </div>`).join('');
}
function deleteLocalIngestKey(id){
  if(!confirm('Delete this API key? It will stop working immediately.')) return;
  const keys=getIngestKeys().filter(k=>k.id!==id);
  saveIngestKeys(keys);
  addAuditEntry('key.delete',`Deleted API key ${id}`,'high');
  loadApiKeysTab();
  toast('Key deleted','success');
}
function bindStgKeyGen(){
  if($('stgGenKeyBtn')) $('stgGenKeyBtn').onclick=()=>{
    const name=($('stgKeyName')?.value||'').trim();
    if(!name) return toast('Enter a key name','error');
    const env=$('stgKeyEnv')?.value||'PROD';
    const role=$('stgKeyRole')?.value||'ingest';
    const id='ox-'+Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const keys=getIngestKeys();
    keys.push({id,name,env,role,createdAt:Date.now()});
    saveIngestKeys(keys);
    if($('stgKeyOutput')) $('stgKeyOutput').textContent=id;
    if($('stgKeyName')) $('stgKeyName').value='';
    addAuditEntry('key.create',`Created API key: ${name} (${env})`,'med');
    loadApiKeysTab();
    toast('Key generated — copy it now!','success');
  };
}

// ── KEY ANALYTICS ──
function loadKeyAnalytics(){
  const keys=getIngestKeys(); const usage=getKeyUsage();
  // Simulate usage bumps
  keys.forEach(k=>{ if(!usage[k.id]) usage[k.id]=Math.floor(Math.random()*5000+100); });
  const chartEl=$('keyAnalyticsChart'); const tableEl=$('keyAnalyticsTable');
  if(!chartEl||!tableEl) return;
  if(!keys.length){chartEl.innerHTML='<div class="empty">No keys to analyze.</div>';tableEl.innerHTML='';return;}
  const max=Math.max(1,...keys.map(k=>usage[k.id]||0));
  chartEl.innerHTML=`<div class="key-usage-bar-wrap">${keys.map(k=>`
    <div class="key-usage-row">
      <label title="${esc(k.name)}">${esc(k.name)}</label>
      <div class="key-bar-track"><div class="key-bar-fill" style="width:${Math.round(((usage[k.id]||0)/max)*100)}%"></div></div>
      <span class="key-usage-count">${fmt(usage[k.id]||0)}</span>
    </div>`).join('')}</div>`;
  tableEl.innerHTML=`<table class="rbac-table"><thead><tr><th>Key Name</th><th>Env</th><th>Role</th><th>Total Calls</th><th>Last 24h</th><th>Created</th></tr></thead><tbody>${
    keys.map(k=>`<tr><td class="rbac-feature-name">${esc(k.name)}</td><td><span class="key-scope">${esc(k.env||'PROD')}</span></td><td><span class="role-badge ${k.role==='full'?'admin':'member'}">${esc(k.role||'ingest')}</span></td><td><b>${fmt(usage[k.id]||0)}</b></td><td>${fmt(Math.floor((usage[k.id]||0)*0.12))}</td><td>${new Date(k.createdAt||Date.now()).toLocaleDateString()}</td></tr>`).join('')
  }</tbody></table>`;
}

// ── NOTIFICATIONS ──
const notifIcons={slack:'🔔',email:'📧',pagerduty:'🚨',webhook:'🔗',teams:'💬'};
function renderNotifFields(){
  const type=$('notifType')?.value||'slack'; const el=$('notifFields'); if(!el) return;
  const fields={
    slack:`<input class="notif-url-input" id="notifUrl" placeholder="https://hooks.slack.com/services/..."/>`,
    email:`<input class="notif-url-input" id="notifUrl" placeholder="alerts@yourcompany.com"/>`,
    pagerduty:`<input class="notif-url-input" id="notifUrl" placeholder="PagerDuty integration key"/>`,
    webhook:`<input class="notif-url-input" id="notifUrl" placeholder="https://your-endpoint.com/hook"/>`,
    teams:`<input class="notif-url-input" id="notifUrl" placeholder="https://outlook.office.com/webhook/..."/>`
  };
  el.innerHTML=fields[type]||'';
}
function loadNotificationsTab(){
  const channels=getNotifChannels(); const el=$('notifChannelGrid'); if(!el) return;
  renderNotifFields();
  if(!channels.length){
    el.innerHTML='<div class="empty" style="grid-column:1/-1">No channels yet. Add one below.</div>';
  } else {
    el.innerHTML=channels.map(c=>`
      <div class="notif-card">
        <div class="notif-status ${c.active?'active':'inactive'}"></div>
        <div class="notif-card-head"><span class="notif-icon">${notifIcons[c.type]||'🔔'}</span><div><div class="notif-card-name">${esc(c.name)}</div><div class="notif-card-type">${esc(c.type)}</div></div></div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.url||'')}</div>
        <div style="display:flex;gap:6px"><button class="secondary" style="padding:5px 10px;font-size:11px" onclick="testNotifChannel('${esc(c.id)}')">Test</button><button class="secondary danger" style="padding:5px 10px;font-size:11px" onclick="deleteNotifChannel('${esc(c.id)}')">Delete</button></div>
      </div>`).join('');
  }
}
function bindNotifSave(){
  if($('saveNotifBtn')) $('saveNotifBtn').onclick=()=>{
    const type=$('notifType')?.value||'slack';
    const name=($('notifName')?.value||'').trim()||`${type} channel`;
    const url=($('notifUrl')?.value||'').trim();
    if(!url) return toast('Enter webhook URL / email','error');
    const channels=getNotifChannels();
    channels.push({id:'nc-'+Date.now(),name,type,url,active:true,createdAt:Date.now()});
    saveNotifChannels(channels);
    addAuditEntry('notif.add',`Added ${type} notification channel: ${name}`,'low');
    loadNotificationsTab();
    toast('Channel saved','success');
    if($('notifName')) $('notifName').value='';
  };
}
function deleteNotifChannel(id){
  const channels=getNotifChannels().filter(c=>c.id!==id);
  saveNotifChannels(channels);
  addAuditEntry('notif.delete',`Deleted notification channel ${id}`,'med');
  loadNotificationsTab();
  toast('Channel removed','success');
}
function testNotifChannel(id){
  const c=getNotifChannels().find(x=>x.id===id);
  if(!c) return;
  toast(`Test ping sent to ${c.name} (${c.type})`, 'success');
  addAuditEntry('notif.test',`Tested channel: ${c.name}`,'low');
}

// ── RBAC ──
const RBAC_MATRIX=[
  {feature:'View logs',cat:'Observability',admin:true,member:true,viewer:true},
  {feature:'Search & filter logs',cat:'Observability',admin:true,member:true,viewer:true},
  {feature:'Upload logs',cat:'Observability',admin:true,member:true,viewer:false},
  {feature:'Delete logs',cat:'Observability',admin:true,member:false,viewer:false},
  {feature:'View APIs & Endpoints',cat:'API Catalog',admin:true,member:true,viewer:true},
  {feature:'Add / delete APIs',cat:'API Catalog',admin:true,member:true,viewer:false},
  {feature:'View alerts',cat:'Alerts',admin:true,member:true,viewer:true},
  {feature:'Create / edit rules',cat:'Alerts',admin:true,member:true,viewer:false},
  {feature:'Manage notification channels',cat:'Alerts',admin:true,member:false,viewer:false},
  {feature:'Manage Ops policies',cat:'Ops',admin:true,member:false,viewer:false},
  {feature:'Manage PII masking',cat:'Ops',admin:true,member:false,viewer:false},
  {feature:'Manage AI RCA provider',cat:'Ops',admin:true,member:false,viewer:false},
  {feature:'Generate API keys',cat:'Keys',admin:true,member:false,viewer:false},
  {feature:'View key analytics',cat:'Keys',admin:true,member:true,viewer:false},
  {feature:'Manage team members',cat:'Settings',admin:true,member:false,viewer:false},
  {feature:'Generate invite codes',cat:'Settings',admin:true,member:false,viewer:false},
  {feature:'Approve changes',cat:'Settings',admin:true,member:false,viewer:false},
];
function loadRbacTab(){
  const el=$('rbacMatrix'); if(!el) return;
  let rows=''; let lastCat='';
  RBAC_MATRIX.forEach(r=>{
    if(r.cat!==lastCat){rows+=`<tr><td colspan="4" style="padding:10px 14px 4px"><span class="rbac-cat">${esc(r.cat)}</span></td></tr>`;lastCat=r.cat;}
    rows+=`<tr><td class="rbac-feature-name" style="padding-left:24px">${esc(r.feature)}</td><td class="rbac-check ${r.admin?'yes':'no'}"></td><td class="rbac-check ${r.member?'yes':'no'}"></td><td class="rbac-check ${r.viewer?'yes':'no'}"></td></tr>`;
  });
  el.innerHTML=`<table class="rbac-table"><thead><tr><th>Feature</th><th>Admin</th><th>Member</th><th>Viewer</th></tr></thead><tbody>${rows}</tbody></table>`;
  // Populate assign role selects
  const users=getUsers();
  const sel=$('rbacUserSelect'); if(sel){sel.innerHTML=users.map(u=>`<option value="${esc(u.id)}">${esc(u.name||u.email)}</option>`).join('');}
}
function bindRbacAssign(){
  if($('assignRoleBtn')) $('assignRoleBtn').onclick=()=>{
    const uid=$('rbacUserSelect')?.value; const role=$('rbacNewRole')?.value;
    if(!uid||!role) return;
    const users=getUsers(); const idx=users.findIndex(u=>u.id===uid);
    if(idx<0) return;
    const sess=getSession();
    if(sess?.uid===uid&&role!=='admin'&&sess?.role==='admin'){ toast("Can't remove your own admin role",'error'); return; }
    users[idx].role=role;
    saveUsers(users);
    addAuditEntry('rbac.assign',`Changed ${users[idx].email} role to ${role}`,'high');
    toast(`Role updated to ${role}`,'success');
    loadRbacTab();
  };
}

// ── AUDIT TAB ──
function loadAuditTab(){
  const log=getAuditLog(); const el=$('settingsAuditLog'); if(!el) return;
  if(!log.length){el.innerHTML='<div class="empty">No audit events yet.</div>';return;}
  el.innerHTML=`<div class="stg-card" style="padding:0;overflow:hidden">${
    log.slice(0,50).map(e=>`
      <div class="audit-entry">
        <span class="audit-ts">${new Date(e.ts).toLocaleTimeString()}</span>
        <span class="audit-actor">${esc((e.actor||'system').split('@')[0])}</span>
        <span class="audit-action">${esc(e.action)} <span style="color:var(--muted);font-weight:600">${esc(e.detail||'')}</span></span>
        <span class="audit-severity ${e.severity==='high'?'high':e.severity==='med'?'med':'low'}">${esc(e.severity||'low')}</span>
      </div>`).join('')
  }</div>`;
}

// ── APPROVALS ──
function loadApprovalsTab(){
  const approvals=getApprovals();
  const pending=approvals.filter(a=>a.status==='pending');
  const history=approvals.filter(a=>a.status!=='pending');
  const pel=$('approvalPending'); const hel=$('approvalHistoryList');
  if(pel){
    if(!pending.length){pel.innerHTML='<div class="empty">No pending approvals.</div>';}
    else{pel.innerHTML=pending.map(a=>`
      <div class="approval-card">
        <div class="approval-head">
          <div><div class="approval-title">${esc(a.title)}</div></div>
          <span class="approval-status-chip pending">Pending</span>
        </div>
        <div class="approval-meta">Requested by <b>${esc(a.requestedBy)}</b> · ${new Date(a.ts).toLocaleDateString()}</div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:12px">${esc(a.description)}</p>
        <div class="approval-actions">
          <button class="approve-btn" onclick="resolveApproval('${esc(a.id)}','approved')">✓ Approve</button>
          <button class="reject-btn" onclick="resolveApproval('${esc(a.id)}','rejected')">✕ Reject</button>
        </div>
      </div>`).join('');}
  }
  if(hel){
    if(!history.length){hel.innerHTML='<div class="empty">No approval history.</div>';}
    else{hel.innerHTML=history.map(a=>`
      <div class="approval-card" style="border-color:var(--line);background:transparent;opacity:.8">
        <div class="approval-head">
          <div class="approval-title">${esc(a.title)}</div>
          <span class="approval-status-chip ${a.status}">${esc(a.status)}</span>
        </div>
        <div class="approval-meta">${esc(a.requestedBy)} · ${new Date(a.ts).toLocaleDateString()} · ${a.status==='approved'?`Approved by ${esc(a.resolvedBy||'Admin')}`:`Rejected`}</div>
      </div>`).join('');}
  }
}
function resolveApproval(id,status){
  const sess=getSession();
  const approvals=getApprovals();
  const idx=approvals.findIndex(a=>a.id===id);
  if(idx<0) return;
  approvals[idx].status=status;
  approvals[idx].resolvedBy=sess?.name||sess?.email||'Admin';
  approvals[idx].resolvedAt=Date.now();
  saveApprovals(approvals);
  addAuditEntry(`approval.${status}`,`${status} approval: ${approvals[idx].title}`,'high');
  loadApprovalsTab();
  toast(`Approval ${status}`, status==='approved'?'success':'error');
}
function createApproval(title,description){
  const sess=getSession();
  const approvals=getApprovals();
  approvals.unshift({id:'appr-'+Date.now(),title,description,status:'pending',requestedBy:sess?.email||'system',ts:Date.now()});
  saveApprovals(approvals);
  addAuditEntry('approval.create',`Created approval request: ${title}`,'med');
  toast('Approval request created','success');
}

// ── TOPOLOGY ──
let topoNodes=[],topoEdges=[],topoAnimFrame=null,topoSelected=null;
const topoColors={healthy:'#10b981',degraded:'#f59e0b',down:'#f43f5e',unknown:'#6b7280'};

async function loadTopologyData(){
  const payload=await api(endpoint('/topology'));
  const nodes=(payload.nodes||[]).map((n,i)=>({
    id:n.id||n.service_name||`svc-${i}`,
    label:n.label||n.service_name||'Unknown service',
    status:n.status||'healthy',
    calls:Number(n.calls||0),
    errorRate:Number(n.error_rate||0),
    p95:Number(n.p95_latency_ms||0),
    successRate:Number(n.success_rate||100),
    x:0,y:0,vx:0,vy:0
  }));
  const edges=(payload.edges||[]).map(e=>({
    from:e.from,
    to:e.to,
    weight:Math.max(1,Math.min(6,Math.round(Number(e.calls||1)/10)+1)),
    error:false,
    calls:Number(e.calls||0),
    avgLatency:Number(e.avg_latency_ms||0),
    p95:Number(e.p95_latency_ms||0),
    flowName:e.flow_name||'',
    path:e.path||''
  })).filter(e=>e.from&&e.to&&e.from!==e.to);
  topoNodes=nodes; topoEdges=edges;
}

async function buildTopoFromLogs(){
  try{
    await loadTopologyData();
    setText('topoSourceText', topoEdges.length ? 'Successful Flow Analytics data' : 'No successful flow data yet');
  }catch(e){
    topoNodes=[]; topoEdges=[];
    toast(`Topology unavailable: ${e.message}`,'error');
  }
}
function layoutTopo(canvas){
  const W=canvas.width,H=canvas.height;
  const n=topoNodes.length; if(!n) return;
  // Circular layout as starting point
  topoNodes.forEach((node,i)=>{
    const angle=(2*Math.PI*i/n)-Math.PI/2;
    const r=Math.min(W,H)*0.34;
    node.x=W/2+r*Math.cos(angle);
    node.y=H/2+r*Math.sin(angle);
    if(n<=1){node.x=W/2;node.y=H/2;}
  });
  // Override first node to center (gateway pattern)
  if(n>=3){topoNodes[0].x=W/2;topoNodes[0].y=H/2;}
}

function drawTopo(){
  const canvas=$('topoCanvas'); if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  const rect=canvas.getBoundingClientRect();
  if(canvas.width!==rect.width*dpr||canvas.height!==rect.height*dpr){
    canvas.width=rect.width*dpr; canvas.height=rect.height*dpr;
    ctx.scale(dpr,dpr);
    layoutTopo(canvas);
  }
  const W=rect.width,H=rect.height;
  ctx.clearRect(0,0,W,H);
  const isDark=document.documentElement.classList.contains('dark');
  // Edges
  topoEdges.forEach(e=>{
    const from=topoNodes.find(n=>n.id===e.from);
    const to=topoNodes.find(n=>n.id===e.to);
    if(!from||!to) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(from.x,from.y);
    // Bezier curve
    const mx=(from.x+to.x)/2,my=(from.y+to.y)/2-30;
    ctx.quadraticCurveTo(mx,my,to.x,to.y);
    const grad=ctx.createLinearGradient(from.x,from.y,to.x,to.y);
    if(e.error){grad.addColorStop(0,'rgba(244,63,94,.6)');grad.addColorStop(1,'rgba(239,68,68,.9)');}
    else{grad.addColorStop(0,'rgba(59,130,246,.5)');grad.addColorStop(1,'rgba(6,182,212,.7)');}
    ctx.strokeStyle=grad;
    ctx.lineWidth=e.weight||1;
    ctx.setLineDash(e.error?[6,4]:[]);
    ctx.stroke();
    // Arrow
    const dx=to.x-mx,dy=to.y-my;
    const angle=Math.atan2(dy,dx);
    const ax=to.x-18*Math.cos(angle),ay=to.y-18*Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(ax,ay);
    ctx.lineTo(ax-8*Math.cos(angle-0.4),ay-8*Math.sin(angle-0.4));
    ctx.lineTo(ax-8*Math.cos(angle+0.4),ay-8*Math.sin(angle+0.4));
    ctx.closePath();
    ctx.fillStyle=e.error?'#f43f5e':'#60a5fa';
    ctx.fill();
    ctx.restore();
  });
  // Nodes
  topoNodes.forEach(node=>{
    const color=topoColors[node.status]||topoColors.unknown;
    const isSelected=topoSelected===node.id;
    const r=isSelected?28:22;
    ctx.save();
    // Shadow
    ctx.shadowColor=color; ctx.shadowBlur=isSelected?24:12;
    // Node circle
    ctx.beginPath();
    ctx.arc(node.x,node.y,r,0,Math.PI*2);
    const grad2=ctx.createRadialGradient(node.x-6,node.y-6,2,node.x,node.y,r);
    grad2.addColorStop(0,isDark?'#1e3a5f':'#dbeafe');
    grad2.addColorStop(1,isDark?'#0d1b2e':'#f0f9ff');
    ctx.fillStyle=grad2;
    ctx.fill();
    ctx.strokeStyle=color;
    ctx.lineWidth=isSelected?3:2;
    ctx.stroke();
    ctx.shadowBlur=0;
    // Status dot
    ctx.beginPath();
    ctx.arc(node.x+r*0.65,node.y-r*0.65,5,0,Math.PI*2);
    ctx.fillStyle=color;
    ctx.fill();
    // Label
    ctx.fillStyle=isDark?'#c7d9f5':'#1e3a5f';
    ctx.font=`bold ${isSelected?13:11}px DM Sans,system-ui`;
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    const short=node.label.slice(0,12);
    ctx.fillText(short,node.x,node.y);
    // Below: error rate
    if(node.errorRate>0){
      ctx.fillStyle=color;
      ctx.font=`800 9px DM Sans,system-ui`;
      ctx.fillText(`${node.errorRate.toFixed(1)}% err`,node.x,node.y+r+12);
    }
    ctx.restore();
  });
}

async function initTopo(){
  const canvas=$('topoCanvas'); if(!canvas) return;
  await buildTopoFromLogs();
  layoutTopo(canvas);
  drawTopo();
  canvas.onclick=e=>{
    const rect=canvas.getBoundingClientRect();
    const x=e.clientX-rect.left,y=e.clientY-rect.top;
    const hit=topoNodes.find(n=>Math.hypot(n.x-x,n.y-y)<28);
    if(hit){
      topoSelected=hit.id;
      showTopoDetail(hit);
    } else {
      topoSelected=null;
      if($('topoDetail')) $('topoDetail').hidden=true;
    }
    drawTopo();
  };
  // Dependency matrix
  renderDepMatrix();
  renderCriticalPaths();
  if($('refreshTopoBtn')) $('refreshTopoBtn').onclick=async()=>{await buildTopoFromLogs();layoutTopo(canvas);drawTopo();renderDepMatrix();renderCriticalPaths();};
  window.addEventListener('resize',()=>{const c=$('topoCanvas');if(c){c.width=0;drawTopo();}});
}
function showTopoDetail(node){
  const el=$('topoDetail'); if(!el) return;
  el.hidden=false;
  if($('topoDetailName')) $('topoDetailName').textContent=node.label;
  const downstream=topoEdges.filter(e=>e.from===node.id).map(e=>topoNodes.find(n=>n.id===e.to)?.label).filter(Boolean);
  const upstream=topoEdges.filter(e=>e.to===node.id).map(e=>topoNodes.find(n=>n.id===e.from)?.label).filter(Boolean);
  if($('topoDetailBody')) $('topoDetailBody').innerHTML=`
    <div class="topo-kv-grid">
      <div class="topo-kv"><small>Status</small><b style="color:${topoColors[node.status]||'#6b7280'}">${node.status}</b></div>
      <div class="topo-kv"><small>Error Rate</small><b>${node.errorRate.toFixed(2)}%</b></div>
      <div class="topo-kv"><small>P95 Latency</small><b>${node.p95||0}ms</b></div>
      <div class="topo-kv"><small>Total Calls</small><b>${fmt(node.calls)}</b></div>
    </div>
    <div style="margin-top:12px;font-size:13px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><div style="font-weight:900;margin-bottom:6px;font-size:11px;color:var(--muted);text-transform:uppercase">Upstream</div>${upstream.map(s=>`<div style="padding:5px 8px;border:1px solid var(--line);border-radius:8px;font-size:12px;margin-bottom:4px">${esc(s)}</div>`).join('')||'<div style="color:var(--muted);font-size:12px">None</div>'}</div>
      <div><div style="font-weight:900;margin-bottom:6px;font-size:11px;color:var(--muted);text-transform:uppercase">Downstream</div>${downstream.map(s=>`<div style="padding:5px 8px;border:1px solid var(--line);border-radius:8px;font-size:12px;margin-bottom:4px">${esc(s)}</div>`).join('')||'<div style="color:var(--muted);font-size:12px">None</div>'}</div>
    </div>`;
}
function renderDepMatrix(){
  const el=$('depMatrix'); if(!el) return;
  if(!topoEdges.length){el.innerHTML='<div class="empty">No successful dependency data yet. Upload logs with trace IDs / FlowName / HTTP 2xx events to build the map.</div>';return;}
  el.innerHTML=topoEdges.map(e=>{
    const from=topoNodes.find(n=>n.id===e.from);
    const to=topoNodes.find(n=>n.id===e.to);
    if(!from||!to) return '';
    return `<div class="dep-item"><span style="color:var(--muted)">${esc(from.label)}</span><span class="dep-arrow">→</span><span style="color:var(--text)">${esc(to.label)}</span><span class="level INFO" style="font-size:10px">${fmt(e.calls)} calls</span></div>`;
  }).join('');
}
function renderCriticalPaths(){
  const el=$('criticalPaths'); if(!el) return;
  if(!topoNodes.length){el.innerHTML='<div class="empty">No data yet.</div>';return;}
  const paths=[...topoEdges].sort((a,b)=>(b.avgLatency||0)-(a.avgLatency||0)).slice(0,5);
  if(!paths.length){el.innerHTML='<div class="empty">No successful request chains detected yet.</div>';return;}
  el.innerHTML=paths.map(e=>{const from=topoNodes.find(n=>n.id===e.from);const to=topoNodes.find(n=>n.id===e.to);return `
    <div class="critical-path-item">
      <div><code>${esc(from?.label||e.from)} → ${esc(to?.label||e.to)}</code><div style="font-size:11px;color:var(--muted);margin-top:3px">${esc(e.flowName||e.path||'successful flow')}</div></div>
      <div class="cp-latency">${fmtMs(e.avgLatency)}</div>
    </div>`}).join('');
}

// ── EXTENDED NAV ICONS ──
function hookNewPageNav(){
  Object.entries(iconsExtra).forEach(([k,v])=>{
    $$(`[data-icon="${k}"]`).forEach(x=>{ if(!x.innerHTML.trim()) x.innerHTML=v; });
  });
}

// ── v36 BOOT ──
(async function v36Boot(){
  // Auth guard — redirect to login if no session
  const sess=guardAuth(); if(!sess) return;
  renderUserChip(sess);

  // Inject extended icons after original bind() has run
  setTimeout(()=>{
    Object.assign(icons, iconsExtra);
    Object.entries(iconsExtra).forEach(([k,v])=>$$(`[data-icon="${k}"]`).forEach(x=>x.innerHTML=v));
    hookNewPageNav();
    bindProfileSave();
    bindGenInvite();
    bindStgKeyGen();
    bindNotifSave();
    bindRbacAssign();
    renderNotifFields();
  }, 200);

  // Seed demo approvals
  if(!getApprovals().length){
    localStorage.setItem('ox_approvals',JSON.stringify([
      {id:'appr-demo-1',title:'Enable AI RCA with OpenAI',description:'Switch RCA provider from Local to OpenAI GPT-4o for better analysis quality.',status:'pending',requestedBy:'admin@observex.io',ts:Date.now()-3600000},
      {id:'appr-demo-2',title:'Delete STAGING environment logs (30d+)',description:'Remove logs older than 30 days from STAGING to reduce storage costs.',status:'approved',requestedBy:'admin@observex.io',resolvedBy:'Admin',resolvedAt:Date.now()-1800000,ts:Date.now()-7200000},
      {id:'appr-demo-3',title:'Add PagerDuty notification channel',description:'Connect PagerDuty integration key for P1 alert escalation.',status:'pending',requestedBy:'ops@observex.io',ts:Date.now()-900000},
    ]));
  }
  // Seed audit trail
  if(!getAuditLog().length){
    addAuditEntry('auth.login','User signed in via session','low');
    addAuditEntry('env.select','Environment set to PROD','low');
    addAuditEntry('key.create','Generated ingestion API key: MuleSoft PROD','med');
  }
  // Seed demo users if empty
  const users=getUsers();
  if(!users.length){
    const hash=await (async()=>{const e=new TextEncoder();const b=await crypto.subtle.digest('SHA-256',e.encode('demo1234observex-salt-2026'));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');})();
    saveUsers([{id:'demo-001',email:'admin@observex.io',name:'Demo Admin',role:'admin',workspace:'fsbl-prod-ops',createdAt:Date.now()-86400000*7,hash}]);
  }
  // Seed demo ingest key
  if(!getIngestKeys().length){
    saveIngestKeys([{id:'ox-demo-key-001-fsbl',name:'MuleSoft PROD',env:'PROD',role:'ingest',createdAt:Date.now()-86400000*3}]);
    const usage=getKeyUsage(); usage['ox-demo-key-001-fsbl']=4823; localStorage.setItem('ox_key_usage',JSON.stringify(usage));
  }
  // Seed demo notification channel
  if(!getNotifChannels().length){
    saveNotifChannels([{id:'nc-demo-1',name:'Ops Slack',type:'slack',url:'https://hooks.slack.com/services/demo',active:true,createdAt:Date.now()-86400000}]);
  }
})();
