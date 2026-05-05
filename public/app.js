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
  aeQuery: ''
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
function toast(msg, type='info'){const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=msg;($('toastHost')||document.body).appendChild(t);setTimeout(()=>t.remove(),4200);}
function endpoint(path){return `/api/${state.workspace}/${state.environment}${path}`;}
async function api(url,opt={}){const r=await fetch(url,opt);let j={};try{j=await r.json();}catch{}if(!r.ok)throw new Error(j.error||`Request failed (${r.status})`);return j.data ?? j;}
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
  if(state.page==='logs')    { searchLogs(1); loadApisEndpoints(); }
  if(state.page==='apis')    { loadApisEndpoints(); }
  if(state.page==='uploads') { loadUploadHistory(); }
}
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
async function loadApisEndpoints(q){
  q = (q !== undefined ? q : state.aeQuery || '').toLowerCase().trim();
  state.aeQuery = q;
  try {
    const [services, endpoints] = await Promise.all([
      api(endpoint('/services')),
      api(endpoint('/endpoints'))
    ]);
    const sf=$('serviceFilter');
    if(sf){ const cur=sf.value; sf.innerHTML='<option value="">All APIs / services</option>'+services.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join(''); if([...sf.options].some(o=>o.value===cur))sf.value=cur; }
    const pf=$('pathFilter');
    if(pf){ const cur=pf.value; const seen=new Set(); pf.innerHTML='<option value="">All endpoints</option>'+endpoints.filter(e=>e.path&&!seen.has(e.path)&&seen.add(e.path)).map(e=>`<option value="${esc(e.path)}">${esc((e.method||'')+' '+e.path)} · ${esc(e.service_name||'')}</option>`).join(''); if([...pf.options].some(o=>o.value===cur))pf.value=cur; }
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
            <div class="api-acc-name"><strong>${esc(s.name)}</strong><small>${svcEps.length} endpoint${svcEps.length!==1?'s':''} · Auto-discovered · ${esc(s.owner||'Unowned')}</small></div>
          </div>
          <div class="api-acc-stats">
            <div class="api-acc-stat"><small>Status</small><b class="status-badge ${esc(s.status||'observed')}">${esc(s.status||'observed')}</b></div>
            <div class="api-acc-stat"><small>Error rate</small><b style="color:${errColor}">${errRate.toFixed(2)}%</b></div>
            <div class="api-acc-stat"><small>P95</small><b>${fmt(s.p95_latency_ms)}ms</b></div>
            <div class="api-acc-stat"><small>Health</small><b style="color:${health>=80?'var(--good)':health>=50?'var(--warn)':'var(--bad)'}">${health?health+'%':'—'}</b></div>
          </div>
        </button>
        <div class="api-accordion-body"><div class="api-accordion-body-inner">
          ${svcEps.length?`<div class="ep-inner-table"><div class="ep-inner-header"><span>Method</span><span>Path</span><span>Status</span><span>Calls</span><span>Error %</span><span>P95</span></div>${svcEps.map(ep=>{const er=Number(ep.error_rate||0);const meth=(ep.method||'?').toUpperCase();return `<div class="ep-inner-row"><span><span class="method-badge meth-${esc(meth)}">${esc(meth)}</span></span><span class="ep-path">${esc(ep.path||'-')}</span><span><span class="status-badge ${esc(ep.status||'observed')}">${esc(ep.status||'observed')}</span></span><span><b>${fmt(ep.calls_total??ep.calls_per_hour)}</b></span><span><b style="color:${er>5?'var(--bad)':er>1?'var(--warn)':'var(--good)'}">${er.toFixed(2)}%</b></span><span><b>${fmt(ep.p95_latency_ms)}ms</b></span></div>`;}).join('')}</div>`:'<div class="ep-inner-empty">No endpoints discovered yet for this API.</div>'}
        </div>
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
  } catch(e){toast('APIs & Endpoints: '+e.message,'error');}
}
}
async function loadTraces(){const rows=await api(endpoint('/traces'));$('traceList').innerHTML=rows.length?rows.map(t=>`<div class="row"><div><strong>${esc(t.trace_id)}</strong><small>${esc(t.service_name||'service unknown')} ${esc(t.method||'')} ${esc(t.path||'')}</small></div><div><small>Status</small><b>${esc(t.status)}</b></div><div><small>Latency</small><b>${fmt(t.latency_ms)}ms</b></div><div><small>Started</small><b>${new Date(t.started_at).toLocaleString()}</b></div><div><small>Env</small><b>${state.environment}</b></div></div>`).join(''):empty('No traces yet. Logs with trace_id are searchable; trace waterfall needs trace ingestion.');}

