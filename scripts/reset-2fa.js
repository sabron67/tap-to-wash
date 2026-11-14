// Emergency: removes two-step verification from one account when the owner has lost both phone and recovery codes.
// Run on the server:  node scripts/reset-2fa.js owner@example.com
require('dotenv').config();
const { pool } = require('../config/db');
(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) { console.error('Usage: node scripts/reset-2fa.js <email>'); process.exit(1); }
  const r = await pool.query(`UPDATE admins SET totp_enabled = FALSE, totp_secret = NULL, totp_last_step = NULL, totp_recovery = '[]'::jsonb WHERE email = $1 RETURNING email`, [email]);
  await pool.query(`INSERT INTO audit_log (admin_id, admin_email, action, detail, ip) VALUES (NULL, $1, 'twofa_reset_cli', 'Two-step verification removed from the server command line', '')`, [email]).catch(() => {});
  console.log(r.rows.length ? `Two-step verification removed for ${email}. Sign in with the password and set it up again.` : 'No account with that email.');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
