async function oxApi(path, opts={}){
  const res = await fetch(path,{headers:{'Content-Type':'application/json',...(opts.headers||{})},credentials:'include',...opts,body:opts.body?JSON.stringify(opts.body):undefined});
  const data = await res.json().catch(()=>({ok:false,error:'Invalid server response'}));
  if(!res.ok || data.ok===false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function showMsg(form,msg,type='ok'){const el=form.querySelector('.form-msg'); if(el){el.className=`form-msg ${type}`; el.textContent=msg;}}
function bindForm(id,handler){const f=document.getElementById(id); if(!f) return; f.addEventListener('submit',async e=>{e.preventDefault(); const btn=f.querySelector('button[type=submit]'); const old=btn?.textContent; if(btn){btn.disabled=true;btn.textContent='Processing…'} try{await handler(Object.fromEntries(new FormData(f).entries()),f)}catch(err){showMsg(f,err.message,'err')} finally{if(btn){btn.disabled=false;btn.textContent=old}}});}
function go(url){ window.location.href=url; }

bindForm('loginForm', async (v,f)=>{const d=await oxApi('/api/auth/login',{method:'POST',body:{email:v.email,password:v.password}});showMsg(f,'Signed in. Redirecting…','ok');setTimeout(()=>go(d.redirect||'/app'),400);});
bindForm('orgSignupForm', async (v,f)=>{const d=await oxApi('/api/auth/org-signup',{method:'POST',body:{organizationName:v.organizationName,adminName:v.adminName,adminEmail:v.adminEmail,password:v.password,phone:v.phone}});showMsg(f,'Organization created. Redirecting…','ok');setTimeout(()=>go(d.redirect||'/app'),500);});
bindForm('inviteSignupForm', async (v,f)=>{const d=await oxApi('/api/auth/invite-signup',{method:'POST',body:{name:v.name,email:v.email,password:v.password,invitationCode:v.invitationCode}});showMsg(f,'Account created. Redirecting…','ok');setTimeout(()=>go(d.redirect||'/app'),500);});
bindForm('forgotForm', async (v,f)=>{const d=await oxApi('/api/auth/forgot-password',{method:'POST',body:{email:v.email}});showMsg(f,d.resetToken?`Demo reset token: ${d.resetToken}`:'Reset instructions sent if the account exists.','ok');});
bindForm('resetForm', async (v,f)=>{await oxApi('/api/auth/reset-password',{method:'POST',body:{token:v.token,password:v.password,confirmPassword:v.confirmPassword}});showMsg(f,'Password updated. You can sign in now.','ok');});

async function loadAdmin(){
  const root=document.getElementById('adminRoot'); if(!root) return;
  try{
    const d=await oxApi('/api/auth/admin/bootstrap');
    const users=d.users.map(u=>`<tr><td><b>${u.name}</b></td><td>${u.email}</td><td><span class="badge">${u.role}</span></td><td>${u.status}</td><td>${u.last_login_at?new Date(u.last_login_at).toLocaleString():'—'}</td><td><button class="ox-btn ghost" onclick="confirmDisable('${u.public_id}')">Disable</button></td></tr>`).join('');
    const roleCards=d.roles.map(r=>`<div class="admin-card"><h3>${r.name}</h3><p>${r.description||''}</p><div class="perm-grid">${d.permissions.map(p=>`<div class="toggle"><span>${p}</span><span class="switch ${(r.permissions||[]).includes(p)?'on':''}"></span></div>`).join('')}</div></div>`).join('');
    const invites=d.invitations.map(i=>`<tr><td>${i.code_preview}</td><td>${i.role}</td><td>${i.one_time?'One-time':'Reusable'}</td><td>${i.expires_at?new Date(i.expires_at).toLocaleString():'No expiry'}</td><td><span class="badge">${i.status}</span></td><td><button class="ox-btn ghost" onclick="navigator.clipboard.writeText('${i.code_preview}')">Copy</button></td></tr>`).join('');
    const audits=d.auditLogs.map(a=>`<tr><td>${new Date(a.created_at).toLocaleString()}</td><td>${a.actor||'system'}</td><td>${a.action}</td><td>${a.target||'—'}</td><td>${a.ip_address||'—'}</td><td>${a.status}</td><td>${JSON.stringify(a.details||{})}</td></tr>`).join('');
    root.innerHTML=`
      <div class="admin-head"><div><p class="eyebrow">${d.user.organization.name}</p><h1>Admin Settings</h1></div><a class="ox-btn primary" href="/app">Open workspace</a></div>
      <section id="settings" class="admin-card"><h2>Settings</h2><p>Enterprise controls for workspace, users, roles, security and billing.</p></section>
      <section id="users" class="admin-card"><div class="admin-head"><h2>Users</h2><button class="ox-btn primary" onclick="openInvite()">Generate invite</button></div><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead><tbody>${users}</tbody></table></section>
      <section id="roles"><h2>Roles & Permissions</h2>${roleCards}</section>
      <section id="invites" class="admin-card"><h2>Invitation Codes</h2><table class="table"><thead><tr><th>Code</th><th>Role</th><th>Type</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead><tbody>${invites}</tbody></table></section>
      <section id="audit" class="admin-card"><h2>Audit Logs</h2><table class="table"><thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th><th>Status</th><th>Details</th></tr></thead><tbody>${audits}</tbody></table></section>
      <section id="security" class="admin-card"><h2>Security</h2><p>Passwords are hashed, sessions use HttpOnly cookies, RBAC gates admin APIs, and sensitive actions are audited.</p></section>
      <section id="billing" class="admin-card"><h2>Billing</h2><p>Plan, invoices and usage limits can be connected to Stripe or your billing provider.</p></section>`;
  }catch(e){root.innerHTML=`<div class="admin-card"><h2>Admin access required</h2><p>${e.message}</p><a class="ox-btn primary" href="/signin.html">Sign in</a></div>`}
}
window.openInvite=()=>document.getElementById('inviteModal').classList.add('show');
window.closeInvite=()=>document.getElementById('inviteModal').classList.remove('show');
window.createInvite=async()=>{const role=document.getElementById('inviteRole').value;const oneTime=document.getElementById('inviteType').value==='one';const expiresAt=document.getElementById('inviteExpiry').value||null;const d=await oxApi('/api/auth/admin/invitations',{method:'POST',body:{role,oneTime,expiresAt}});document.getElementById('inviteCodeOut').textContent=d.invitation.code;};
window.confirmDisable=async(id)=>{if(confirm('Disable this user? They will lose access immediately.')){await oxApi(`/api/auth/admin/users/${id}/disable`,{method:'POST'});loadAdmin();}};
loadAdmin();

const reveal=()=>document.querySelectorAll('[data-reveal]').forEach((el,i)=>{const r=el.getBoundingClientRect(); if(r.top<innerHeight-80){el.style.opacity=1;el.style.transform='none';el.style.transition=`.6s ease ${i*40}ms`;}});addEventListener('scroll',reveal);reveal();
