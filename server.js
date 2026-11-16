require('dotenv').config();
// Render sets RENDER=true. A live site must never run in development mode (insecure cookies, no HSTS, shared rate limits).
if (process.env.RENDER && process.env.NODE_ENV !== 'production') {
  console.warn('NODE_ENV was not "production" on Render. Switching to production mode. Please set NODE_ENV=production in the environment.');
  process.env.NODE_ENV = 'production';
}
const { runStartupChecks } = require('./lib/startup-checks');
runStartupChecks();
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

app.use(compression()); // gzip html/css/js/svg: much smaller downloads on phones
app.use(securityHeaders);
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
// One merged, minified, long-cached stylesheet per area (see lib/css-bundle.js); must come before express.static.
app.use(require('./lib/css-bundle').middleware);
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
    secret: process.env.SESSION_SECRET,
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
const server = app.listen(port, () => {
  console.log(`Tap to Wash running at http://localhost:${port}`);
  // M-Pesa cannot charge cents: round any unpaid bill that still has cents to a whole number of shillings (safe to repeat).
  require('./config/db').pool
    .query("UPDATE requests SET total_amount = GREATEST(1, ROUND(total_amount)) WHERE bill_status IN ('awaiting_confirm','confirmed') AND amount_paid = 0 AND total_amount > 0 AND total_amount <> ROUND(total_amount)")
    .then((r) => r.rowCount && console.log(`Rounded ${r.rowCount} unpaid bill(s) to whole shillings.`))
    .catch((e) => console.error('Whole-shilling rounding skipped:', e.message));
  // Link WhatsApp in the background so a slow connection never delays the website.
  setTimeout(() => require('./lib/whatsapp').start().catch((e) => console.error('WhatsApp start failed:', e.message)), 3000);
  // Ask Safaricom about prompts whose callback never arrived, so a paid customer is not left "pending".
  require('./lib/stk').startReconciler();
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : `Server error: ${err.message}`);
  process.exit(1);
});

// ---------- clean shutdown and crash handling ----------
// On a redeploy (SIGTERM) or Ctrl+C: stop taking new requests, let running ones finish, close WhatsApp, email and live streams,
// then drain the PostgreSQL pool so no connection is left stuck on the database. A timer forces the exit if something hangs.
let shuttingDown = false;
function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${reason})...`);
  const force = setTimeout(() => {
    console.error('Shutdown took too long; forcing exit.');
    process.exit(exitCode || 1);
  }, 10000);
  force.unref();

  const step = (name, fn) => Promise.resolve().then(fn).catch((e) => console.error(`Shutdown: ${name} failed:`, e.message));
  (async () => {
    await step('M-Pesa job', () => require('./lib/stk').stopReconciler());
    await step('WhatsApp', () => require('./lib/whatsapp').shutdown());
    await step('email', () => require('./lib/mailer').close());
    // Stop accepting connections; end live (SSE) streams and idle keep-alive sockets so close() can finish.
    const closed = new Promise((resolve) => server.close(resolve));
    await step('live streams', () => require('./lib/live').closeAll());
    server.closeIdleConnections && server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections && server.closeAllConnections(), 5000).unref(); // requests still running after 5 s are cut
    await closed;
    await step('database pool', () => pool.end());
    console.log('Shutdown complete.');
    process.exit(exitCode);
  })();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// A rejected promise nobody handled is logged and the site keeps running (one failed background task must not take it down).
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason instanceof Error ? reason.stack || reason.message : reason);
});
// An uncaught exception leaves the process in an unknown state: log it, close cleanly, and exit non-zero so the host restarts it.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err && err.stack ? err.stack : err);
  shutdown('uncaught exception', 1);
});
