// Email-sending, backup and robot-check (Cloudflare Turnstile) options that the owner sets in Admin > Settings (no environment variables needed).
// Kept in the settings table under their own keys, so they are never part of the public settings object.
// Secrets (the email password and the backup password) are encrypted with lib/secretbox.js before they are stored.
// The old environment variables (SMTP_*, BACKUP_PASSPHRASE) still work as a fallback when nothing is set in the admin page.
const { pool } = require('../config/db');
const { seal, open } = require('./secretbox');

const DEFAULTS = {
  mail_host: '',
  mail_port: '587',
  mail_secure: '', // '1' = TLS from the start (port 465)
  mail_user: '',
  mail_pass: '', // sealed
  mail_from: '',
  backup_on: '0', // '1' = automatic daily backup by email
  backup_to: '', // where the backup is emailed
  backup_hour: '2', // hour of the day (0-23, Nairobi time unless BACKUP_TZ is set) after which the daily backup is sent
  backup_pass: '', // sealed
  backup_last_ok: '', // ISO time of the last backup that was emailed
  backup_last_note: '', // what happened last time (success or the reason it failed)
  captcha_on: '0', // '1' = "I am not a robot" check (lib/turnstile.js)
  captcha_site: '', // Cloudflare Turnstile site key (public)
  captcha_secret: '', // Cloudflare Turnstile secret key, sealed
};
const SECRET = new Set(['mail_pass', 'backup_pass', 'captcha_secret']);

let cache = { ...DEFAULTS };

async function load() {
  const { rows } = await pool.query(`SELECT key, value FROM settings WHERE key LIKE 'mail\\_%' OR key LIKE 'backup\\_%' OR key LIKE 'captcha\\_%'`);
  const next = { ...DEFAULTS };
  for (const r of rows) {
    if (!(r.key in DEFAULTS)) continue;
    next[r.key] = r.value;
  }
  cache = next;
  return cache;
}

// Saves only the keys given. Secrets are encrypted here. The cache is updated at once, so the mailer uses the new values.
async function save(values) {
  for (const key of Object.keys(DEFAULTS)) {
    if (values[key] === undefined) continue;
    let v = String(values[key]);
    if (SECRET.has(key) && v !== '') v = seal(v);
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, v]);
    cache[key] = v;
  }
  require('./bus').emit('settings:changed', {}).catch(() => {}); // other copies of the app re-read the settings
}

// Another copy of the app saved settings: re-read them so every copy uses the same email, backup and captcha values.
require('./bus').on('settings:changed', (m, meta) => (meta && meta.local ? null : load()));
require('./bus').on('connected', () => load());

const secret = (key) => {
  const v = cache[key];
  if (!v) return '';
  try { return open(v); } catch (e) { return ''; } // unreadable (the secret key changed): treated as not set
};

const get = () => cache;

// Email server settings: the admin page first, then the old environment variables.
function mail() {
  const e = process.env;
  const pick = (k, env) => (cache[k] !== '' && cache[k] != null ? cache[k] : String(e[env] || ''));
  const port = Number(pick('mail_port', 'SMTP_PORT')) || 587;
  return {
    host: pick('mail_host', 'SMTP_HOST').trim(),
    port,
    secure: cache.mail_secure === '1' || /^(1|true|yes)$/i.test(String(e.SMTP_SECURE || '')) || port === 465,
    user: pick('mail_user', 'SMTP_USER').trim(),
    pass: secret('mail_pass') || String(e.SMTP_PASS || ''),
    from: (cache.mail_from || String(e.SMTP_FROM || '') || pick('mail_user', 'SMTP_USER')).trim(),
  };
}

// On when switched on in Admin > Settings, or when both TURNSTILE_SITE_KEY and TURNSTILE_SECRET are set in the environment.
const captchaOn = () => cache.captcha_on === '1' || !!(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET);
const captchaSite = () => cache.captcha_site || process.env.TURNSTILE_SITE_KEY || '';
const captchaSecret = () => secret('captcha_secret') || process.env.TURNSTILE_SECRET || '';
const passphrase = () => secret('backup_pass') || process.env.BACKUP_PASSPHRASE || '';

// What the admin page may show: never the secrets themselves, only whether they are set.
function view() {
  const m = mail();
  return {
    mail: { host: m.host, port: m.port, secure: m.secure, user: m.user, from: m.from, hasPass: !!m.pass },
    backup: {
      on: cache.backup_on === '1',
      to: cache.backup_to,
      hour: Math.min(23, Math.max(0, parseInt(cache.backup_hour, 10) || 0)),
      hasPass: !!passphrase(),
      lastOk: cache.backup_last_ok,
      lastNote: cache.backup_last_note,
    },
    captcha: { on: captchaOn(), site: captchaSite(), hasSecret: !!captchaSecret(), disabledByEnv: process.env.TURNSTILE_DISABLE === '1' },
  };
}

module.exports = { DEFAULTS, load, save, get, mail, passphrase, captchaSecret, captchaSite, captchaOn, view };
