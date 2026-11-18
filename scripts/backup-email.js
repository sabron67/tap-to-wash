// Backs up the whole database and emails it (encrypted) to the address set in Admin > Settings > Backups. No pg_dump needed.
//   npm run db:backup:email                  export, encrypt, email
//   npm run db:backup:email -- --local       save to the backups/ folder on this machine instead (not for Render: its disk is wiped on restart)
// The email server, the recipient and the backup password are read from the settings saved in the admin page.
// Restore with: npm run db:restore -- <file.json.gz.enc>
require('dotenv').config();
const path = require('path');
const { Client } = require('pg');
const { buildConfig, pool } = require('../config/db');
const { makeBackup } = require('../lib/backup');

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
(async () => {
  const cfg = buildConfig();
  const client = new Client({ connectionString: cfg.connectionString, ssl: cfg.ssl, connectionTimeoutMillis: 15000, application_name: 'backup-email' });
  await client.connect();
  try {
    const r = await makeBackup(client, { localDir: process.argv.includes('--local') ? path.resolve(process.env.BACKUP_DIR || 'backups') : '' });
    const rows = Object.values(r.counts).reduce((a, b) => a + b, 0);
    console.log(`Backup made: ${r.name} (${(r.bytes / 1024).toFixed(0)} KB, ${rows} rows in ${Object.keys(r.counts).length} tables)\nWhere: ${r.where}`);
  } finally {
    await client.end();
    await pool.end();
  }
})().catch((e) => { console.error(`Backup failed: ${e.message}`); process.exit(1); });
