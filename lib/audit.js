const { pool } = require('../config/db');

// Records who did what in the admin area. Never throws: auditing must not break the action itself.
async function audit(req, action, detail = '', who = null) {
  try {
    const a = who || (req.session && req.session.admin) || {};
    await pool.query('INSERT INTO audit_log (admin_id, admin_email, action, detail, ip) VALUES ($1,$2,$3,$4,$5)', [
      a.id || null,
      a.email || '',
      String(action).slice(0, 60),
      String(detail).slice(0, 300),
      String(req.ip || '').slice(0, 64),
    ]);
  } catch (err) {
    console.error('audit failed:', err.message);
  }
}

module.exports = { audit };
