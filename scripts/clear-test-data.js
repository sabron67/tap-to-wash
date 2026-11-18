// Before going live: wipes ALL test orders and the money recorded on them, so the system starts clean.
//
// Run it in the server console (Render: the service's Shell tab), or locally with the same DATABASE_URL in .env:
//   npm run db:clear-test-data                    shows what will be deleted, then asks you to type the database name to confirm
//   npm run db:clear-test-data -- --dry-run       only shows the counts, deletes nothing
//   npm run db:clear-test-data -- --yes           no question asked (for scripts); use with care
//   npm run db:clear-test-data -- --skip-backup   do NOT email a backup first (only when everything is test data)
//   npm run db:clear-test-data -- --customers     ALSO delete every customer and customer account (test sign-ups)
//   npm run db:clear-test-data -- --expenses      ALSO delete recorded expenses
//   npm run db:clear-test-data -- --audit         ALSO clear the admin activity log
//
// DELETED (always): requests and everything on them (items, status history, quality checks, reviews, refunds),
//   payments (cash and M-Pesa), M-Pesa STK push records, the "deleted requests" money records that the app keeps on purpose,
//   complaints, and staff alerts. Order numbers (ids) start again from 1. Discount-code "uses" counters go back to 0.
// KEPT: staff accounts and roles, settings, service categories and prices, branches, discount codes, promotions,
//   inventory, photos, WhatsApp link, and (unless you add --customers) customers and their accounts.
//
// BEFORE deleting, a full encrypted backup is emailed to the backup address set in Admin > Settings > Backups (see README > "Email backups").
// If the backup fails, NOTHING is deleted. Restore later with: npm run db:restore -- <file> --wipe
// Everything is deleted in ONE transaction: if anything fails, nothing is deleted.
require('dotenv').config();
const readline = require('readline');
const { Client } = require('pg');
const { buildConfig, pool } = require('../config/db');
const { makeBackup } = require('../lib/backup');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
if (has('--help') || has('-h')) {
  console.log('Usage: node scripts/clear-test-data.js [--dry-run] [--yes] [--skip-backup] [--customers] [--expenses] [--audit]');
  process.exit(0);
}
const dryRun = has('--dry-run') || has('-n');
const withCustomers = has('--customers');
const withExpenses = has('--expenses');
const withAudit = has('--audit');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env or the host environment first.');
  process.exit(1);
}

// [table, label]. Order matters for deleting: children before parents.
const ALWAYS = [
  ['notifications', 'staff alerts'],
  ['customer_complaints', 'complaints'],
  ['mpesa_stk', 'M-Pesa STK push records'],
  ['payments', 'payments (cash + M-Pesa)'],
  ['deleted_requests', 'deleted-request money records'],
  ['requests', 'requests (orders)'],
];
const CASCADED = [
  ['request_items', 'request items'],
  ['request_events', 'status history'],
  ['quality_inspections', 'quality checks'],
  ['refunds', 'refunds'],
  ['customer_reviews', 'reviews'],
];
const OPTIONAL = [
  ...(withExpenses ? [['expenses', 'expenses']] : []),
  ...(withAudit ? [['audit_log', 'admin activity log']] : []),
  ...(withCustomers ? [['customers', 'customers'], ['accounts', 'customer accounts']] : []),
];

const q = (s) => `"${s}"`;
const ask = (text) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(text, (a) => { rl.close(); resolve(a.trim()); });
});

