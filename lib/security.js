const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://www.openstreetmap.org",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
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

// Simple in-memory limiter (per IP). Fine for a single server; use a shared store if you scale out.
// With skipSuccess, a request that ends well (status below 400) is not counted, so many staff or customers on the
// same Wi-Fi or mobile network can all sign in; only wrong passwords and abuse use up the allowance.
function rateLimit({ windowMs, max, message = 'Too many attempts. Please try again later.', skipSuccess = false }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(req.ip, h);
    }
    h.count += 1;
    if (skipSuccess) {
      res.on('finish', () => {
        if (res.statusCode < 400 && h.count > 0) h.count -= 1;
      });
    }
    if (h.count > max) {
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
