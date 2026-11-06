require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const { pool } = require('./config/db');
const { getSettings } = require('./lib/settings');
const { securityHeaders } = require('./lib/security');
const { messagePage } = require('./views/public/track');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const isProd = process.env.NODE_ENV === 'production';
const app = express();

if (isProd) app.set('trust proxy', 1);
app.disable('x-powered-by');

if (!process.env.SESSION_SECRET) {
  if (isProd) {
    console.error('SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  console.warn('⚠ SESSION_SECRET is not set - using an insecure development default.');
}

app.use(securityHeaders);
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));

// Views are plain .js functions that return html`...`; res.view() sends the result.
app.use((req, res, next) => {
  res.view = (page) => res.type('html').send(String(page));
  next();
});

app.use(
  session({
    store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    name: 'ttw.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 12 },
  })
);

app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

app.use(async (req, res) => {
  const settings = await getSettings().catch(() => ({ business_name: 'Tap to Wash', tagline: '' }));
  res.status(404).view(messagePage({ settings }, { title: 'Page not found', message: 'That page does not exist - maybe it was a sock that went missing in the wash.', code: '404' }));
});

// eslint-disable-next-line no-unused-vars
app.use(async (err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return;
  if (req.originalUrl.startsWith('/api')) return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  const settings = await getSettings().catch(() => ({ business_name: 'Tap to Wash', tagline: '' }));
  res.status(500).view(messagePage({ settings }, { title: 'Something went wrong', message: 'Please try again in a moment.' }));
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`🫧 Tap to Wash running at http://localhost:${port}`));
