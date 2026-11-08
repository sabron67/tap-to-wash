// Web Push (phone / desktop notifications even when the admin page is closed).
// Keys: set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, or let the app generate a pair once and keep it in the database.
const { pool } = require('../config/db');

let webpush = null;
try {
  webpush = require('web-push');
} catch (e) {
  webpush = null; // package not installed: push is simply switched off
}

let ready = null;

async function init() {
  if (!webpush) return null;
  if (ready) return ready;
  ready = (async () => {
    let pub = process.env.VAPID_PUBLIC_KEY;
    let priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
      const { rows } = await pool.query(`SELECT key, value FROM app_secrets WHERE key IN ('vapid_public','vapid_private')`);
      const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      pub = m.vapid_public;
      priv = m.vapid_private;
      if (!pub || !priv) {
        const k = webpush.generateVAPIDKeys();
        pub = k.publicKey;
        priv = k.privateKey;
        await pool.query(
          `INSERT INTO app_secrets (key, value) VALUES ('vapid_public',$1),('vapid_private',$2) ON CONFLICT (key) DO NOTHING`,
          [pub, priv]
        );
        const again = await pool.query(`SELECT key, value FROM app_secrets WHERE key IN ('vapid_public','vapid_private')`);
        const mm = Object.fromEntries(again.rows.map((r) => [r.key, r.value]));
        pub = mm.vapid_public;
        priv = mm.vapid_private;
      }
    }
    const subject = process.env.VAPID_SUBJECT || (process.env.BASE_URL && /^https:/.test(process.env.BASE_URL) ? process.env.BASE_URL : 'mailto:admin@example.com');
    webpush.setVapidDetails(subject, pub, priv);
    return { pub };
  })().catch((err) => {
    ready = null;
    console.error('Push setup failed:', err.message);
    return null;
  });
  return ready;
}

async function publicKey() {
  const r = await init();
  return r ? r.pub : null;
}

// Sends to every device a staff member has enabled. Dead subscriptions are removed.
async function pushToAdmin(adminId, payload) {
  const r = await init();
  if (!r) return 0;
  const { rows } = await pool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE admin_id = $1', [adminId]);
  let sent = 0;
  await Promise.all(
    rows.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high', timeout: 8000 });
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
      }
    })
  );
  return sent;
}

module.exports = { publicKey, pushToAdmin, available: () => !!webpush };