function logParams(page=state.logPage){return new URLSearchParams({limit:String(state.logPageSize),page:String(page),q:$('logQuery')?.value||'',severity:$('severityFilter')?.value||'',service:$('serviceFilter')?.value||'',path:$('pathFilter')?.value||'',trace_id:state.traceFilter||'',upload_id:state.uploadFilter||'',range:$('quickTime')?.value||'all'});}
async function searchLogs(page=state.logPage){
  state.logPage=Math.max(page,1);
  const result=await api(endpoint('/logs?'+logParams(state.logPage)));
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
    const m=String(raw?.original||'').match(/(?:took|latency|duration|elapsed|response[_-]?time)\s*[:=]?\s*(\d+)\s*ms/i);
    if(!m) return '';
    const ms=Number(m[1]);
    const color=ms>2000?'#ff4d6d':ms>500?'#f77f00':'#2dc653';
    return `<span class="latency-badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${ms}ms</span>`;
  }
  function httpBadge(raw){
    const p=raw?.payload; const st=p?.exit?.HttpStatus||p?.statusCode||p?.status;
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

function renderEnvButtons(){const host=$('envButtons'); if(!host) return; host.innerHTML=['PROD','UAT','DEV','DR'].map(env=>`<button type="button" class="env-btn ${env===state.environment?'active':''}" data-env="${env}">${env}</button>`).join(''); $$('.env-btn').forEach(b=>b.onclick=()=>{state.environment=b.dataset.env; localStorage.setItem('observex-env',state.environment); refreshAll();});}
function bind(){Object.entries(icons).forEach(([k,v])=>$$(`[data-icon="${k}"]`).forEach(x=>x.innerHTML=v));if($('edgeToggle')) $('edgeToggle').onclick=()=>{state.sidebar=state.sidebar==='closed'?'open':'closed';applySidebar();}; if($('aeSearch')){$('aeSearch').addEventListener('input',e=>{loadApisEndpoints(e.target.value);});};if($('themeToggle')) $('themeToggle').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();};$$('[data-page-link]').forEach(a=>a.onclick=(e)=>{e.preventDefault();setPage(a.dataset.pageLink);});if($('searchLogsBtn')) $('searchLogsBtn').onclick=()=>searchLogs(1);if($('prevLogsBtn')) $('prevLogsBtn').onclick=()=>searchLogs(state.logPage-1);if($('nextLogsBtn')) $('nextLogsBtn').onclick=()=>searchLogs(state.logPage+1);if($('clearFiltersBtn')) $('clearFiltersBtn').onclick=()=>{['logQuery','severityFilter','serviceFilter','pathFilter'].forEach(id=>$(id)&&($(id).value=''));if($('quickTime'))$('quickTime').value='all';state.traceFilter='';state.uploadFilter='';searchLogs(1);};if($('clearLogsBtn'))$('clearLogsBtn').onclick=clearUploadedLogs;if($('refreshUploadsBtn'))$('refreshUploadsBtn').onclick=loadUploadHistory;if($('deleteSelectedUploadsBtn'))$('deleteSelectedUploadsBtn').onclick=()=>deleteUploads([...state.uploadSelections]);if($('deleteAllUploadsBtn'))$('deleteAllUploadsBtn').onclick=deleteAllUploads;if($('askRcaBtn')) $('askRcaBtn').onclick=runRca;if($('rcaPageBtn')) $('rcaPageBtn').onclick=runRca;if($('modalClose')) $('modalClose').onclick=closeLogModal;if($('modalTraceBtn')) $('modalTraceBtn').onclick=()=>{const tid=state.selectedLog?.trace_id||state.selectedLog?.raw?.event_id||state.selectedLog?.raw?.correlation_id;if(!tid)return;closeLogModal();state.traceFilter=tid;setPage('logs');$('logQuery').value='';searchLogs(1);toast(`Tracing ${tid}`,'success');};if($('logModal')) $('logModal').onclick=e=>{if(e.target.id==='logModal')closeLogModal();};const dz=$('dropZone'),fi=$('fileInput');if(dz&&fi){dz.onclick=()=>fi.click();['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('dragover');}));['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('dragover');}));dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)uploadBody(f,f.name);});fi.onchange=()=>{if(fi.files[0])uploadBody(fi.files[0],fi.files[0].name);};if($('uploadBtn')) $('uploadBtn').onclick=()=>{const text=($('logUpload')?.value||'').trim();if(!text)return toast('Paste logs or choose a file first','error');uploadBody(text);};}}
async function refreshAll(){$('tenantEnvChip')&&($('tenantEnvChip').textContent=state.environment);renderEnvButtons();await Promise.allSettled([loadOverview(),loadApisEndpoints(),searchLogs(1),loadAlertsOps(),loadUploadHistory()]);}
(async function boot(){applyTheme();applySidebar();bind();await initWorkspaces();setPage(state.page);await refreshAll();})();
