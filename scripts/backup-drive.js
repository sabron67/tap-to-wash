// Backs up the whole database to the admin's Google Drive (encrypted). No pg_dump needed.
//   npm run db:backup:drive                  export, encrypt, upload to Google Drive
//   npm run db:backup:drive -- --local       save to the backups/ folder on this machine instead (not for Render: its disk is wiped on restart)
// Restore with: npm run db:restore -- <file.json.gz.enc>
require('dotenv').config();
const path = require('path');
const { Client } = require('pg');
const { buildConfig } = require('../config/db');
const { makeBackup } = require('../lib/drive-backup');

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
(async () => {
  const cfg = buildConfig();
  const client = new Client({ connectionString: cfg.connectionString, ssl: cfg.ssl, connectionTimeoutMillis: 15000, application_name: 'backup-drive' });
  await client.connect();
  try {
    const r = await makeBackup(client, { localDir: process.argv.includes('--local') ? path.resolve(process.env.BACKUP_DIR || 'backups') : '' });
    const rows = Object.values(r.counts).reduce((a, b) => a + b, 0);
    console.log(`Backup saved: ${r.name} (${(r.bytes / 1024).toFixed(0)} KB, ${rows} rows in ${Object.keys(r.counts).length} tables)\nWhere: ${r.where}${r.link ? `\nLink: ${r.link}` : ''}`);
  } finally { await client.end(); }
})().catch((e) => { console.error(`Backup failed: ${e.message}`); process.exit(1); });
