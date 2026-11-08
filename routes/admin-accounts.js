// Staff tools for customer accounts: help someone who forgot their password, or switch an account off.
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { wrap } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { tempPassword } = require('../lib/password');

module.exports = function mount(router, { flash, need, customersView }) {
  router.post(
    '/customers/accounts/:id/reset',
    need('accounts'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const password = tempPassword();
      const { rows } = Number.isInteger(id)
        ? await pool.query(
            'UPDATE accounts SET password_hash = $1, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL WHERE id = $2 RETURNING name, email, phone',
            [await bcrypt.hash(password, 12), id]
          )
        : { rows: [] };
      if (!rows.length) {
        flash(req, 'error', 'Account not found.');
        return res.redirect('/admin/customers');
      }
      await audit(req, 'customer_password_reset', `Customer account #${id} ${rows[0].email}`);
      res.view(await customersView(req, { ...rows[0], password }));
    })
  );

  router.post(
    '/customers/accounts/:id/toggle',
    need('accounts'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const { rows } = Number.isInteger(id) ? await pool.query('UPDATE accounts SET is_active = NOT is_active WHERE id = $1 RETURNING name, is_active', [id]) : { rows: [] };
      if (rows.length) {
        await audit(req, 'customer_account_toggle', `Customer account #${id} ${rows[0].is_active ? 'enabled' : 'disabled'}`);
        flash(req, 'success', `${rows[0].name}'s account ${rows[0].is_active ? 'enabled' : 'disabled'}.`);
      }
      res.redirect('/admin/customers');
    })
  );
};
