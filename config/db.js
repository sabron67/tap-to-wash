require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const isTrue = (v) => String(v || '').toLowerCase() === 'true';

// Hosted PostgreSQL (Render, Neon, Supabase, Railway…) needs SSL and often uses a certificate that
// Node cannot verify. The `pg` library lets "?sslmode=require" in the URL override our own ssl option and
// force strict verification (-> "self-signed certificate in certificate chain"), so we read the mode
// from the URL, remove it, and set ssl ourselves:
//   - local database, no sslmode ........ no SSL
//   - sslmode=require/prefer/... or PGSSL=true ... SSL on, certificate not verified (works with hosted DBs)
//   - PGSSL_CA=certs/ca.pem ............. SSL on, verified against your provider's CA file (best; Aiven)
//   - PGSSL_STRICT=true ................. SSL on with full verification using Node's built-in CAs
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

  let ssl;
  if (useSsl && env.PGSSL_CA) {
    // Provider CA certificate (e.g. Aiven's ca.pem): full verification against that certificate.
    const caFile = path.resolve(__dirname, '..', env.PGSSL_CA);
    if (!fs.existsSync(caFile)) {
      throw new Error(`PGSSL_CA points to "${env.PGSSL_CA}" but no file was found at ${caFile}`);
    }
    ssl = { ca: fs.readFileSync(caFile, 'utf8'), rejectUnauthorized: true };
  } else if (useSsl) {
    // Certificates are verified by default; PGSSL_INSECURE=true is an explicit opt-out for a provider without a CA file.
    ssl = isTrue(env.PGSSL_INSECURE) ? { rejectUnauthorized: false } : true;
  }

  return { connectionString: url, ssl, ...poolSettings(env) };
}

// Connection pool limits, so customers never queue behind each other or wait on a cold connection.
//   DB_POOL_MAX ......... most connections open at once (default 12). Sessions, pages and background jobs all share
//                         this pool. Keep it BELOW your database plan's connection limit (many free plans allow ~20-25).
//   DB_POOL_MIN ......... connections kept warm so the first visitor never pays the SSL handshake (default 2)
//   DB_IDLE_TIMEOUT_MS .. close a connection that has been idle this long (default 30000)
//   DB_CONNECT_TIMEOUT_MS  give up waiting for a free connection after this long instead of hanging (default 10000)
//   DB_STATEMENT_TIMEOUT_MS  stop one runaway query from holding a connection for ever (default 30000, 0 = no limit)
function poolSettings(env = process.env) {
  const num = (name, fallback, min) => {
    const n = parseInt(env[name], 10);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  const max = num('DB_POOL_MAX', 12, 1);
  return {
    max,
    min: Math.min(num('DB_POOL_MIN', 2, 0), max),
    idleTimeoutMillis: num('DB_IDLE_TIMEOUT_MS', 30000, 1000),
    connectionTimeoutMillis: num('DB_CONNECT_TIMEOUT_MS', 10000, 1000),
    ...(String(env.DB_STATEMENT_TIMEOUT_MS).trim() === '0' ? {} : { statement_timeout: num('DB_STATEMENT_TIMEOUT_MS', 30000, 1000) }),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };
}

const pool = new Pool(buildConfig());

pool.on('error', (err) => console.error('Unexpected PostgreSQL error:', err.message));

module.exports = { pool, buildConfig, poolSettings };
