// Staff accounts: the owner adds people, gives each a role, disables them, and resets passwords.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { wrap, cleanText } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { isRole, ROLES } = require('../lib/roles');
const { staffPage } = require('../views/admin/staff');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Easy-to-read temporary password (no look-alike characters), always has letters and digits.
function tempPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(digits), pick(digits), pick(digits)];
  while (chars.length < 12) chars.push(pick(letters + digits));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function activeOwnersExcluding(id) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM admins WHERE role = 'owner' AND is_active AND id <> $1`, [id]);
  return rows[0].n;
}

module.exports = function mount(router, { buildCtx, flash, need }) {
  const list = () =>
    pool.query(
      `SELECT id, name, email, role, is_active, last_login_at, (locked_until IS NOT NULL AND locked_until > now()) AS locked, must_change_password
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
      const problem = !name ? 'Please enter the person\'s name.' : !EMAIL.test(email) ? 'Please enter a valid email address.' : !isRole(role) ? 'Please choose a role.' : '';
      const dup = !problem && (await pool.query('SELECT 1 FROM admins WHERE email = $1', [email])).rows.length;
      if (problem || dup) {
        flash(req, 'error', problem || 'Someone with that email already has an account.');
        return res.redirect('/admin/staff');
      }
      const password = tempPassword();
      await pool.query('INSERT INTO admins (name, email, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,TRUE)', [name, email, await bcrypt.hash(password, 12), role]);
      await audit(req, 'staff_add', `${email} as ${role}`);
      const [ctx, rows] = await Promise.all([buildCtx(req), list()]);
      res.view(staffPage(ctx, { rows: rows.rows, created: { name, email, role, password, what: 'created' } }));
    })
  );

  router.post(
    '/staff/:id',
    need('staff'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const me = req.session.admin.id;
      const { rows } = Number.isInteger(id) ? await pool.query('SELECT id, name, role, is_active FROM admins WHERE id = $1', [id]) : { rows: [] };
      const t = rows[0];
      if (!t) {
        flash(req, 'error', 'Account not found.');
        return res.redirect('/admin/staff');
      }
      const name = cleanText(req.body.name, 80) || t.name;
      const role = isRole(req.body.role) ? req.body.role : t.role;
      const active = req.body.is_active === '1';
      if (id === me && (role !== t.role || !active)) {
        flash(req, 'error', 'You cannot change your own role or disable your own account.');
        return res.redirect('/admin/staff');
      }
      if (t.role === 'owner' && (role !== 'owner' || !active) && (await activeOwnersExcluding(id)) < 1) {
        flash(req, 'error', 'There must always be at least one active owner.');
        return res.redirect('/admin/staff');
      }
      await pool.query('UPDATE admins SET name = $1, role = $2, is_active = $3 WHERE id = $4', [name, role, active, id]);
      const changes = [role !== t.role && `role ${t.role} → ${role}`, active !== t.is_active && (active ? 'enabled' : 'disabled'), name !== t.name && 'renamed'].filter(Boolean).join(', ');
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
      if (id === req.session.admin.id) {
        flash(req, 'error', 'Use “My account” to change your own password.');
        return res.redirect('/admin/staff');
      }
      const password = tempPassword();
      const { rows } = await pool.query(
        'UPDATE admins SET password_hash = $1, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL WHERE id = $2 RETURNING name, email, role',
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
