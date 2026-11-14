// Staff accounts: the owner adds people, gives each a role, disables them, and resets passwords.
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { wrap, cleanText } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { tempPassword } = require('../lib/password');
const { isRole, ROLES } = require('../lib/roles');
const { staffPage } = require('../views/admin/staff');
const { validWaNumber } = require('../lib/whatsapp');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function activeOwnersExcluding(id) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM admins WHERE role = 'owner' AND is_active AND id <> $1`, [id]);
  return rows[0].n;
}

module.exports = function mount(router, { buildCtx, flash, need }) {
  const list = () =>
    pool.query(
      `SELECT id, name, email, phone, role, is_active, last_login_at, (locked_until IS NOT NULL AND locked_until > now()) AS locked, must_change_password, totp_enabled
         FROM admins ORDER BY is_active DESC, role, name`
    );

  router.get(
    '/staff',
    need('staff'),
    wrap(async (req, res) => {
      const [ctx, rows] = await Promise.all([buildCtx(req), list()]);
      res.view(staffPage(ctx, { rows: rows.rows }));
    })
  );

  router.post(
    '/staff',
    need('staff'),
    wrap(async (req, res) => {
      const name = cleanText(req.body.name, 80);
      const email = cleanText(req.body.email, 120).toLowerCase();
      const role = req.body.role;
      const phone = cleanText(req.body.phone, 20);
      const problem = phone && !validWaNumber(phone) ? 'That phone number does not look right (use e.g. 0712 345 678).' : !name ? 'Please enter the person\'s name.' : !EMAIL.test(email) ? 'Please enter a valid email address.' : !isRole(role) ? 'Please choose a role.' : '';
      const dup = !problem && (await pool.query('SELECT 1 FROM admins WHERE email = $1', [email])).rows.length;
      if (problem || dup) {
        flash(req, 'error', problem || 'Someone with that email already has an account.');
        return res.redirect('/admin/staff');
      }
      const password = tempPassword();
      await pool.query('INSERT INTO admins (name, email, password_hash, role, must_change_password, phone) VALUES ($1,$2,$3,$4,TRUE,$5)', [name, email, await bcrypt.hash(password, 12), role, phone]);
      await audit(req, 'staff_add', `${email} as ${role}`);
      const [ctx, rows] = await Promise.all([buildCtx(req), list()]);
      res.view(staffPage(ctx, { rows: rows.rows, created: { name, email, role, password, phone, what: 'created' } }));
    })
  );

  // Lost phone and no recovery codes: the owner removes the second step; the person sets it up again after signing in.
  router.post(
    '/staff/:id/2fa-reset',
    need('staff'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const r = await pool.query(`UPDATE admins SET totp_enabled = FALSE, totp_secret = NULL, totp_last_step = NULL, totp_recovery = '[]'::jsonb WHERE id = $1 AND id <> $2 RETURNING email`, [id, req.session.admin.id]);
      if (r.rows.length) await audit(req, 'twofa_reset', `Two-step verification reset for ${r.rows[0].email}`);
      flash(req, r.rows.length ? 'success' : 'error', r.rows.length ? 'Two-step verification was reset for that person.' : 'Nothing was changed.');
      res.redirect('/admin/staff');
    })
  );

  router.post(
    '/staff/:id',
    need('staff'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const me = req.session.admin.id;
      const { rows } = Number.isInteger(id) ? await pool.query('SELECT id, name, role, is_active, phone FROM admins WHERE id = $1', [id]) : { rows: [] };
      const t = rows[0];
      if (!t) {
        flash(req, 'error', 'Account not found.');
        return res.redirect('/admin/staff');
      }
      const name = cleanText(req.body.name, 80) || t.name;
      const role = isRole(req.body.role) ? req.body.role : t.role;
      const active = req.body.is_active === '1';
      const phone = req.body.phone === undefined ? t.phone : cleanText(req.body.phone, 20);
      if (phone && !validWaNumber(phone)) {
        flash(req, 'error', 'That phone number does not look right (use e.g. 0712 345 678).');
        return res.redirect('/admin/staff');
      }
      if (id === me && (role !== t.role || !active)) {
        flash(req, 'error', 'You cannot change your own role or disable your own account.');
        return res.redirect('/admin/staff');
      }
      if (t.role === 'owner' && (role !== 'owner' || !active) && (await activeOwnersExcluding(id)) < 1) {
        flash(req, 'error', 'There must always be at least one active owner.');
        return res.redirect('/admin/staff');
      }
      await pool.query('UPDATE admins SET name = $1, role = $2, is_active = $3, phone = $4 WHERE id = $5', [name, role, active, phone, id]);
      const changes = [role !== t.role && `role ${t.role} → ${role}`, active !== t.is_active && (active ? 'enabled' : 'disabled'), name !== t.name && 'renamed', phone !== t.phone && 'phone changed'].filter(Boolean).join(', ');
      await audit(req, 'staff_edit', `#${id} ${name}: ${changes || 'no change'}`);
      flash(req, 'success', `${name} updated.`);
      res.redirect('/admin/staff');
    })
  );

  router.post(
    '/staff/:id/reset',
    need('staff'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        flash(req, 'error', 'Account not found.');
        return res.redirect('/admin/staff');
      }
      if (id === req.session.admin.id) {
        flash(req, 'error', 'Use “My account” to change your own password.');
        return res.redirect('/admin/staff');
      }
      const password = tempPassword();
      const { rows } = await pool.query(
        'UPDATE admins SET password_hash = $1, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL WHERE id = $2 RETURNING name, email, role, phone',
        [await bcrypt.hash(password, 12), id]
      );
      if (!rows.length) {
        flash(req, 'error', 'Account not found.');
        return res.redirect('/admin/staff');
      }
      await audit(req, 'staff_password_reset', `#${id} ${rows[0].email}`);
      const [ctx, list2] = await Promise.all([buildCtx(req), list()]);
      res.view(staffPage(ctx, { rows: list2.rows, created: { ...rows[0], password, what: 'reset' } }));
    })
  );
  void ROLES;
};
