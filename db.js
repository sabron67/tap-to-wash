require('dotenv').config();
const { Pool } = require('pg');

const isTrue = (v) => String(v || '').toLowerCase() === 'true';

// Hosted PostgreSQL (Render, Neon, Supabase, Railway…) needs SSL and often uses a certificate that
// Node cannot verify. The `pg` library lets "?sslmode=require" in the URL override our own ssl option and
// force strict verification (-> "self-signed certificate in certificate chain"), so we read the mode
// from the URL, remove it, and set ssl ourselves:
//   - local database, no sslmode ........ no SSL
//   - sslmode=require/prefer/... or PGSSL=true ... SSL on, certificate not verified (works with hosted DBs)
//   - PGSSL_STRICT=true ................. SSL on with full certificate verification
function buildConfig(env = process.env) {
  let url = env.DATABASE_URL || '';
  const match = url.match(/[?&]sslmode=([^&#]*)/i);
  const mode = match ? decodeURIComponent(match[1]).toLowerCase() : '';

  url = url
    .replace(/([?&])(sslmode|ssl|uselibpqcompat|sslrootcert|sslcert|sslkey)=[^&#]*/gi, '$1')
    .replace(/[?&]+$/, '')
    .replace(/\?&/, '?')
    .replace(/&&+/g, '&');

  const useSsl = mode ? mode !== 'disable' : isTrue(env.PGSSL);
  const ssl = useSsl ? (isTrue(env.PGSSL_STRICT) ? true : { rejectUnauthorized: false }) : undefined;

  return { connectionString: url, ssl };
}

const pool = new Pool(buildConfig());

pool.on('error', (err) => console.error('Unexpected PostgreSQL error:', err.message));

module.exports = { pool, buildConfig };
