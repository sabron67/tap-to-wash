// Backup without pg_dump: exports every table to one JSON file, compresses it, encrypts it (AES-256-GCM, same file layout as
// scripts/backup.js, so scripts/backup-decrypt.js opens it) and uploads it to the admin's Google Drive.
//
// Automatic daily backups: lib/auto-backup.js (started by server.js).
//
// Google Drive setup (one time), then put the 3 values in the environment (Render > Environment):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN      (see README, "Backups to Google Drive")
//   BACKUP_PASSPHRASE   required: the backup holds customer details and password hashes, so it is never sent unencrypted
//   GOOGLE_DRIVE_FOLDER_NAME   optional, default "<business name> Backups". Created automatically in the admin's My Drive.
// The app only asks Google for the "drive.file" permission: it can see and manage ONLY the files and folder it created itself,
// never the rest of the admin's Drive.
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);

const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const API = process.env.GOOGLE_DRIVE_API || 'https://www.googleapis.com';
// Temporary data that is rebuilt by itself (sessions, rate-limit counters, WhatsApp message cache, one-time reset codes).
const SKIP = new Set(['session', 'rate_hits', 'wa_messages', 'password_resets']);
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;

const driveConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);

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

async function google(res, what) {
  if (res.ok) return res;
  let text = '';
  try { text = await res.text(); } catch (e) {}
  if (/invalid_grant/.test(text)) {
    throw new Error('Google refused the saved sign-in (invalid_grant). The refresh token was revoked or expired. If your OAuth consent screen is still in "Testing", tokens last only 7 days: publish the app (Audience > Publish app), then create a new refresh token.');
  }
  throw new Error(`Google Drive ${what} failed (${res.status}): ${text.slice(0, 300)}`);
}

async function accessToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: process.env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  await google(res, 'sign-in');
  return (await res.json()).access_token;
}

async function folderId(token, name) {
  const auth = { Authorization: `Bearer ${token}` };
  const query = `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = await google(await fetch(`${API}/drive/v3/files?${new URLSearchParams({ q: query, fields: 'files(id,name)', spaces: 'drive' })}`, { headers: auth }), 'folder lookup');
  const list = (await found.json()).files || [];
  if (list.length) return list[0].id;
  const made = await google(await fetch(`${API}/drive/v3/files?fields=id`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }) }), 'folder creation');
  return (await made.json()).id;
}

async function uploadToDrive(name, buf, folderName) {
  const token = await accessToken();
  const parent = await folderId(token, folderName);
  const init = await google(await fetch(`${API}/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,webViewLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(buf.length) },
    body: JSON.stringify({ name, parents: [parent] }),
  }), 'upload start');
  const loc = init.headers.get('location');
  if (!loc) throw new Error('Google Drive did not return an upload address.');
  const done = await google(await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: buf }), 'upload');
  return done.json();
}

async function driveFolderName(client) {
  const { rows } = await client.query(`SELECT value FROM settings WHERE key = 'business_name'`);
  return process.env.GOOGLE_DRIVE_FOLDER_NAME || `${(rows[0] && rows[0].value) || 'Tap to Wash'} Backups`;
}
async function driveSession(client) {
  const token = await accessToken();
  return { token, folder: await folderId(token, await driveFolderName(client)) };
}
// Backups in the app's folder, newest first: [{ id, name, createdTime }]
async function listBackups(token, parent) {
  const query = `'${parent}' in parents and name contains 'taptowash-' and trashed = false`;
  const res = await google(await fetch(`${API}/drive/v3/files?${new URLSearchParams({ q: query, fields: 'files(id,name,createdTime)', orderBy: 'createdTime desc', pageSize: '1000' })}`, { headers: { Authorization: `Bearer ${token}` } }), 'backup list');
  return (await res.json()).files || [];
}
async function deleteFile(token, id) {
  const res = await fetch(`${API}/drive/v3/files/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 404) await google(res, 'delete');
}

// Exports + encrypts + (unless localDir is given) uploads. Returns what was done. Throws on any problem, so callers can stop.
async function makeBackup(client, { localDir = '' } = {}) {
  const pass = process.env.BACKUP_PASSPHRASE || '';
  if (!pass) throw new Error('BACKUP_PASSPHRASE is not set. Backups hold customer details and password hashes, so they are only made encrypted. Set it in the environment (any long phrase; keep a copy of it safe, there is no way to open the backup without it).');
  if (!localDir && !driveConfigured()) throw new Error('Google Drive is not set up yet (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN are missing). See README > "Backups to Google Drive".');
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
  const folderName = await driveFolderName(client);
  const up = await uploadToDrive(name, file, folderName);
  return { name, bytes: file.length, where: `Google Drive > ${folderName}`, link: up.webViewLink || '', counts };
}

module.exports = { exportDatabase, encrypt, decrypt, makeBackup, driveConfigured, driveSession, listBackups, deleteFile, SKIP };
