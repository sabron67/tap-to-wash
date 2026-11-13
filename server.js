require('dotenv').config();
// Render sets RENDER=true. A live site must never run in development mode (insecure cookies, no HSTS, shared rate limits).
if (process.env.RENDER && process.env.NODE_ENV !== 'production') {
  console.warn('NODE_ENV was not "production" on Render. Switching to production mode. Please set NODE_ENV=production in the environment.');
  process.env.NODE_ENV = 'production';
}
const path = require('path');
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const { pool } = require('./config/db');
const { getSettings } = require('./lib/settings');
const { securityHeaders } = require('./lib/security');
const { messagePage } = require('./views/public/track');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const { staffRouter } = adminRoutes;
const accountRoutes = require('./routes/account');
const payCallback = require('./routes/pay-callback');
const { slotMiddleware, newSlotId } = require('./lib/slots');
const { liveHook } = require('./lib/live');

const isProd = process.env.NODE_ENV === 'production';
const app = express();

if (isProd) app.set('trust proxy', 1);
// Behind the host's proxy, send plain-HTTP page requests to HTTPS (requests with no proxy header, such as internal health checks, are left alone).
if (isProd && process.env.FORCE_HTTPS !== '0') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'http') return next();
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    return res.status(403).type('text').send('HTTPS is required.');
  });
}
app.disable('x-powered-by');

if (!process.env.SESSION_SECRET) {
  if (isProd) {
    console.error('SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  console.warn('WARNING: SESSION_SECRET is not set - using an insecure development default.');
}

app.use(compression()); // gzip html/css/js/svg: much smaller downloads on phones
app.use(securityHeaders);
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(
  express.static(path.join(__dirname, 'public'), {
    // pictures cache for a week; css/js are re-checked (cheap 304) so an update shows up straight away
    setHeaders: (res, file) => {
      res.setHeader('Cache-Control', /\.(css|js)$/.test(file) || !isProd ? 'no-cache' : 'public, max-age=604800');
    },
  })
);

// M-Pesa STK push callback: called by Safaricom with no cookies, so it sits before the session middleware.
app.use('/pay', payCallback);

// Views are plain .js functions that return html`...`; res.view() sends the result.
app.use((req, res, next) => {
  res.view = (page) => res.type('html').send(res.prefixHtml ? res.prefixHtml(page) : String(page));
  next();
});

const sessionStore = new PgSession({ pool, tableName: 'session', createTableIfMissing: true });
// express-session assigns `store.generate` (which holds that middleware's cookie options, including the cookie path) on
// the store object it is given. With one shared store, every new login slot overwrote it, so sessions created afterwards
// in OTHER slots - customers' /account session included - were issued a cookie scoped to the wrong path. The browser never
// sent it back, the CSRF check failed and the form was wiped. Each middleware therefore gets its own thin view of the
// store: reads and writes still go to the same PostgreSQL session table, but `generate` (and `regenerate`, which calls it)
// are private to that middleware. (Proxy, not Object.create: connect-pg-simple uses private class fields.)
function storeView(base) {
  let generate;
  return new Proxy(base, {
    get(target, prop) {
      if (prop === 'generate') return generate;
      if (prop === 'regenerate') return (req, fn) => target.destroy(req.sessionID, (err) => { generate(req); fn(err); });
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, prop, value) {
      if (prop === 'generate') generate = value;
      else target[prop] = value;
      return true;
    },
  });
}
const buildSession = (name, cookiePath) =>
  session({
    store: storeView(sessionStore),
    name,
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true, // idle timeout: the cookie is renewed on every request and expires after 2 hours of inactivity
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, path: cookiePath, maxAge: 1000 * 60 * 60 * 2 },
  });
// Each login runs in its own session (see lib/slots.js), so several people can sign in in one browser.
app.use(slotMiddleware(buildSession));
app.use(liveHook); // announces committed order changes to the live channels

// "Sign in as another user": opens a fresh, separate login so the current one stays signed in.
app.get('/admin/another', (req, res) => {
  const door = req.query.door === 'admin' ? '/admin/login' : '/staff';
  res.set('Cache-Control', 'no-store').redirect(302, `/${newSlotId()}${door}`);
});

app.use('/admin', adminRoutes);
app.use('/staff', staffRouter); // staff sign-in page (every role except the owner)
app.use('/account', accountRoutes);
app.use('/', publicRoutes);

app.use(async (req, res) => {
  const settings = await getSettings().catch(() => ({ business_name: 'Tap to Wash', tagline: '' }));
  res.status(404).view(messagePage({ settings }, { title: 'Page not found', message: 'That page does not exist - maybe it was a sock that went missing in the wash.', code: '404' }));
});

// eslint-disable-next-line no-unused-vars
app.use(async (err, req, res, next) => {
  const clientErr = err && err.status >= 400 && err.status < 500;
  if (!clientErr) console.error(err);
  if (res.headersSent) return;
  const cleanUrl = req.cleanUrl || req.originalUrl;
  if (cleanUrl.startsWith('/api') || cleanUrl.startsWith('/admin/api') || cleanUrl.startsWith('/admin/photos') || cleanUrl.startsWith('/admin/settings/favicon')) {
    return res.status(clientErr ? err.status : 500).json({ ok: false, error: clientErr ? 'That request could not be processed (too large or malformed).' : 'Something went wrong. Please try again.' });
  }
  const settings = await getSettings().catch(() => ({ business_name: 'Tap to Wash', tagline: '' }));
  res.status(500).view(messagePage({ settings }, { title: 'Something went wrong', message: 'Please try again in a moment.' }));
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Tap to Wash running at http://localhost:${port}`);
  // Link WhatsApp in the background so a slow connection never delays the website.
  setTimeout(() => require('./lib/whatsapp').start().catch((e) => console.error('WhatsApp start failed:', e.message)), 3000);
});
