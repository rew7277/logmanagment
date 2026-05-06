import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, hasDatabase } from '../db/pool.js';

export const PERMISSIONS = [
  'dashboard:view','logs:upload','logs:view','logs:delete','apis:view','apis:delete','ai:rca',
  'users:manage','roles:manage','audit:view','billing:manage','settings:manage','invites:manage'
];

export const DEFAULT_ROLE_PERMISSIONS = {
  ADMIN: PERMISSIONS,
  OPS: ['dashboard:view','logs:upload','logs:view','apis:view','apis:delete','ai:rca','audit:view'],
  DEVELOPER: ['dashboard:view','logs:upload','logs:view','apis:view','ai:rca'],
  TESTER: ['dashboard:view','logs:upload','logs:view','apis:view'],
  VIEWER: ['dashboard:view','logs:view','apis:view']
};

function requireDb() {
  if (!hasDatabase) {
    const err = new Error('Database is required for authentication. Configure DATABASE_URL and redeploy.');
    err.status = 503;
    throw err;
  }
}

export function slugify(value='') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,56) || `org-${Date.now()}`;
}

export function publicId(prefix='ox') {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS || 12));
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(payload, ttlSeconds = Number(process.env.AUTH_TTL_SECONDS || 60 * 60 * 8)) {
  const header = Buffer.from(JSON.stringify({ alg:'HS256', typ:'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now()/1000) + ttlSeconds })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev-observex-secret-change-me').update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const [h,b,s] = String(token).split('.');
  if (!h || !b || !s) return null;
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev-observex-secret-change-me').update(`${h}.${b}`).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) return null;
  return payload;
}

export function getBearerOrCookie(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)observex_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie('observex_session', token, { httpOnly:true, secure, sameSite:'lax', maxAge: Number(process.env.AUTH_TTL_SECONDS || 28800) * 1000, path:'/' });
}

export function clearSessionCookie(res) {
  res.clearCookie('observex_session', { path:'/' });
}

export async function ensureDefaultRoles(orgId) {
  for (const [name, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const role = await query(`INSERT INTO roles(org_id,name,description,is_system) VALUES($1,$2,$3,true)
      ON CONFLICT(org_id,name) DO UPDATE SET description=EXCLUDED.description RETURNING id`, [orgId, name, `${name} default role`]);
    for (const permission of PERMISSIONS) {
      await query(`INSERT INTO permissions(key,description) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`, [permission, permission.replace(':',' ')]);
    }
    await query(`DELETE FROM role_permissions WHERE role_id=$1`, [role.rows[0].id]);
    for (const p of permissions) {
      const perm = await query(`SELECT id FROM permissions WHERE key=$1`, [p]);
      await query(`INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [role.rows[0].id, perm.rows[0].id]);
    }
  }
}

export async function audit({ req, orgId=null, actorId=null, actor='system', action, target=null, status='success', details={} }) {
  try {
    await query(`INSERT INTO audit_logs_v2(org_id,actor_user_id,actor,action,target,ip_address,status,details)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [orgId, actorId, actor, action, target, req?.ip || req?.headers?.['x-forwarded-for'] || null, status, JSON.stringify(details)]);
  } catch (e) { console.warn('[audit] failed', e.message); }
}

async function userPayload(userId) {
  const result = await query(`SELECT u.id,u.public_id,u.name,u.email,u.status,u.org_id,o.slug AS org_slug,o.name AS org_name,o.timezone AS org_timezone,o.currency AS org_currency,o.primary_color AS org_primary_color,o.default_invite_role AS org_default_invite_role,o.logo_url AS org_logo_url,r.name AS role,
      COALESCE(json_agg(DISTINCT p.key) FILTER (WHERE p.key IS NOT NULL),'[]') AS permissions
    FROM users_v2 u
    JOIN organizations o ON o.id=u.org_id
    JOIN roles r ON r.id=u.role_id
    LEFT JOIN role_permissions rp ON rp.role_id=r.id
    LEFT JOIN permissions p ON p.id=rp.permission_id
    WHERE u.id=$1 GROUP BY u.id,o.slug,o.name,o.timezone,o.currency,o.primary_color,o.default_invite_role,o.logo_url,r.name`, [userId]);
  return result.rows[0] || null;
}

export async function createOrganizationAdmin({ req, orgName, adminName, email, password, phone }) {
  requireDb();
  const slugBase = slugify(orgName);
  const org = await query(`INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id,name,slug`, [orgName.trim(), slugBase]);
  await ensureDefaultRoles(org.rows[0].id);
  const role = await query(`SELECT id FROM roles WHERE org_id=$1 AND name='ADMIN'`, [org.rows[0].id]);
  const passwordHash = await hashPassword(password);
  const user = await query(`INSERT INTO users_v2(org_id,role_id,public_id,name,email,password_hash,phone,status)
    VALUES($1,$2,$3,$4,lower($5),$6,$7,'active') RETURNING id`, [org.rows[0].id, role.rows[0].id, publicId('usr'), adminName, email, passwordHash, phone || null]);
  await query(`INSERT INTO workspaces(org_id,name,slug) VALUES($1,$2,$3) ON CONFLICT(org_id,slug) DO NOTHING`, [org.rows[0].id, `${orgName} Workspace`, 'production-ops']);
  await audit({ req, orgId: org.rows[0].id, actorId: user.rows[0].id, actor: email, action:'organization.created', target:orgName });
  return userPayload(user.rows[0].id);
}

export async function login({ req, email, password }) {
  requireDb();
  const result = await query(`SELECT u.*,o.slug AS org_slug FROM users_v2 u JOIN organizations o ON o.id=u.org_id WHERE u.email=lower($1)`, [email]);
  const user = result.rows[0];
  if (!user || user.status !== 'active' || !(await verifyPassword(password, user.password_hash))) {
    await audit({ req, actor: email, action:'login.failed', status:'failed', details:{ reason:'invalid_credentials' } });
    const err = new Error('Invalid email or password.'); err.status = 401; throw err;
  }
  await query(`UPDATE users_v2 SET last_login_at=now() WHERE id=$1`, [user.id]);
  await audit({ req, orgId:user.org_id, actorId:user.id, actor:user.email, action:'login.success' });
  return userPayload(user.id);
}

export async function currentUser(req) {
  requireDb();
  const token = getBearerOrCookie(req);
  const payload = verifyToken(token);
  if (!payload?.uid) return null;
  return userPayload(payload.uid);
}

export async function createInvitation({ req, admin, roleName='VIEWER', expiresAt=null, oneTime=true }) {
  const role = await query(`SELECT id,name FROM roles WHERE org_id=$1 AND name=$2`, [admin.org_id, roleName]);
  if (!role.rows[0]) { const err = new Error('Role not found'); err.status=404; throw err; }
  const raw = `OX-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const codeHash = crypto.createHash('sha256').update(raw).digest('hex');
  const row = await query(`INSERT INTO invitation_codes(org_id,role_id,code_hash,code_preview,one_time,expires_at,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,public_id,code_preview,status,expires_at,one_time,created_at`, [admin.org_id, role.rows[0].id, codeHash, `${raw.slice(0,8)}••••`, oneTime, expiresAt, admin.id]);
  await audit({ req, orgId:admin.org_id, actorId:admin.id, actor:admin.email, action:'invitation.created', target:roleName, details:{ oneTime, expiresAt } });
  return { ...row.rows[0], code: raw, role: roleName };
}

export async function signupWithInvite({ req, name, email, password, code }) {
  requireDb();
  const codeHash = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
  const inv = await query(`SELECT i.*,r.name AS role_name FROM invitation_codes i JOIN roles r ON r.id=i.role_id
    WHERE i.code_hash=$1 AND i.status='active' AND (i.expires_at IS NULL OR i.expires_at>now())`, [codeHash]);
  const invite = inv.rows[0];
  if (!invite || (invite.one_time && invite.used_at)) { const err = new Error('This invitation code is invalid, expired, or already used.'); err.status=400; throw err; }
  const passwordHash = await hashPassword(password);
  const user = await query(`INSERT INTO users_v2(org_id,role_id,public_id,name,email,password_hash,status)
    VALUES($1,$2,$3,$4,lower($5),$6,'active') RETURNING id`, [invite.org_id, invite.role_id, publicId('usr'), name, email, passwordHash]);
  await query(`UPDATE invitation_codes SET used_by=$1,used_at=now(),status=CASE WHEN one_time THEN 'used' ELSE status END WHERE id=$2`, [user.rows[0].id, invite.id]);
  await audit({ req, orgId:invite.org_id, actorId:user.rows[0].id, actor:email, action:'invitation.used', target:invite.code_preview });
  return userPayload(user.rows[0].id);
}

export async function requestPasswordReset({ req, email }) {
  const u = await query(`SELECT id,org_id,email FROM users_v2 WHERE email=lower($1)`, [email]);
  if (!u.rows[0]) return { ok:true };
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  await query(`INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes')`, [u.rows[0].id, tokenHash]);
  await audit({ req, orgId:u.rows[0].org_id, actor:u.rows[0].email, action:'password_reset.requested' });
  return { ok:true, resetToken: process.env.NODE_ENV === 'production' ? undefined : raw };
}

export async function resetPassword({ req, token, password }) {
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const t = await query(`SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()`, [tokenHash]);
  if (!t.rows[0]) { const err = new Error('Reset link is invalid or expired.'); err.status=400; throw err; }
  const passwordHash = await hashPassword(password);
  await query(`UPDATE users_v2 SET password_hash=$1 WHERE id=$2`, [passwordHash, t.rows[0].user_id]);
  await query(`UPDATE password_reset_tokens SET used_at=now() WHERE id=$1`, [t.rows[0].id]);
  await audit({ req, actorId:t.rows[0].user_id, action:'password_reset.completed' });
  return { ok:true };
}

export async function adminLists(admin) {
  const [users, roles, invites, auditLogs] = await Promise.all([
    query(`SELECT u.public_id,u.name,u.email,u.status,u.last_login_at,r.name AS role FROM users_v2 u JOIN roles r ON r.id=u.role_id WHERE u.org_id=$1 ORDER BY u.created_at DESC`, [admin.org_id]),
    query(`SELECT r.id,r.name,r.description,COALESCE(json_agg(p.key) FILTER (WHERE p.key IS NOT NULL),'[]') permissions FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE r.org_id=$1 GROUP BY r.id ORDER BY r.name`, [admin.org_id]),
    query(`SELECT i.public_id,i.code_preview,i.status,i.one_time,i.expires_at,i.used_at,r.name role FROM invitation_codes i JOIN roles r ON r.id=i.role_id WHERE i.org_id=$1 ORDER BY i.created_at DESC LIMIT 100`, [admin.org_id]),
    query(`SELECT created_at,actor,action,target,ip_address,status,details FROM audit_logs_v2 WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200`, [admin.org_id])
  ]);
  return { users:users.rows, roles:roles.rows, invitations:invites.rows, auditLogs:auditLogs.rows, permissions:PERMISSIONS };
}

export async function updateOrganizationSettings({ req, admin, settings }) {
  const name = String(settings.name || '').trim() || null;
  const timezone = String(settings.timezone || 'Asia/Kolkata').trim();
  const currency = String(settings.currency || 'INR').trim().toUpperCase();
  const primaryColor = /^#[0-9a-fA-F]{6}$/.test(settings.primaryColor || '') ? settings.primaryColor : '#4f46e5';
  const defaultInviteRole = String(settings.defaultInviteRole || 'VIEWER').trim().toUpperCase();
  await query(`UPDATE organizations SET name=COALESCE($2,name), timezone=$3, currency=$4, primary_color=$5, default_invite_role=$6 WHERE id=$1`, [admin.org_id, name, timezone, currency, primaryColor, defaultInviteRole]);
  await audit({ req, orgId:admin.org_id, actorId:admin.id, actor:admin.email, action:'organization.settings_updated', target:admin.org_id, details:{ name, timezone, currency, primaryColor, defaultInviteRole } });
  return { name: name || admin.org_name, timezone, currency, primaryColor, defaultInviteRole };
}

export async function requirePermission(req, permission) {
  const user = await currentUser(req);
  if (!user) { const err = new Error('Authentication required'); err.status=401; throw err; }
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  if (!permissions.includes(permission) && user.role !== 'ADMIN') { const err = new Error('You do not have permission for this action.'); err.status=403; throw err; }
  return user;
}
