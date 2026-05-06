import express from 'express';
import {
  adminLists, audit, clearSessionCookie, createInvitation, createOrganizationAdmin, currentUser,
  login, requestPasswordReset, requirePermission, resetPassword, setSessionCookie, signToken,
  signupWithInvite, updateOrganizationSettings
} from '../services/authRepository.js';

const router = express.Router();

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function cleanUser(user) {
  if (!user) return null;
  return {
    id: user.public_id,
    name: user.name,
    email: user.email,
    role: user.role,
    organization: { name: user.org_name, slug: user.org_slug, timezone:user.org_timezone, currency:user.org_currency, primaryColor:user.org_primary_color, defaultInviteRole:user.org_default_invite_role, logoUrl:user.org_logo_url },
    permissions: user.permissions || []
  };
}

router.get('/me', asyncRoute(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok:false, error:'Authentication required' });
  res.json({ ok:true, user: cleanUser(user) });
}));

router.post('/org-signup', asyncRoute(async (req, res) => {
  const { organizationName, adminName, adminEmail, password, phone } = req.body || {};
  if (!organizationName || !adminName || !adminEmail || !password || String(password).length < 8) {
    return res.status(400).json({ ok:false, error:'Organization name, admin details and a password of at least 8 characters are required.' });
  }
  const user = await createOrganizationAdmin({ req, orgName: organizationName, adminName, email: adminEmail, password, phone });
  const token = signToken({ uid:user.id, org:user.org_id, role:user.role });
  setSessionCookie(res, token);
  res.status(201).json({ ok:true, token, user: cleanUser(user), redirect:'/app' });
}));

router.post('/invite-signup', asyncRoute(async (req, res) => {
  const { name, email, password, invitationCode } = req.body || {};
  if (!name || !email || !password || !invitationCode || String(password).length < 8) {
    return res.status(400).json({ ok:false, error:'Name, email, password and invitation code are required.' });
  }
  const user = await signupWithInvite({ req, name, email, password, code: invitationCode });
  const token = signToken({ uid:user.id, org:user.org_id, role:user.role });
  setSessionCookie(res, token);
  res.status(201).json({ ok:true, token, user: cleanUser(user), redirect:'/app' });
}));

router.post('/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, error:'Email and password are required.' });
  const user = await login({ req, email, password });
  const token = signToken({ uid:user.id, org:user.org_id, role:user.role });
  setSessionCookie(res, token);
  res.json({ ok:true, token, user: cleanUser(user), redirect:'/app' });
}));

router.post('/logout', asyncRoute(async (req, res) => {
  const user = await currentUser(req).catch(() => null);
  if (user) await audit({ req, orgId:user.org_id, actorId:user.id, actor:user.email, action:'logout' });
  clearSessionCookie(res);
  res.json({ ok:true });
}));

router.post('/forgot-password', asyncRoute(async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ ok:false, error:'Email is required.' });
  const result = await requestPasswordReset({ req, email });
  res.json({ ok:true, message:'If an account exists, a reset link has been generated.', ...result });
}));

router.post('/reset-password', asyncRoute(async (req, res) => {
  const { token, password, confirmPassword } = req.body || {};
  if (!token || !password || password !== confirmPassword || String(password).length < 8) {
    return res.status(400).json({ ok:false, error:'Valid token and matching password of at least 8 characters are required.' });
  }
  await resetPassword({ req, token, password });
  res.json({ ok:true, message:'Password updated successfully. You can sign in now.' });
}));

router.get('/admin/bootstrap', asyncRoute(async (req, res) => {
  const admin = await requirePermission(req, 'users:manage');
  const data = await adminLists(admin);
  res.json({ ok:true, user: cleanUser(admin), ...data });
}));


router.post('/admin/settings', asyncRoute(async (req, res) => {
  const admin = await requirePermission(req, 'settings:manage');
  const settings = await updateOrganizationSettings({ req, admin, settings: req.body || {} });
  res.json({ ok:true, settings });
}));

router.post('/admin/invitations', asyncRoute(async (req, res) => {
  const admin = await requirePermission(req, 'invites:manage');
  const { role, expiresAt, oneTime } = req.body || {};
  const invite = await createInvitation({ req, admin, roleName: role || 'VIEWER', expiresAt: expiresAt || null, oneTime: oneTime !== false });
  res.status(201).json({ ok:true, invitation: invite });
}));

router.post('/admin/users/:publicId/disable', asyncRoute(async (req, res) => {
  const admin = await requirePermission(req, 'users:manage');
  const { query } = await import('../db/pool.js');
  await query(`UPDATE users_v2 SET status='disabled', updated_at=now() WHERE org_id=$1 AND public_id=$2`, [admin.org_id, req.params.publicId]);
  await audit({ req, orgId:admin.org_id, actorId:admin.id, actor:admin.email, action:'user.disabled', target:req.params.publicId });
  res.json({ ok:true });
}));

router.post('/admin/users/:publicId/role', asyncRoute(async (req, res) => {
  const admin = await requirePermission(req, 'users:manage');
  const { query } = await import('../db/pool.js');
  const role = await query(`SELECT id FROM roles WHERE org_id=$1 AND name=$2`, [admin.org_id, req.body.role]);
  if (!role.rows[0]) return res.status(404).json({ ok:false, error:'Role not found' });
  await query(`UPDATE users_v2 SET role_id=$1, updated_at=now() WHERE org_id=$2 AND public_id=$3`, [role.rows[0].id, admin.org_id, req.params.publicId]);
  await audit({ req, orgId:admin.org_id, actorId:admin.id, actor:admin.email, action:'user.role_updated', target:req.params.publicId, details:{ role:req.body.role } });
  res.json({ ok:true });
}));

export default router;
