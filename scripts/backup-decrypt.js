// Decrypts a backup made by scripts/backup.js (needs BACKUP_PASSPHRASE).  Usage: node scripts/backup-decrypt.js <file.dump.enc>
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');

const file = process.argv[2];
const pass = process.env.BACKUP_PASSPHRASE || '';
if (!file || !pass) {
  console.error('Usage: BACKUP_PASSPHRASE=... node scripts/backup-decrypt.js <file.dump.enc>');
  process.exit(1);
}
const buf = fs.readFileSync(file);
if (buf.subarray(0, 5).toString() !== 'TTWB1') {
  console.error('This is not an encrypted Tap to Wash backup.');
  process.exit(1);
}
const salt = buf.subarray(5, 21);
const iv = buf.subarray(21, 33);
const tag = buf.subarray(buf.length - 16);
const body = buf.subarray(33, buf.length - 16);
try {
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(pass, salt, 32), iv);
  d.setAuthTag(tag);
  const out = file.replace(/\.enc$/, '');
  fs.writeFileSync(out, Buffer.concat([d.update(body), d.final()]), { mode: 0o600 });
  console.log(`Decrypted to ${out}. Restore it with pg_restore.`);
} catch (e) {
  console.error('Could not decrypt: wrong passphrase or the file is damaged.');
  process.exit(1);
}
