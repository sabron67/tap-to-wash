// Optional customer accounts. Guests keep working exactly as before; an account just adds history and saved details.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { getSettings } = require('../lib/settings');
const { rateLimit, safeEqual } = require('../lib/security');
const { passwordProblem } = require('../lib/password');
const { wrap, phoneKey, validPhone, cleanText } = require('../lib/helpers');
const { authPage, accountPage } = require('../views/public/account');
const { trackPage } = require('../views/public/track');
const { receiptPage } = require('../views/admin/receipt');
const { forgotPage, resetPage } = require('../views/public/reset');
const { requestCode, completeReset, problemMessage, TTL_MINUTES } = require('../lib/reset');

const router = express.Router();
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: +process.env.LOGIN_MAX || 15, message: 'Too many attempts. Please wait a few minutes.' });

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  if (req.method === 'POST' && !safeEqual(req.body && req.body._csrf, req.session.csrf)) {
    return res.status(403).send('Your form expired. Go back, refresh the page and try again.');
  }
  next();
});

const flash = (req, type, msg) => {
  req.session.aflash = { type, msg };
};

async function pubCtx(req) {
  const f = req.session.aflash;
  delete req.session.aflash;
  return { settings: await getSettings(), account: req.session.account, csrf: req.session.csrf, flash: f };
}

const safeNext = (n) => (n === '/' || n === '/account' ? n : '');

function startSession(req, res, next, acc, remember, to, welcome) {
  const keepAdmin = req.session.admin; // signing in as a customer must not sign a staff member out
  req.session.regenerate((err) => {
    if (err) return next(err);
    if (keepAdmin) req.session.admin = keepAdmin;
    req.session.csrf = crypto.randomBytes(24).toString('hex');
    req.session.account = { id: acc.id, name: acc.name, email: acc.email, since: Date.now() };
    if (remember) req.session.cookie.maxAge = REMEMBER_MS;
    if (welcome) req.session.aflash = { type: 'success', msg: welcome };
    req.session.save((err2) => (err2 ? next(err2) : res.redirect(to)));
  });
}

// ---------- sign up / sign in ----------
router.get(
  '/login',
  wrap(async (req, res) => {
    if (req.session.account) return res.redirect('/account');
    res.view(authPage(await pubCtx(req), { mode: 'login', next: safeNext(req.query.next) }));
  })
);
router.get(
  '/signup',
  wrap(async (req, res) => {
    if (req.session.account) return res.redirect('/account');
    res.view(authPage(await pubCtx(req), { mode: 'signup' }));
  })
);

router.post(
  '/signup',
  authLimit,
  wrap(async (req, res, next) => {
    const b = req.body;
    const name = cleanText(b.name, 80);
    const email = cleanText(b.email, 120).toLowerCase();
    const phone = cleanText(b.phone, 20);
    const values = { name, email, phone };
    const fail = async (error) => res.status(400).view(authPage(await pubCtx(req), { mode: 'signup', error, values }));

    if (name.length < 2) return fail('Please enter your name.');
    if (!EMAIL_RE.test(email)) return fail('Please enter a valid email address.');
    if (phone && !validPhone(phone)) return fail('Please enter a valid phone number, or leave it empty.');
    const problem = passwordProblem(b.password, { email, name });
    if (problem) return fail(problem);
    if (b.password !== b.confirm) return fail('The passwords do not match.');
    if (b.accept !== '1') return fail('Please accept the Terms of Service and Privacy Notice.');

    const settings = await getSettings();
    const hash = await bcrypt.hash(String(b.password), 12);
    try {
      const ins = await pool.query(
        `INSERT INTO accounts (name, email, phone, password_hash, terms_version, accepted_at, last_login_at) VALUES ($1,$2,$3,$4,$5, now(), now()) RETURNING id, name, email`,
        [name, email, phone, hash, Number(settings.terms_version) || 1]
      );
      startSession(req, res, next, ins.rows[0], true, safeNext(b.next) || '/account', 'Your account is ready. Welcome!');
    } catch (err) {
      if (err.code === '23505') return fail('An account with that email already exists. Try signing in instead.');
      throw err;
    }
  })
);

