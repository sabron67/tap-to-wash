// Emergency: switches the "I am not a robot" check off and clears the saved Turnstile keys (when a wrong key locks everyone out).
// Run on the server:  node scripts/reset-turnstile.js
// Also set TURNSTILE_DISABLE=1 (or remove TURNSTILE_SITE_KEY / TURNSTILE_SECRET) in .env, then restart the app.
require('dotenv').config();
const { pool } = require('../config/db');
(async () => {
  await pool.query(`UPDATE settings SET value = '0' WHERE key = 'captcha_on'`);
  const r = await pool.query(`DELETE FROM settings WHERE key IN ('captcha_site', 'captcha_secret') RETURNING key`);
  console.log(`Robot check switched off; cleared: ${r.rows.map((x) => x.key).join(', ') || 'nothing'}. Restart the app (all copies).`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
