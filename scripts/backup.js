// PostgreSQL custom-format backup. Requires pg_dump on the host.
process.env.DB_STATEMENT_TIMEOUT_MS = '0'; // set-up and backup scripts may run long queries
require('dotenv').config();
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const dir = path.resolve(process.env.BACKUP_DIR || 'backups');
const keepDays = Math.max(1, Number(process.env.BACKUP_KEEP_DAYS) || 14);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(dir, `taptowash-${stamp}.dump`);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
execFile('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', output, url], { timeout: 15 * 60 * 1000 }, (error, stdout, stderr) => {
  if (error) {
    console.error(`Backup failed: ${stderr || error.message}`);
    try { fs.unlinkSync(output); } catch (_) {}
    process.exitCode = 1;
    return;
  }
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    if (!/^taptowash-.*\.dump$/.test(name)) continue;
    const file = path.join(dir, name);
    try { if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file); } catch (_) {}
  }
  console.log(`Database backup created: ${output}`);
});