router.post(
  '/login',
  authLimit,
  wrap(async (req, res, next) => {
    const email = cleanText(req.body.email, 120).toLowerCase();
    const password = String(req.body.password || '').slice(0, 200);
    const { rows } = await pool.query('SELECT id, name, email, is_active, password_hash, failed_attempts, locked_until FROM accounts WHERE email = $1', [email]);
    const a = rows[0];
    const match = await bcrypt.compare(password, a ? a.password_hash : DUMMY_HASH);
    const fail = async (status, error) => res.status(status).view(authPage(await pubCtx(req), { mode: 'login', error, values: { email }, next: safeNext(req.body.next) }));

    if (a && a.locked_until && new Date(a.locked_until) > new Date()) return fail(429, 'Too many failed attempts. Please try again in a few minutes.');
    if (!a || !match) {
      if (a) {
        const fails = a.failed_attempts + 1;
        const lock = fails >= MAX_FAILS;
        await pool.query('UPDATE accounts SET failed_attempts = $1, locked_until = $2 WHERE id = $3', [lock ? 0 : fails, lock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null, a.id]);
      }
      return fail(401, 'Incorrect email or password.');
    }
    if (!a.is_active) return fail(403, 'This account has been disabled. Please contact us.');
    await pool.query('UPDATE accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [a.id]);
    startSession(req, res, next, a, req.body.remember === '1', safeNext(req.body.next) || '/account');
  })
);

// ---------- forgot / reset password (code sent by WhatsApp) ----------
const UNAVAILABLE = 'Automatic reset codes are not available right now. Please contact us on WhatsApp or by phone and we will reset your password for you.';
const SENT = `We have sent a 6-digit code to the WhatsApp number saved on your account. It works for ${TTL_MINUTES} minutes.`;

router.get(
  '/forgot',
  wrap(async (req, res) => {
    if (req.session.account) return res.redirect('/account');
    res.view(forgotPage(await pubCtx(req), 'customer'));
  })
);

router.post(
  '/forgot',
  authLimit,
  wrap(async (req, res) => {
    const email = cleanText(req.body.email, 120).toLowerCase();
    const ctx = await pubCtx(req);
    if (!EMAIL_RE.test(email)) return res.status(400).view(forgotPage(ctx, 'customer', { error: 'Please enter a valid email address.', email }));
    const r = await requestCode('customer', email, ctx.settings.business_name);
    if (r.problem) return res.status(r.problem === 'wait' ? 429 : 400).view(forgotPage(ctx, 'customer', { error: problemMessage(r.problem, 'customer'), email }));
    if (!r.available) return res.view(forgotPage(ctx, 'customer', { error: UNAVAILABLE, email }));
    res.view(resetPage(ctx, 'customer', { info: SENT, email }));
  })
);

router.get(
  '/reset',
  wrap(async (req, res) => {
    if (req.session.account) return res.redirect('/account');
    res.view(resetPage(await pubCtx(req), 'customer', { email: cleanText(req.query.email, 120) }));
  })
);

router.post(
  '/reset',
  authLimit,
  wrap(async (req, res) => {
    const b = req.body;
    const email = cleanText(b.email, 120).toLowerCase();
    const r = await completeReset('customer', email, b.code, b.password, b.confirm);
    if (!r.ok) return res.status(400).view(resetPage(await pubCtx(req), 'customer', { error: r.error, email }));
    flash(req, 'success', 'Your password was updated. Please sign in.');
    res.redirect('/account/login');
  })
);

router.post('/logout', (req, res) => {
  if (req.session.admin) {
    delete req.session.account; // keep a staff member signed in
    return res.redirect('/');
  }
  req.session.destroy(() => res.redirect('/'));
});

// ---------- everything below needs a signed-in customer ----------
router.use(
  wrap(async (req, res, next) => {
    const a = req.session.account;
    if (!a) return res.redirect('/account/login');
    const { rows } = await pool.query('SELECT name, email, is_active FROM accounts WHERE id = $1', [a.id]);
    if (!rows.length || !rows[0].is_active) {
      delete req.session.account;
      return res.redirect('/account/login');
    }
    a.name = rows[0].name;
    a.email = rows[0].email;
    next();
  })
);

const loadAccount = async (id) => (await pool.query('SELECT id, name, email, phone, must_change_password FROM accounts WHERE id = $1', [id])).rows[0];

router.use(
  wrap(async (req, res, next) => {
    // A temporary password has to be replaced before anything else.
    const acc = await loadAccount(req.session.account.id);
    req.acc = acc;
    if (acc.must_change_password && !(req.method === 'POST' && req.path === '/password') && !(req.method === 'GET' && req.path === '/') && req.path !== '/logout') {
      return res.redirect('/account');
    }
    next();
  })
);

router.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.ref_code, r.status, r.created_at,
              (SELECT string_agg(i.category_name || ' ×' || i.quantity, ', ' ORDER BY i.id) FROM request_items i WHERE i.request_id = r.id) AS items
         FROM requests r WHERE r.account_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
      [req.acc.id]
    );
    res.view(accountPage(await pubCtx(req), { account: req.acc, requests: rows }));
  })
);

