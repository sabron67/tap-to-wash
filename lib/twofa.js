// Second-step check shared by the sign-in challenge and by the account page (disable, new recovery codes).
const { pool } = require('../config/db');
const totp = require('./totp');

// Accepts either an authenticator code or a one-time recovery code. Each code can be used only once.
// Returns 'totp', 'recovery' or null.
async function checkSecondFactor(adminId, input) {
  const { rows } = await pool.query('SELECT totp_secret, totp_enabled FROM admins WHERE id = $1', [adminId]);
  const a = rows[0];
  if (!a || !a.totp_enabled || !a.totp_secret) return null;
  const typed = String(input || '').trim();
  if (/^\d[\d\s]{4,}$/.test(typed)) {
    let secret;
    try { secret = totp.open(a.totp_secret); } catch (e) { return null; }
    const step = totp.verify(secret, typed);
    if (step === null) return null;
    // Atomic: a step already used (or an older one) is refused, so a code cannot be replayed.
    const r = await pool.query('UPDATE admins SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2) RETURNING id', [adminId, step]);
    return r.rows.length ? 'totp' : null;
  }
  if (totp.normRecovery(typed).length >= 8) {
    const h = totp.hashRecovery(typed);
    const r = await pool.query('UPDATE admins SET totp_recovery = totp_recovery - $2 WHERE id = $1 AND totp_recovery ? $2 RETURNING id', [adminId, h]);
    return r.rows.length ? 'recovery' : null;
  }
  return null;
}

async function enable(adminId, secret) {
  const codes = totp.newRecoveryCodes(8);
  await pool.query(
    `UPDATE admins SET totp_secret = $2, totp_enabled = TRUE, totp_last_step = $3, totp_recovery = $4::jsonb WHERE id = $1`,
    [adminId, totp.seal(secret), totp.stepAt(), JSON.stringify(codes.map(totp.hashRecovery))]
  );
  return codes;
}
async function newRecovery(adminId) {
  const codes = totp.newRecoveryCodes(8);
  await pool.query('UPDATE admins SET totp_recovery = $2::jsonb WHERE id = $1', [adminId, JSON.stringify(codes.map(totp.hashRecovery))]);
  return codes;
}
const disable = (adminId) => pool.query(`UPDATE admins SET totp_enabled = FALSE, totp_secret = NULL, totp_last_step = NULL, totp_recovery = '[]'::jsonb WHERE id = $1`, [adminId]);

module.exports = { checkSecondFactor, enable, newRecovery, disable };
