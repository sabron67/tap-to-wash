// Backup without pg_dump: exports every table to one JSON file, compresses it, encrypts it (AES-256-GCM, same file layout as
// scripts/backup.js, so scripts/backup-decrypt.js opens it) and EMAILS it to the address chosen in Admin > Settings > Backups.
//
// Everything is set in the admin page (see lib/backup-settings.js): the email server, who receives the backup, the time of day and
// the backup password. The backup holds customer details and password hashes, so it is never sent unencrypted: without the
// backup password it cannot be opened, so keep a copy of that password somewhere safe.
//
// Automatic daily backups: lib/auto-backup.js (started by server.js).
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const settings = require('./backup-settings');
const mailer = require('./mailer');

// Mail services refuse big attachments (Gmail: 25 MB in all, and an attachment grows by about a third when it is sent).
const MAX_ATTACHMENT = 18 * 1024 * 1024;

// Temporary data that is rebuilt by itself (sessions, rate-limit counters, WhatsApp message cache, one-time reset codes).
const SKIP = new Set(['session', 'rate_hits', 'wa_messages', 'password_resets']);
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;

async function exportDatabase(client) {
  const { rows } = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  const tables = {};
  const counts = {};
  for (const { table_name: t } of rows) {
    if (SKIP.has(t)) continue;
    const r = await client.query(`SELECT COALESCE(json_agg(x), '[]'::json) AS d FROM ${q(t)} x`);
    tables[t] = r.rows[0].d;
    counts[t] = r.rows[0].d.length;
  }
  const { rows: [m] } = await client.query('SELECT current_database() AS db');
  const body = JSON.stringify({ format: 'ttw-json-backup', version: 1, created_at: new Date().toISOString(), database: m.db, tables });
  return { data: await gzip(Buffer.from(body)), counts };
}

// File layout: "TTWB1" | salt(16) | iv(12) | ciphertext | auth tag(16)
function encrypt(buf, pass) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(pass, salt, 32), iv);
  const body = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([Buffer.from('TTWB1'), salt, iv, body, cipher.getAuthTag()]);
}
function decrypt(buf, pass) {
  if (buf.subarray(0, 5).toString() !== 'TTWB1') throw new Error('This is not an encrypted Tap to Wash backup.');
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(pass, buf.subarray(5, 21), 32), buf.subarray(21, 33));
  d.setAuthTag(buf.subarray(buf.length - 16));
  try { return Buffer.concat([d.update(buf.subarray(33, buf.length - 16)), d.final()]); } catch (e) { throw new Error('Could not decrypt: wrong passphrase or the file is damaged.'); }
}

// File layout: "TTWB1" | salt(16) | iv(12) | ciphertext | auth tag(16)
function encrypt(buf, pass) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(pass, salt, 32), iv);
  const body = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([Buffer.from('TTWB1'), salt, iv, body, cipher.getAuthTag()]);
}
function decrypt(buf, pass) {
  if (buf.subarray(0, 5).toString() !== 'TTWB1') throw new Error('This is not an encrypted Tap to Wash backup.');
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(pass, buf.subarray(5, 21), 32), buf.subarray(21, 33));
  d.setAuthTag(buf.subarray(buf.length - 16));
  try { return Buffer.concat([d.update(buf.subarray(33, buf.length - 16)), d.final()]); } catch (e) { throw new Error('Could not decrypt: wrong passphrase or the file is damaged.'); }
}

async function businessName(client) {
  const { rows } = await client.query(`SELECT value FROM settings WHERE key = 'business_name'`);
  return (rows[0] && rows[0].value) || 'Tap to Wash';
}

// Exports + encrypts + emails (or, with localDir, saves a file). Returns what was done. Throws on any problem, so callers can stop.
async function makeBackup(client, { localDir = '' } = {}) {
  await settings.load();
  const pass = settings.passphrase();
  if (!pass) throw new Error('No backup password is set. Backups hold customer details and password hashes, so they are only made encrypted. Set one in Admin > Settings > Backups (any long phrase; keep a copy safe, there is no way to open a backup without it).');
  const to = String(settings.get().backup_to || '').trim();
  if (!localDir) {
    if (!mailer.validEmail(to)) throw new Error('No email address to send backups to. Set it in Admin > Settings > Backups.');
    if (!mailer.enabled()) throw new Error('Email sending is not set up yet. Fill in Admin > Settings > Email sending first.');
  }
  const { data, counts } = await exportDatabase(client);
  const file = encrypt(data, pass);
  const name = `taptowash-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz.enc`;
  if (localDir) {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
    const out = path.join(localDir, name);
    fs.writeFileSync(out, file, { mode: 0o600 });
    return { name, bytes: file.length, where: out, counts };
  }
  if (file.length > MAX_ATTACHMENT) {
    throw new Error(`The backup is ${(file.length / 1048576).toFixed(1)} MB, which is too big to send by email (limit about ${Math.floor(MAX_ATTACHMENT / 1048576)} MB). Run "npm run db:backup:email -- --local" on the server to save it as a file instead.`);
  }
  const biz = await businessName(client);
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  const when = new Date().toLocaleString('en-GB', { timeZone: process.env.BACKUP_TZ || 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
  const text = [
    `Backup of ${biz}, made ${when}.`,
    '',
    `The attached file (${name}, ${(file.length / 1024).toFixed(0)} KB) holds ${rows} records from ${Object.keys(counts).length} tables.`,
    'It is encrypted: it can only be opened with the backup password set in Admin > Settings > Backups. Keep that password safe; without it this file cannot be read.',
    '',
    'To restore it on the server: npm run db:restore -- <file> (see the README).',
    'Keep this email, or download the attachment to a safe place. Do not forward it.',
  ].join('\n');
  const sent = await mailer.send(to, `${biz} backup - ${when}`, text, '', { attachments: [{ filename: name, content: file, contentType: 'application/octet-stream' }] });
  if (!sent.ok) throw new Error(`The email could not be sent: ${sent.error}`);
  return { name, bytes: file.length, where: `email to ${to}`, to, counts };
}

module.exports = { exportDatabase, encrypt, decrypt, makeBackup, SKIP };
