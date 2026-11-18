// Restores a backup that was emailed by the app (the .json.gz.enc attachment, saved to this machine). Needs the backup password:
// set BACKUP_PASSPHRASE to the password you chose in Admin > Settings > Backups.
//   npm run db:restore -- <file>             restore into EMPTY tables only (refuses if any table already has rows)
//   npm run db:restore -- <file> --wipe      first delete everything in the backed-up tables, then restore (asks you to type the database name)
// All in one transaction: if anything fails, the database is left exactly as it was. Restart the app afterwards.
require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const zlib = require('zlib');
const { Client } = require('pg');
const { buildConfig } = require('../config/db');
const { decrypt } = require('../lib/backup');

const file = process.argv[2];
const wipe = process.argv.includes('--wipe');
const pass = process.env.BACKUP_PASSPHRASE || '';
if (!file || file.startsWith('--') || !pass || !process.env.DATABASE_URL) {
  console.error('Usage: BACKUP_PASSPHRASE (the backup password from Admin > Settings > Backups) and DATABASE_URL must be set.  node scripts/restore-json.js <file.json.gz.enc> [--wipe]');
  process.exit(1);
}
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const ask = (t) => new Promise((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(t, (a) => { rl.close(); r(a.trim()); }); });

(async () => {
  const backup = JSON.parse(zlib.gunzipSync(decrypt(fs.readFileSync(file), pass)).toString());
  if (backup.format !== 'ttw-json-backup') throw new Error('Unrecognised backup file.');
  const client = new Client({ ...(({ connectionString, ssl }) => ({ connectionString, ssl }))(buildConfig()), connectionTimeoutMillis: 15000, application_name: 'restore-json' });
  await client.connect();
  try {
    const have = new Set((await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows.map((r) => r.table_name));
    const names = Object.keys(backup.tables).filter((t) => have.has(t));
    const skipped = Object.keys(backup.tables).filter((t) => !have.has(t));
    // parents before children, from the real foreign keys
    const deps = new Map(names.map((t) => [t, new Set()]));
    const fks = await client.query(`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c WHERE c.contype = 'f'`);
    for (const { child, parent } of fks.rows) { const a = child.replace(/"/g, ''), b = parent.replace(/"/g, ''); if (a !== b && deps.has(a) && deps.has(b)) deps.get(a).add(b); }
    const order = [];
    const left = new Set(names);
    while (left.size) {
      const ready = [...left].filter((t) => [...deps.get(t)].every((d) => !left.has(d)));
      if (!ready.length) { order.push(...left); break; }
      ready.forEach((t) => { order.push(t); left.delete(t); });
    }
    console.log(`\nBackup of "${backup.database}" made ${backup.created_at}`);
    if (skipped.length) console.log(`Tables in the backup but not in this database (ignored): ${skipped.join(', ')}`);
    const { rows: [m] } = await client.query('SELECT current_database() AS db');
    console.log(`Restoring into database: ${m.db}\n`);
    if (!wipe) {
      for (const t of order) {
        const n = (await client.query(`SELECT count(*)::int AS n FROM ${q(t)}`)).rows[0].n;
        if (n) throw new Error(`Table "${t}" already has ${n} rows. Use --wipe to replace the current data with the backup.`);
      }
    } else if ((await ask(`--wipe DELETES everything now in these tables first. Type the database name (${m.db}) to continue: `)) !== m.db) {
      console.log('Cancelled. Nothing was changed.');
      return;
    }
    await client.query('BEGIN');
    try {
      if (wipe) for (const t of [...order].reverse()) await client.query(`DELETE FROM ${q(t)}`);
      let total = 0;
      for (const t of order) {
        const rows = backup.tables[t];
        for (let i = 0; i < rows.length; i += 500) {
          await client.query(`INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(null::${q(t)}, $1::json)`, [JSON.stringify(rows.slice(i, i + 500))]);
        }
        total += rows.length;
        // keep each auto-numbered column counting on from the highest restored value
        const serial = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_default LIKE 'nextval(%'`, [t]);
        for (const { column_name: col } of serial.rows) {
          const { rows: [s] } = await client.query(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [`public.${t}`, col]);
          if (s && s.seq) await client.query(`SELECT setval($1, GREATEST((SELECT COALESCE(max(${q(col)}), 0) FROM ${q(t)}), 1), (SELECT count(*) > 0 FROM ${q(t)}))`, [s.seq]);
        }
      }
      await client.query('COMMIT');
      console.log(`Restored ${total} rows into ${order.length} tables. Restart the app now.`);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
  } finally { await client.end(); }
})().catch((e) => { console.error(`Restore failed. Nothing was changed: ${e.message}`); process.exit(1); });
