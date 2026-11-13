// PostgreSQL custom-format backup. Requires pg_dump on the host.
// Set BACKUP_PASSPHRASE to encrypt the file (AES-256-GCM). An unencrypted backup holds every customer's name, phone and
// location, so encrypt it and keep a copy somewhere other than this server. Restore with: npm run db:backup:decrypt -- <file>
process.env.DB_STATEMENT_TIMEOUT_MS = '0'; // set-up and backup scripts may run long queries
require('dotenv').config();
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const dir = path.resolve(process.env.BACKUP_DIR || 'backups');
const keepDays = Math.max(1, Number(process.env.BACKUP_KEEP_DAYS) || 14);
const pass = process.env.BACKUP_PASSPHRASE || '';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(dir, `taptowash-${stamp}.dump`);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

// File layout: "TTWB1" | salt(16) | iv(12) | ciphertext | auth tag(16)
function encryptFile(file) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const out = fs.createWriteStream(file + '.enc', { mode: 0o600 });
  out.write(Buffer.concat([Buffer.from('TTWB1'), salt, iv]));
  return new Promise((resolve, reject) => {
    fs.createReadStream(file).pipe(cipher).on('error', reject).on('end', () => {
      out.end(cipher.getAuthTag(), () => resolve(file + '.enc'));
    }).on('data', (chunk) => out.write(chunk));
  });
}

execFile('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', output, url], { timeout: 15 * 60 * 1000 }, async (error, stdout, stderr) => {
  if (error) {
    console.error(`Backup failed: ${stderr || error.message}`);
    try { fs.unlinkSync(output); } catch (_) {}
    process.exitCode = 1;
    return;
  }
  let final = output;
  if (pass) {
    try {
      final = await encryptFile(output);
      fs.unlinkSync(output); // the plain copy is removed once the encrypted one is written
    } catch (e) {
      console.error(`Backup was made but could not be encrypted: ${e.message}`);
      try { fs.chmodSync(output, 0o600); } catch (_) {}
      process.exitCode = 1;
      return;
    }
  } else {
    try { fs.chmodSync(output, 0o600); } catch (_) {}
    console.warn('WARNING: BACKUP_PASSPHRASE is not set, so this backup is NOT encrypted. Set it in your environment.');
  }
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    if (!/^taptowash-.*\.dump(\.enc)?$/.test(name)) continue;
    const file = path.join(dir, name);
    try { if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file); } catch (_) {}
  }
  console.log(`Database backup created: ${final}`);
});
