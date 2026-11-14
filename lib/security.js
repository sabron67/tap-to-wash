const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://www.openstreetmap.org",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isProd ? ['upgrade-insecure-requests'] : []),
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  next();
}

// Rate limiter shared through PostgreSQL (table rate_hits), so limits survive restarts and hold across several servers.
// If the database is unreachable it falls back to an in-memory counter instead of failing open.
// With skipSuccess, a request that ends well (status below 400) is not counted.
let poolRef;
const getPool = () => (poolRef = poolRef || require('../config/db').pool);
let cleanedAt = 0;

function rateLimit({ windowMs, max, message = 'Too many attempts. Please try again later.', skipSuccess = false, name = '' }) {
  const mem = new Map();
  const id = name || `${windowMs}:${max}:${message.length}:${skipSuccess}`;
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of mem) if (v.reset < now) mem.delete(k);
  }, windowMs).unref();

  const memHit = (ip) => {
    const now = Date.now();
    let h = mem.get(ip);
    if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; mem.set(ip, h); }
    h.count += 1;
    return h.count;
  };

  return async (req, res, next) => {
    const key = `${id}|${req.ip}`;
    let count;
    let viaDb = true;
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `INSERT INTO rate_hits (key, hits, reset_at) VALUES ($1, 1, now() + ($2 || ' milliseconds')::interval)
         ON CONFLICT (key) DO UPDATE SET
           hits = CASE WHEN rate_hits.reset_at < now() THEN 1 ELSE rate_hits.hits + 1 END,
           reset_at = CASE WHEN rate_hits.reset_at < now() THEN now() + ($2 || ' milliseconds')::interval ELSE rate_hits.reset_at END
         RETURNING hits`,
        [key, String(windowMs)]
      );
      count = rows[0].hits;
      if (Date.now() - cleanedAt > 10 * 60 * 1000) {
        cleanedAt = Date.now();
        pool.query('DELETE FROM rate_hits WHERE reset_at < now()').catch(() => {});
      }
    } catch (e) {
      viaDb = false;
      count = memHit(req.ip);
    }
    if (skipSuccess) {
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        if (viaDb) getPool().query('UPDATE rate_hits SET hits = GREATEST(hits - 1, 0) WHERE key = $1', [key]).catch(() => {});
        else { const h = mem.get(req.ip); if (h && h.count > 0) h.count -= 1; }
      });
    }
    if (count > max) {
      res.status(429);
      return (req.cleanUrl || req.originalUrl).startsWith('/api') ? res.json({ ok: false, error: message }) : res.send(message);
    }
    next();
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Admin pages must never be cached or indexed.
function adminNoCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
}

// Where to send someone after a stale form: the page they were on (taken from Referer, same site only,
// login prefix removed because res.redirect adds it back), or the fallback.
function backPath(req, fallback) {
  try {
    const ref = req.get('referer');
    if (!ref) return fallback;
    const u = new URL(ref);
    if (u.host !== req.get('host')) return fallback;
    const path = u.pathname.replace(/^\/s_[a-z0-9]{6,24}(?=\/|$)/, '') || '/';
    return /^\/(admin|staff|account)(\/|$)/.test(path) ? path + u.search : fallback;
  } catch (e) {
    return fallback;
  }
}

module.exports = { securityHeaders, rateLimit, safeEqual, adminNoCache, backPath };