(async () => {
  const cfg = buildConfig();
  const client = new Client({ connectionString: cfg.connectionString, ssl: cfg.ssl, connectionTimeoutMillis: 15000, application_name: 'clear-test-data' });
  await client.connect();
  try {
    const { rows: [meta] } = await client.query(`SELECT current_database() AS db, inet_server_addr()::text AS host`);
    const exists = async (t) => (await client.query('SELECT to_regclass($1) AS r', [`public.${t}`])).rows[0].r !== null;
    const count = async (t) => (await exists(t)) ? (await client.query(`SELECT count(*)::int AS n FROM ${q(t)}`)).rows[0].n : null;

    console.log(`\nDatabase: ${meta.db}${meta.host ? `  (server ${meta.host})` : ''}\n`);
    console.log('Rows that WILL BE DELETED:');
    let total = 0;
    for (const [t, label] of [...ALWAYS.slice().reverse(), ...CASCADED, ...OPTIONAL]) {
      const n = await count(t);
      if (n === null) continue;
      total += n;
      console.log(`  ${String(n).padStart(7)}  ${label}`);
    }
    if (await exists('payments')) {
      const { rows: [m] } = await client.query(`SELECT COALESCE(sum(amount), 0) AS paid FROM payments`);
      const { rows: [dr] } = (await exists('deleted_requests')) ? await client.query(`SELECT COALESCE(sum(amount_paid), 0) AS paid FROM deleted_requests`) : { rows: [{ paid: 0 }] };
      console.log(`\n  Money on record being erased: ${Number(m.paid).toLocaleString()} in payments + ${Number(dr.paid).toLocaleString()} on deleted requests`);
    }
    console.log('\nKept: staff, settings, services and prices, branches, discount codes, promotions, inventory, photos' + (withCustomers ? '' : ', customers and customer accounts') + (withExpenses ? '' : ', expenses') + '.');
    if (!total) { console.log('\nNothing to delete. Already clean.'); return; }
    if (dryRun) { console.log('\nDry run: nothing was deleted.'); return; }

    if (!has('--yes')) {
      console.log(has('--skip-backup') ? '\nThis cannot be undone and NO backup will be made (--skip-backup).' : '\nThis cannot be undone, but a full backup is emailed first.');
      const answer = await ask(`Type the database name (${meta.db}) to delete everything above, or press Enter to cancel: `);
      if (answer !== meta.db) { console.log('Cancelled. Nothing was deleted.'); return; }
    }

    if (!has('--skip-backup')) {
      console.log('\nEmailing a full backup first...');
      const b = await makeBackup(client);
      console.log(`Backup sent: ${b.name} (${(b.bytes / 1024).toFixed(0)} KB)\nWhere: ${b.where}`);
    }

    await client.query('BEGIN');
    try {
      for (const [t] of ALWAYS) if (await exists(t)) await client.query(`DELETE FROM ${q(t)}`); // requests cascade to items, history, quality, refunds, reviews
      for (const [t] of OPTIONAL) {
        if (!(await exists(t))) continue;
        if (t === 'customers' || t === 'accounts') continue; // handled below, in the right order
        await client.query(`DELETE FROM ${q(t)}`);
      }
      if (withCustomers) {
        if (await exists('password_resets')) await client.query(`DELETE FROM password_resets WHERE kind = 'customer'`);
        await client.query('DELETE FROM customers');
        await client.query('DELETE FROM accounts');
        // customer sign-ins held in the session table would point at accounts that no longer exist
        if (await exists('session')) await client.query(`DELETE FROM session WHERE sess::text LIKE '%"account"%'`);
      }
      if (await exists('discounts')) await client.query('UPDATE discounts SET uses = 0');
      // order numbers start again from 1
      const reset = [...ALWAYS, ...CASCADED, ...OPTIONAL].map(([t]) => t);
      for (const t of reset) {
        if (!(await exists(t))) continue;
        const { rows: [s] } = await client.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $2 AND column_name = 'id')`, [`public.${t}`, t]);
        if (s && s.seq) await client.query(`ALTER SEQUENCE ${s.seq} RESTART WITH 1`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    console.log('\nDone. All test requests and money records are deleted.');
    console.log('Restart the app (on Render: Manual Deploy > Restart service) so its dashboard caches and live screens start fresh.');
  } finally {
    await client.end();
    await pool.end(); // opened when the backup email settings were read
  }
})().catch((err) => {
  console.error('\nFailed. Nothing was deleted:', err.message);
  if (/backup|email|password/i.test(err.message)) console.error('(Fix the backup problem above, or add --skip-backup if everything in the database is test data.)');
  process.exit(1);
});