router.post(
  '/profile',
  wrap(async (req, res) => {
    const name = cleanText(req.body.name, 80);
    const phone = cleanText(req.body.phone, 20);
    if (name.length < 2) flash(req, 'error', 'Please enter your name.');
    else if (phone && !validPhone(phone)) flash(req, 'error', 'Please enter a valid phone number, or leave it empty.');
    else {
      await pool.query('UPDATE accounts SET name = $1, phone = $2 WHERE id = $3', [name, phone, req.acc.id]);
      flash(req, 'success', 'Details saved.');
    }
    res.redirect('/account');
  })
);

router.post(
  '/password',
  wrap(async (req, res) => {
    const { current, password, confirm } = req.body;
    const { rows } = await pool.query('SELECT password_hash, name, email FROM accounts WHERE id = $1', [req.acc.id]);
    const problem = passwordProblem(password, rows[0]);
    if (!(await bcrypt.compare(String(current || ''), rows[0].password_hash))) flash(req, 'error', 'Your current password is incorrect.');
    else if (problem) flash(req, 'error', problem);
    else if (password !== confirm) flash(req, 'error', 'The new passwords do not match.');
    else if (password === current) flash(req, 'error', 'The new password must be different from the current one.');
    else {
      await pool.query('UPDATE accounts SET password_hash = $1, must_change_password = FALSE, failed_attempts = 0, locked_until = NULL WHERE id = $2', [await bcrypt.hash(password, 12), req.acc.id]);
      flash(req, 'success', 'Password updated.');
    }
    res.redirect('/account');
  })
);

// Attach an earlier guest order: needs the reference code AND the phone number used (same proof as the track page).
router.post(
  '/claim',
  authLimit,
  wrap(async (req, res) => {
    const ref = cleanText(req.body.ref, 20).toUpperCase();
    const phone = cleanText(req.body.phone, 20);
    const { rows } = await pool.query(
      `SELECT r.id, r.account_id, c.phone_key FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.ref_code = $1`,
      [ref]
    );
    const r = rows[0];
    if (!r || !validPhone(phone) || r.phone_key !== phoneKey(phone) || (r.account_id && r.account_id !== req.acc.id)) {
      flash(req, 'error', 'We could not match that reference code and phone number. Please check and try again.');
    } else {
      await pool.query('UPDATE requests SET account_id = $1 WHERE id = $2', [req.acc.id, r.id]);
      flash(req, 'success', `Order ${ref} was added to your account.`);
    }
    res.redirect('/account');
  })
);

router.get(
  '/requests/:ref',
  wrap(async (req, res, next) => {
    const ref = cleanText(req.params.ref, 20).toUpperCase();
    const { rows } = await pool.query('SELECT id, ref_code, status FROM requests WHERE ref_code = $1 AND account_id = $2', [ref, req.acc.id]);
    if (!rows.length) return next();
    const r = rows[0];
    const [items, events] = await Promise.all([
      pool.query('SELECT category_name, quantity FROM request_items WHERE request_id = $1 ORDER BY id', [r.id]),
      pool.query('SELECT status, note, created_at FROM request_events WHERE request_id = $1 ORDER BY created_at DESC, id DESC', [r.id]),
    ]);
    const ctx = { ...(await pubCtx(req)), accountPhone: req.acc.phone || '' };
    res.view(trackPage(ctx, { ref, result: { ref_code: r.ref_code, status: r.status, items: items.rows, events: events.rows, receipt_href: `/account/requests/${r.ref_code}/receipt` } }));
  })
);

router.get(
  '/requests/:ref/receipt',
  wrap(async (req, res, next) => {
    const ref = cleanText(req.params.ref, 20).toUpperCase();
    const { rows } = await pool.query(
      'SELECT r.*, c.name AS customer_name, c.phone AS customer_phone FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.ref_code = $1 AND r.account_id = $2',
      [ref, req.acc.id]
    );
    if (!rows.length) return next();
    const items = await pool.query('SELECT i.category_name, i.quantity, c.icon, c.price, c.unit FROM request_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.request_id = $1 ORDER BY i.id', [rows[0].id]);
    const ctx = await pubCtx(req);
    res.view(receiptPage(ctx, { request: rows[0], items: items.rows, backHref: `/account/requests/${ref}`, backLabel: 'Back' }));
  })
);

router.post(
  '/delete',
  wrap(async (req, res, next) => {
    const { rows } = await pool.query('SELECT password_hash FROM accounts WHERE id = $1', [req.acc.id]);
    if (!(await bcrypt.compare(String(req.body.password || ''), rows[0].password_hash))) {
      flash(req, 'error', 'Enter your password to delete your account.');
      return res.redirect('/account');
    }
    await pool.query('DELETE FROM accounts WHERE id = $1', [req.acc.id]); // requests keep existing; account_id is set to NULL
    delete req.session.account;
    if (req.session.admin) return res.redirect('/');
    req.session.destroy(() => res.redirect('/'));
    void next;
  })
);

module.exports = router;
