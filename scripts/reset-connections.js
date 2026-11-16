// Emergency: closes stuck or leaked PostgreSQL connections to this app's database, so the pool can start clean.
// Use it when the site hangs with "timeout exceeded when trying to connect", "too many clients already",
// or "remaining connection slots are reserved" (the database plan's connection limit has been reached).
//
// Run on the server (or locally with the same DATABASE_URL in .env):
//   npm run db:reset-connections                 close idle and idle-in-transaction connections (safe, default)
//   npm run db:reset-connections -- --dry-run    only list the connections, close nothing
//   npm run db:reset-connections -- --older 60   only those idle / in the same state for more than 60 seconds
//   npm run db:reset-connections -- --all        close EVERY other connection, including queries still running
//
// Notes:
// - This script opens one connection of its own and never closes itself.
// - The running app is not restarted. Its pool drops the closed connections (a one-line "Unexpected PostgreSQL
//   error ... terminating connection" message in the log is normal) and opens fresh ones on the next request.
// - --all can interrupt an order, payment or STK push that is being written at that moment. Use it only when
//   the site is already stuck, and ideally restart the app afterwards.
// - A database user can only close its own connections unless it is a superuser or has pg_signal_backend.
require('dotenv').config();
const { Client } = require('pg');
const { buildConfig } = require('../config/db');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const dryRun = has('--dry-run') || has('-n');
const all = has('--all');
const olderIdx = args.indexOf('--older');
const olderSecs = olderIdx >= 0 ? parseInt(args[olderIdx + 1], 10) : 0;

if (has('--help') || has('-h')) {
  console.log('Usage: node scripts/reset-connections.js [--dry-run] [--older <seconds>] [--all]');
  process.exit(0);
}
if (olderIdx >= 0 && !(olderSecs >= 0)) {
  console.error('--older needs a number of seconds, for example: --older 60');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add it to .env or the host environment first.');
  process.exit(1);
}

const fmt = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${n % 60}s`;
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
};

(async () => {
  const cfg = buildConfig();
  const client = new Client({ connectionString: cfg.connectionString, ssl: cfg.ssl, connectionTimeoutMillis: 15000, application_name: 'reset-connections' });
  await client.connect();

  const { rows: [meta] } = await client.query(
    `SELECT current_database() AS db, current_user AS me,
            (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn,
            (SELECT count(*)::int FROM pg_stat_activity) AS in_use`);
  console.log(`Database: ${meta.db}  |  connected as: ${meta.me}  |  connections in use: ${meta.in_use} of ${meta.max_conn}`);

  const conditions = [`datname = current_database()`, `pid <> pg_backend_pid()`, `backend_type = 'client backend'`];
  const params = [];
  if (!all) conditions.push(`state IN ('idle', 'idle in transaction', 'idle in transaction (aborted)', 'disabled')`);
  if (olderSecs > 0) { params.push(olderSecs); conditions.push(`now() - COALESCE(state_change, backend_start) > ($${params.length} || ' seconds')::interval`); }

  const { rows } = await client.query(
    `SELECT pid, usename, COALESCE(NULLIF(application_name, ''), '-') AS app, COALESCE(client_addr::text, 'local') AS addr,
            COALESCE(state, 'unknown') AS state,
            EXTRACT(EPOCH FROM now() - COALESCE(state_change, backend_start)) AS secs,
            left(regexp_replace(COALESCE(query, ''), '\\s+', ' ', 'g'), 70) AS query
       FROM pg_stat_activity
      WHERE ${conditions.join(' AND ')}
      ORDER BY secs DESC`, params);

  if (!rows.length) {
    console.log(all ? 'No other connections found.' : 'No idle or stuck connections found. Nothing to close.' + (olderSecs ? ` (filter: older than ${olderSecs}s)` : ''));
    await client.end();
    return;
  }

  console.log(`\n${rows.length} connection(s) ${dryRun ? 'that would be closed' : 'to close'}${all ? ' (ALL states)' : ''}:`);
  for (const r of rows) {
    console.log(`  pid ${String(r.pid).padEnd(7)} ${String(r.usename).padEnd(14)} ${r.state.padEnd(22)} ${fmt(r.secs).padStart(8)}  ${r.app}  ${r.addr}  ${r.query}`);
  }

  if (dryRun) {
    console.log('\nDry run: nothing was closed. Run again without --dry-run to close them.');
    await client.end();
    return;
  }

  let closed = 0;
  const failed = [];
  for (const r of rows) {
    try {
      const { rows: [res] } = await client.query('SELECT pg_terminate_backend($1) AS ok', [r.pid]);
      if (res.ok) closed++; else failed.push({ pid: r.pid, why: 'already gone' });
    } catch (e) {
      failed.push({ pid: r.pid, why: e.message });
    }
  }

  const { rows: [after] } = await client.query('SELECT count(*)::int AS in_use FROM pg_stat_activity');
  console.log(`\nClosed ${closed} of ${rows.length} connection(s). Connections now in use: ${after.in_use} of ${meta.max_conn}.`);
  if (failed.length) {
    console.log('Could not close:');
    for (const f of failed) console.log(`  pid ${f.pid}: ${f.why}`);
    console.log('Connections owned by another database user need a superuser or the pg_signal_backend role.');
  }
  console.log('The app pool reconnects by itself on the next request. Restart the app only if it is still stuck.');
  await client.end();
})().catch((e) => { console.error('Could not reset connections:', e.message); process.exit(1); });
