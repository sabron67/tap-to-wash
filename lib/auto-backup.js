// Automatic daily backup, emailed to the address set in Admin > Settings > Backups (see lib/backup.js).
// Nothing to install or run: switch it on in the admin page and the app backs itself up every day.
//   - Sends once a day, at the first check after the chosen hour (default 2 = 2 AM, in BACKUP_TZ, default Africa/Nairobi).
//   - "Catch-up": if the server was off or asleep at that hour, the backup is sent as soon as it is awake again the same day.
//     The time of the last backup is kept in the database, so a restart never causes a second backup on the same day.
//   - Two copies of the app (for example during a redeploy) never back up at the same time (PostgreSQL advisory lock).
//   - A failed backup is shown on the Settings page and written to Admin > Activity ("auto_backup_failed"), then retried 3 hours later.
//   - AUTO_BACKUP=0 in the environment switches the scheduler off completely (the "Send a backup now" button still works).
// Note: the host must be awake for this to run. A free Render service that sleeps when idle will only back up when it wakes.
const { Client } = require('pg');
const { buildConfig } = require('../config/db');
const { audit } = require('./audit');
const { makeBackup } = require('./backup');
const mailer = require('./mailer');
const settings = require('./backup-settings');

const CHECK_EVERY_MS = 30 * 60 * 1000;
const RETRY_AFTER_MS = 3 * 3600 * 1000;
const LOCK_KEY = 727001;
const SYSTEM = { id: null, email: 'system' };
const tz = () => process.env.BACKUP_TZ || 'Africa/Nairobi';

// "2026-11-18" and the hour (0-23) in the backup time zone.
function localParts(date) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
  } catch (e) {
    return { day: date.toISOString().slice(0, 10), hour: date.getUTCHours() };
  }
}

let timer = null;
let running = false;
let nextTryAt = 0;

// Backs up now and emails it. `by` is the admin who pressed the button (null for the scheduler). Never throws.
async function runOnce({ by = null } = {}) {
  if (running) return { error: 'A backup is already being made. Try again in a minute.' };
  running = true;
  const cfg = buildConfig();
  const client = new Client({ connectionString: cfg.connectionString, ssl: cfg.ssl, connectionTimeoutMillis: 15000, application_name: 'auto-backup' });
  const who = by || SYSTEM;
  const kind = by ? 'manual_backup' : 'auto_backup';
  try {
    await client.connect();
    const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!lock.ok) return { error: 'Another copy of the app is making a backup right now.' };

    const b = await makeBackup(client);
    nextTryAt = 0;
    const note = `Sent ${new Date().toLocaleString('en-GB', { timeZone: tz(), dateStyle: 'medium', timeStyle: 'short' })} to ${b.to} (${(b.bytes / 1024).toFixed(0)} KB)`;
    await settings.save({ backup_last_ok: new Date().toISOString(), backup_last_note: note });
    console.log(`Backup emailed: ${b.name} (${(b.bytes / 1024).toFixed(0)} KB) to ${b.to}`);
    await audit({ ip: '' }, kind, `${b.name} (${(b.bytes / 1024).toFixed(0)} KB) ${b.where}`, who);
    return { ok: true, name: b.name, to: b.to, bytes: b.bytes };
  } catch (e) {
    if (!by) nextTryAt = Date.now() + RETRY_AFTER_MS;
    console.error('Backup failed:', e.message);
    try { await settings.save({ backup_last_note: `Failed ${new Date().toLocaleString('en-GB', { timeZone: tz(), dateStyle: 'medium', timeStyle: 'short' })}: ${e.message}`.slice(0, 400) }); } catch (_) {}
    await audit({ ip: '' }, `${kind}_failed`, e.message, who);
    return { error: e.message };
  } finally {
    try { await client.end(); } catch (e) { /* closing also releases the lock */ }
    running = false;
  }
}

async function tick() {
  if (running || Date.now() < nextTryAt) return;
  await settings.load(); // picks up changes made in the admin page (also by another copy of the app)
  const c = settings.get();
  if (c.backup_on !== '1' || !settings.passphrase() || !mailer.validEmail(c.backup_to) || !mailer.enabled()) return;
  const now = localParts(new Date());
  if (now.hour < Math.min(23, Math.max(0, parseInt(c.backup_hour, 10) || 0))) return;
  const last = c.backup_last_ok ? new Date(c.backup_last_ok) : null;
  if (last && !Number.isNaN(last.getTime()) && localParts(last).day === now.day) return; // already sent today
  await runOnce();
}

function start() {
  if (timer) return;
  settings.load().catch((e) => console.error('Could not load email and backup settings:', e.message));
  if (process.env.AUTO_BACKUP === '0') return console.log('Automatic backups are switched off (AUTO_BACKUP=0).');
  console.log(`Automatic email backups: checked every 30 minutes (turn them on in Admin > Settings > Backups; time zone ${tz()}).`);
  timer = setInterval(() => tick().catch((e) => console.error('Auto backup error:', e.message)), CHECK_EVERY_MS);
  timer.unref();
  setTimeout(() => tick().catch((e) => console.error('Auto backup error:', e.message)), 60 * 1000).unref(); // catch up soon after a restart
}
function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce, tick, localParts };
