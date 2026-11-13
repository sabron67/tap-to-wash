const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { getSettings, saveSettings } = require('../lib/settings');
const { validateMpesa } = require('../lib/mpesa');
const { rateLimit, safeEqual, adminNoCache, backPath } = require('../lib/security');
const { audit } = require('../lib/audit');
const { passwordProblem } = require('../lib/password');
const { wrap, STATUS_MAP, cleanText, cleanMultiline, backwardBlocker } = require('../lib/helpers');
const { categoryIconName } = require('../lib/icons');
const { mediaVersions } = require('../lib/media');
const { can, roleOf, visibleStatuses, settableStatuses, riderSql, riderMayView } = require('../lib/roles');
const { pickupBlocker, GATED_TARGETS, autoBill, advanceIfPaid } = require('../lib/bill');
const live = require('../lib/live');
const { autoAssignRider } = require('../lib/dispatch');
const { ROUTES, eventFor, notifyEvent, recipientsFor, teamMessage, customerMessage, HEADLINES } = require('../lib/notify');
const { waLink, canSend: waCanSend } = require('../lib/whatsapp');
const { PORTALS, loginUrlForRole, portalHint, loginUrlFromHint } = require('../lib/portal');

const { loginPage } = require('../views/admin/login');
const { dashboardPage } = require('../views/admin/dashboard');
const { requestsPage, requestDetailPage } = require('../views/admin/requests');
const { categoriesPage } = require('../views/admin/categories');
const { customersPage } = require('../views/admin/customers');
const { settingsPage } = require('../views/admin/settings');
const { accountPage } = require('../views/admin/account');
const { forbiddenPage } = require('../views/admin/forbidden');
const { forgotPage, resetPage } = require('../views/public/reset');
const { requestCode, completeReset, problemMessage, TTL_MINUTES } = require('../lib/reset');

const router = express.Router();
router.use(adminNoCache);
const PAGE_SIZE = 20;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12); // keeps login timing the same for unknown emails
const NAIROBI_TODAY = `(now() AT TIME ZONE 'Africa/Nairobi')::date`;

// Sign-in only: a successful sign-in is not counted, so several staff on the shop Wi-Fi can all sign in.
const signinLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: +process.env.LOGIN_MAX || 12, message: 'Too many sign-in attempts. Please wait a few minutes.', skipSuccess: true });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: +process.env.LOGIN_MAX || 12, message: 'Too many sign-in attempts. Please wait a few minutes.' });

// ---------- session helpers ----------
const ensureCsrf = (req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  next();
};
const checkCsrf = (req, res, next) => {
  const sent = req.get('x-csrf-token') || (req.body && req.body._csrf);
  if (req.method === 'POST' && !safeEqual(sent, req.session.csrf)) {
    const isFetch = !!req.get('x-csrf-token') || /^\/(api|admin\/api|admin\/photos|admin\/categories\/|admin\/settings\/favicon)/.test(req.cleanUrl || req.originalUrl);
    if (isFetch) return res.status(403).json({ ok: false, error: 'Your session expired. Refresh the page and try again.' });
    // A normal form: do not leave the person on a dead-end page.
    if (!req.session.admin) {
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      flash(req, 'warn', 'Your session ended. Please sign in again.');
      return req.session.save(() => res.redirect(loginUrlFromHint(req)));
    }
    flash(req, 'warn', 'That page was out of date, so nothing was saved. Please try again.');
    return req.session.save(() => res.redirect(backPath(req, '/admin')));
  }
  next();
};
router.use(ensureCsrf);
router.use(checkCsrf);

// The staff door (/staff) is its own small router: sign-in only. Once signed in, everyone works in the same workspace.
const staffRouter = express.Router();
staffRouter.use(adminNoCache);
staffRouter.use(ensureCsrf);
staffRouter.use(checkCsrf);

const flash = (req, type, msg) => {
  req.session.flash = { type, msg };
};

async function buildCtx(req) {
  const settings = await getSettings();
  const f = req.session.flash;
  delete req.session.flash;
  let newCount = 0;
  let unread = 0;
  let lastAlert = 0;
  if (req.session.admin) {
    const [n, u] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM requests WHERE status = 'new'`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread, COALESCE(MAX(id), 0)::int AS last FROM notifications WHERE admin_id = $1`, [req.session.admin.id]),
    ]);
    newCount = n.rows[0].n;
    unread = u.rows[0].unread;
    lastAlert = u.rows[0].last;
  }
  const role = req.session.admin ? req.session.admin.role : '';
  return {
    settings,
    baseUrl: (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''),
    admin: req.session.admin,
    csrf: req.session.csrf,
    flash: f,
    newCount,
    unread,
    lastAlert,
    role,
    roleLabel: roleOf(role).label,
    can: (perm) => can(role, perm),
    visible: visibleStatuses(role),
    settable: settableStatuses(role),
  };
}

// ---------- auth ----------
// One handler pair serves both doors. portal 'admin' = owner only (/admin/login); portal 'staff' = everyone else (/staff).
const homeFor = (role) => (can(role, 'dashboard') ? '/admin' : '/admin/requests');

function mountLogin(r, portal, paths) {
  const P = PORTALS[portal];

  r.get(
    paths,
    wrap(async (req, res) => {
      // Owner and staff have separate sessions, so a signed-in owner never blocks the staff page (and the other way round).
      if (req.session.admin) return res.redirect(homeFor(req.session.admin.role));
      res.view(loginPage(await buildCtx(req), { portal }));
    })
  );

  r.post(
    paths.map((p) => (p === '/' ? '/login' : p)).filter((p, i, arr) => arr.indexOf(p) === i),
    signinLimit,
    wrap(async (req, res, next) => {
      const email = cleanText(req.body.email, 120).toLowerCase();
      const password = String(req.body.password || '').slice(0, 200);
      const { rows } = await pool.query(
        'SELECT id, name, email, role, is_active, password_hash, failed_attempts, locked_until, must_change_password FROM admins WHERE email = $1',
        [email]
      );
      const a = rows[0];
      const match = await bcrypt.compare(password, a ? a.password_hash : DUMMY_HASH); // always run, so timing does not reveal valid emails
      const fail = async (status, error) => {
        const ctx = await buildCtx(req);
        return res.status(status).view(loginPage(ctx, { error, email, portal }));
      };

      if (a && a.locked_until && new Date(a.locked_until) > new Date()) {
        await audit(req, 'login_blocked', 'Account is locked', { id: a.id, email: a.email });
        return fail(429, 'Too many failed attempts. This account is locked for a short while - please try again later.');
      }
      if (!a || !match) {
        if (a) {
          const fails = a.failed_attempts + 1;
          const lock = fails >= MAX_FAILS;
          await pool.query('UPDATE admins SET failed_attempts = $1, locked_until = $2 WHERE id = $3', [
            lock ? 0 : fails,
            lock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
            a.id,
          ]);
          await audit(req, lock ? 'login_locked' : 'login_failed', lock ? `Locked for ${LOCK_MINUTES} minutes` : `Attempt ${fails} of ${MAX_FAILS}`, { id: a.id, email: a.email });
        } else {
          // Never store what was typed: people often type their password into the email box. Keep a short fingerprint instead.
          const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120;
          const fp = require('crypto').createHash('sha256').update(String(email)).digest('hex').slice(0, 8);
          await audit(req, 'login_failed', `Unknown email (fingerprint ${fp})`, { email: looksLikeEmail ? email : '' });
        }
        return fail(401, 'Incorrect email or password.');
      }

      if (!a.is_active) {
        await audit(req, 'login_blocked', 'Disabled account', { id: a.id, email: a.email });
        return fail(403, 'This account has been disabled. Please contact the owner.');
      }
      // Right password, wrong door: refuse without starting a session. Only said after the password is proven correct.
      if (!P.allows(a.role)) {
        await audit(req, 'login_wrong_door', `${a.role} account tried the ${portal === 'admin' ? 'owner' : 'staff'} sign-in`, { id: a.id, email: a.email });
        return fail(
          403,
          portal === 'admin' ? 'This sign-in is for the owner only. Staff sign in at the staff page.' : 'Owner accounts sign in on the owner page (/admin/login), not here.'
        );
      }
      await pool.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [a.id]);
      const admin = { id: a.id, name: a.name, email: a.email, role: a.role, mustChange: a.must_change_password, since: Date.now() };
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.admin = admin;
        req.session.csrf = crypto.randomBytes(24).toString('hex');
        req.session.save(async (err2) => {
          if (err2) return next(err2);
          await audit(req, 'login', `Signed in (${a.role}) via ${portal === 'admin' ? 'owner' : 'staff'} page`, admin);
              res.redirect(admin.mustChange ? '/admin/account' : homeFor(a.role));
        });
      });
    })
  );
}

mountLogin(router, 'admin', ['/login']);
mountLogin(staffRouter, 'staff', ['/', '/login']);

// ---------- forgot / reset password (code sent by WhatsApp to the number on the staff account) ----------
const STAFF_UNAVAILABLE = 'Automatic reset codes are not available right now (WhatsApp is not linked). Ask the owner to reset your password under Staff.';
const STAFF_SENT = `If that email belongs to a staff account with a WhatsApp number saved, we have sent it a 6-digit code (it works for ${TTL_MINUTES} minutes). Nothing arrived? Ask the owner to reset your password under Staff.`;

router.get(
  '/forgot',
  wrap(async (req, res) => {
    if (req.session.admin) return res.redirect(homeFor(req.session.admin.role));
    res.view(forgotPage(await buildCtx(req), 'admin', { portal: portalHint(req) }));
  })
);

router.post(
  '/forgot',
  loginLimit,
  wrap(async (req, res) => {
    const email = cleanText(req.body.email, 120).toLowerCase();
    const ctx = await buildCtx(req);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).view(forgotPage(ctx, 'admin', { error: 'Please enter a valid email address.', email, portal: portalHint(req) }));
    const r = await requestCode('admin', email, ctx.settings.business_name);
    await audit(req, 'password_reset_requested', `Code requested for ${email}`.slice(0, 120), { email });
    if (!r.available) return res.view(forgotPage(ctx, 'admin', { error: STAFF_UNAVAILABLE, email, portal: portalHint(req) }));
    // Same reply whether or not the email has an account (or a WhatsApp number), so nobody can test which emails exist.
    res.view(resetPage(ctx, 'admin', { info: STAFF_SENT, email, portal: portalHint(req) }));
  })
);

router.get(
  '/reset',
  wrap(async (req, res) => {
    if (req.session.admin) return res.redirect(homeFor(req.session.admin.role));
    res.view(resetPage(await buildCtx(req), 'admin', { email: cleanText(req.query.email, 120), portal: portalHint(req) }));
  })
);

router.post(
  '/reset',
  loginLimit,
  wrap(async (req, res) => {
    const b = req.body;
    const email = cleanText(b.email, 120).toLowerCase();
    const r = await completeReset('admin', email, b.code, b.password, b.confirm);
    if (!r.ok) {
      await audit(req, 'password_reset_failed', 'Wrong or expired code', { email });
      return res.status(400).view(resetPage(await buildCtx(req), 'admin', { error: r.error, email, portal: portalHint(req) }));
    }
    await audit(req, 'password_reset', 'Password reset with a WhatsApp code', { id: r.user.id, email: r.user.email });
    flash(req, 'success', 'Your password was updated. Please sign in.');
    const who = await pool.query('SELECT role FROM admins WHERE id = $1', [r.user.id]);
    res.redirect(loginUrlForRole(who.rows[0] && who.rows[0].role)); // owner -> /admin/login, everyone else -> /staff
  })
);

router.post('/logout', async (req, res) => {
  const door = req.session.admin ? loginUrlForRole(req.session.admin.role) : loginUrlFromHint(req);
  if (req.session.admin) await audit(req, 'logout', 'Signed out');
  req.session.destroy(() => res.redirect(door));
});

router.use(
  wrap(async (req, res, next) => {
    const a = req.session.admin;
    if (!a) return res.redirect(loginUrlFromHint(req));
    const door = loginUrlForRole(a.role);
    if (Date.now() - (a.since || 0) > ABSOLUTE_SESSION_MS) {
      return req.session.destroy(() => res.redirect(door));
    }
    // Re-read the account on every request so role changes and disabling take effect immediately.
    const { rows } = await pool.query('SELECT name, email, role, is_active, must_change_password FROM admins WHERE id = $1', [a.id]);
    if (!rows.length || !rows[0].is_active) {
      return req.session.destroy(() => res.redirect(door));
    }
    Object.assign(a, { name: rows[0].name, email: rows[0].email, role: rows[0].role, mustChange: rows[0].must_change_password });
    // A temporary / default password must be replaced before anything else can be used.
    if (a.mustChange) {
      const ok = (req.method === 'GET' && req.path === '/account') || (req.method === 'POST' && req.path === '/account/password');
      if (!ok) return res.redirect('/admin/account');
    }
    next();
  })
);

// Route guard: only roles holding the permission get through.
const need = (perm) =>
  wrap(async (req, res, next) => {
    if (can(req.session.admin.role, perm)) return next();
    await audit(req, 'access_denied', `${req.method} ${req.originalUrl}`.slice(0, 200));
    const ctx = await buildCtx(req);
    res.status(403).view(forbiddenPage(ctx));
  });

// ---------- dashboard ----------
router.get(
  '/',
  need('dashboard'),
  wrap(async (req, res) => {
    const [ctx, counts, customers, money, week, recent, operations] = await Promise.all([
      buildCtx(req),
      pool.query(`SELECT
          COUNT(*) FILTER (WHERE status = 'new')::int AS new,
          COUNT(*) FILTER (WHERE status IN ('confirmed','rider_arrived','picked_up','washing'))::int AS in_progress,
          COUNT(*) FILTER (WHERE status = 'ready')::int AS ready
        FROM requests`),
      pool.query('SELECT COUNT(*)::int AS n FROM customers'),
      pool.query(`SELECT
          COALESCE(SUM(amount_paid) FILTER (WHERE date_trunc('month', created_at AT TIME ZONE 'Africa/Nairobi') = date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi')), 0)
          + (SELECT COALESCE(SUM(d.amount_paid), 0) FROM deleted_requests d WHERE date_trunc('month', d.created_at AT TIME ZONE 'Africa/Nairobi') = date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi')) AS collected,
          COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)) FILTER (WHERE status <> 'cancelled'), 0) AS outstanding
        FROM requests`),
      pool.query(`SELECT to_char(d::date, 'Dy') AS label, COALESCE(c.n, 0)::int AS n
        FROM generate_series(${NAIROBI_TODAY} - 6, ${NAIROBI_TODAY}, interval '1 day') d
        LEFT JOIN (
          SELECT (created_at AT TIME ZONE 'Africa/Nairobi')::date AS day, COUNT(*) AS n
          FROM requests WHERE created_at >= now() - interval '8 days' GROUP BY 1
        ) c ON c.day = d::date
        ORDER BY d`),
      pool.query(`SELECT r.id, r.ref_code, r.status, r.created_at, c.name AS customer_name, c.phone AS customer_phone,
          (SELECT string_agg(i.category_name || ' ×' || i.quantity, ', ' ORDER BY i.id) FROM request_items i WHERE i.request_id = r.id) AS items
        FROM requests r JOIN customers c ON c.id = r.customer_id
        ORDER BY r.created_at DESC LIMIT 8`),
      pool.query(`SELECT
        (SELECT COUNT(*)::int FROM requests WHERE status NOT IN ('delivered','cancelled') AND delivery_scheduled_at < now()) AS overdue,
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE date_trunc('month',spent_on::timestamp)=date_trunc('month',CURRENT_DATE::timestamp)) AS expenses`),
    ]);
    res.view(
      dashboardPage(ctx, {
        counts: counts.rows[0],
        customers: customers.rows[0].n,
        collected: money.rows[0].collected,
        outstanding: money.rows[0].outstanding,
        week: week.rows,
        recent: recent.rows,
        operations: operations.rows[0],
      })
    );
  })
);

// ---------- requests ----------
router.get(
  '/requests',
  need('requests'),
  wrap(async (req, res) => {
    const status = STATUS_MAP[req.query.status] ? req.query.status : '';
    const q = cleanText(req.query.q, 80);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;

    const vis = visibleStatuses(req.session.admin.role); // null = every status
    const where = `($1 = '' OR r.status = $1)
      AND ($2 = '' OR r.ref_code ILIKE $3 OR c.name ILIKE $3 OR c.phone ILIKE $3 OR r.location_description ILIKE $3)
      AND ($4::text[] IS NULL OR r.status = ANY($4::text[]))${riderSql(req.session.admin)}`;

    const [ctx, count, rows, tabs] = await Promise.all([
      buildCtx(req),
      pool.query(`SELECT COUNT(*)::int AS n FROM requests r JOIN customers c ON c.id = r.customer_id WHERE ${where}`, [status, q, like, vis]),
      pool.query(
        `SELECT r.id, r.ref_code, r.status, r.created_at, r.location_description, r.latitude, r.longitude, r.total_amount, r.amount_paid,
            c.name AS customer_name, c.phone AS customer_phone,
            (SELECT string_agg(i.category_name || ' ×' || i.quantity, ', ' ORDER BY i.id) FROM request_items i WHERE i.request_id = r.id) AS items
           FROM requests r JOIN customers c ON c.id = r.customer_id
          WHERE ${where}
          ORDER BY r.created_at DESC LIMIT ${PAGE_SIZE} OFFSET $5`,
        [status, q, like, vis, (page - 1) * PAGE_SIZE]
      ),
      pool.query(`SELECT status, COUNT(*)::int AS n FROM requests WHERE ($1::text[] IS NULL OR status = ANY($1::text[]))${riderSql(req.session.admin, 'rider_admin_id')} GROUP BY status`, [vis]),
    ]);

    const tabCounts = { all: 0 };
    for (const t of tabs.rows) {
      tabCounts[t.status] = t.n;
      tabCounts.all += t.n;
    }
    const total = count.rows[0].n;
    res.view(requestsPage(ctx, { rows: rows.rows, total, page, pages: Math.max(Math.ceil(total / PAGE_SIZE), 1), status, q, tabCounts }));
  })
);

router.get(
  '/requests/:id',
  need('requests'),
  wrap(async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return next();
    await autoBill(pool, id); // older confirmed orders with no per-kg service get their bill here
    const [ctx, reqRes, items, payments, events, qcRes] = await Promise.all([
      buildCtx(req),
      pool.query(
        `SELECT r.*, c.name AS customer_name, c.phone AS customer_phone, b.name AS branch_name
           FROM requests r JOIN customers c ON c.id = r.customer_id LEFT JOIN branches b ON b.id = r.branch_id WHERE r.id = $1`,
        [id]
      ),
      pool.query(
        `SELECT i.id, i.category_name, i.quantity, i.unit, i.rate, i.measured_qty, i.line_total, cat.unit AS cat_unit, cat.price
           FROM request_items i LEFT JOIN categories cat ON cat.id = i.category_id
          WHERE i.request_id = $1 ORDER BY i.id`,
        [id]
      ),
      pool.query('SELECT id, amount, method, reference, recorded_by, reconciled, created_at FROM payments WHERE request_id = $1 ORDER BY id', [id]),
      pool.query('SELECT status, note, created_by, created_at FROM request_events WHERE request_id = $1 ORDER BY created_at DESC, id DESC', [id]),
      pool.query('SELECT passed FROM quality_inspections WHERE request_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [id]),
    ]);
    const vis = visibleStatuses(req.session.admin.role);
    // Rider / attendant: a job that has moved on (old notification, bookmark, or one just finished) is not an error.
    // Same message whether it moved on or never existed, so ids cannot be probed.
    if ((vis && (!reqRes.rows.length || !vis.includes(reqRes.rows[0].status))) || (reqRes.rows.length && !riderMayView(req.session.admin, reqRes.rows[0]))) {
      flash(req, 'warn', 'That job has moved on to another stage, so it is no longer in your list.');
      return res.redirect('/admin/requests');
    }
    if (!reqRes.rows.length) return next();
    const estimate = items.rows.reduce((sum, i) => sum + (i.price === null ? 0 : Number(i.price) * i.quantity), 0);
    const r = reqRes.rows[0];
    const biz = ctx.settings.business_name;
    const itemsText = items.rows.map((i) => `${i.category_name} x${i.quantity}`).join(', ');
    const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const trackLink = `${base}/track?ref=${encodeURIComponent(r.ref_code)}&phone=${encodeURIComponent(r.customer_phone)}`;
    const event = eventFor(r.status, r.total_amount, r.amount_paid);
    const team = ctx.can('dispatch') && event ? await recipientsFor(event) : [];
    const wa = {
      customer: waLink(r.customer_phone, customerMessage(r, biz, trackLink, ctx.settings)),
      headline: event ? HEADLINES[event] : '',
      auto: waCanSend(),
      team: team.map((p) => ({ name: p.name, role: p.role, phone: p.phone, link: p.phone ? waLink(p.phone, teamMessage(event, { ...r, items: itemsText }, biz)) : '' })),
    };
    res.view(requestDetailPage(ctx, { r, items: items.rows, payments: payments.rows, events: events.rows, estimate, wa, qcPassed: !!(qcRes.rows[0] && qcRes.rows[0].passed) }));
  })
);

router.post(
  '/requests/:id/status',
  need('status'),
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const status = req.body.status;
    if (!Number.isInteger(id) || !STATUS_MAP[status]) {
      flash(req, 'error', 'Invalid status.');
      return res.redirect('/admin/requests');
    }
    const note = cleanText(req.body.note, 200);
    let qcOverrideReason = ''; // set when an owner / manager releases the order without a passed inspection
    if (status === 'ready') {
      const qc = await pool.query('SELECT passed FROM quality_inspections WHERE request_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[id]);
      if (!qc.rows.length || !qc.rows[0].passed) {
        const mayOverride = can(req.session.admin.role, 'qcoverride');
        if (!(mayOverride && req.body.qc_override === '1')) {
          flash(req, 'error', mayOverride
            ? 'Pass the quality inspection in Operations first, or use “Mark Ready anyway (override)” on this request.'
            : 'A manager must pass the quality inspection in Operations before this order can be marked ready.');
          return res.redirect(`/admin/requests/${id}`);
        }
        qcOverrideReason = cleanText(req.body.qc_reason, 150);
        if (qcOverrideReason.length < 3) {
          flash(req, 'error', 'Give a short reason for marking this order ready without an inspection.');
          return res.redirect(`/admin/requests/${id}`);
        }
      }
    }
    const role = req.session.admin.role;
    const settable = settableStatuses(role);
    const vis = visibleStatuses(role);
    if (settable && !settable.includes(status)) {
      await audit(req, 'access_denied', `Status ${status} on request #${id}`);
      flash(req, 'error', 'Your role cannot set that status.');
      return res.redirect(`/admin/requests/${id}`);
    }
    let before = await pool.query('SELECT status, bill_status, total_amount, amount_paid, pay_later, rider_admin_id FROM requests WHERE id = $1', [id]);
    // Refuse early (before any billing side effect) when the job is outside this person's stages or is another rider's job.
    if (before.rows.length && ((vis && !vis.includes(before.rows[0].status)) || !riderMayView(req.session.admin, before.rows[0]))) {
      await audit(req, 'access_denied', `Status ${status} on request #${id}`);
      flash(req, 'error', 'That request is not one of your jobs.');
      return res.redirect('/admin/requests');
    }
    // Statuses only move forward. The database trigger enforces the same rule; this gives a clear message and an audit entry.
    if (before.rows.length) {
      const bw = backwardBlocker(before.rows[0].status, status);
      if (bw) {
        await audit(req, 'status_backward_blocked', `Request #${id}: ${before.rows[0].status} → ${status} refused`);
        flash(req, 'error', bw);
        return res.redirect(`/admin/requests/${id}`);
      }
    }
    // Lifecycle: Confirmed -> Rider arrived -> Picked up. Orders already under way before this step existed (legacy bills) are not blocked.
    if (before.rows.length && before.rows[0].bill_status !== 'legacy') {
      if (status === 'rider_arrived' && before.rows[0].status !== 'confirmed' && before.rows[0].status !== 'rider_arrived') {
        flash(req, 'error', 'Rider arrived can only be set on a confirmed order.');
        return res.redirect(`/admin/requests/${id}`);
      }
      if (status === 'picked_up' && !['rider_arrived', 'picked_up'].includes(before.rows[0].status)) {
        flash(req, 'error', 'The rider must arrive at the customer first. Mark “Rider arrived”, then the bill is weighed and paid before pick-up.');
        return res.redirect(`/admin/requests/${id}`);
      }
    }
    // A confirmed order with no per-kg service is billed automatically, so it is never stuck waiting for weighing.
    if (before.rows.length && ['confirmed', 'rider_arrived'].includes(before.rows[0].status) && before.rows[0].status !== status && status === 'rider_arrived' && before.rows[0].bill_status === 'none' && (await autoBill(pool, id))) {
      before = await pool.query('SELECT status, bill_status, total_amount, amount_paid, pay_later FROM requests WHERE id = $1', [id]);
    }
    if (before.rows.length && before.rows[0].status === 'confirmed' && before.rows[0].bill_status === 'none' && (await autoBill(pool, id))) {
      before = await pool.query('SELECT status, bill_status, total_amount, amount_paid, pay_later FROM requests WHERE id = $1', [id]);
    }
    // Leaving New / Confirmed for pick-up or later needs a weighed, customer-confirmed and paid (or pay-later) bill.
    if (before.rows.length && GATED_TARGETS.includes(status) && ['new', 'confirmed', 'rider_arrived'].includes(before.rows[0].status)) {
      const why = pickupBlocker(before.rows[0], (await getSettings()).pay_before_cleaning !== '0');
      if (why) {
        flash(req, 'error', why);
        return res.redirect(`/admin/requests/${id}`);
      }
    }
    const upd = await pool.query(
      `UPDATE requests SET status = $1, updated_at = now() WHERE id = $2 AND ($3::text[] IS NULL OR status = ANY($3::text[]))${riderSql(req.session.admin, 'rider_admin_id')} RETURNING id, total_amount, amount_paid`,
      [status, id, vis]
    );
    if (upd.rows.length) {
      // Just confirmed: if nothing is charged per kg, create the bill now so payment can be taken straight away.
      if (status === 'confirmed' && before.rows[0] && before.rows[0].status !== 'confirmed') {
        const auto = await autoBill(pool, id);
        if (auto && auto.status === 'needs_price') notifyEvent('bill_needs_price', id, req.session.admin.id, (await getSettings()).business_name);
      }
      // Just confirmed: assign a rider automatically if none is assigned yet (the alert then goes to that rider).
      if (status === 'confirmed' && before.rows[0] && before.rows[0].status !== 'confirmed') await autoAssignRider(pool, id, 'system').catch(() => {});
      // Rider arrived on an order that is already paid: with Pay Before Cleaning on, pick-up starts straight away.
      let autoPicked = false;
      if (status === 'rider_arrived' && (await getSettings()).pay_before_cleaning !== '0') autoPicked = await advanceIfPaid(pool, id);
      if (autoPicked) {
        await audit(req, 'request_status', `Request #${id} → picked_up (automatic, already paid)`);
        notifyEvent('picked_up', id, req.session.admin.id, (await getSettings()).business_name);
      }
      const ev = before.rows[0] && before.rows[0].status !== status ? eventFor(status, upd.rows[0].total_amount, upd.rows[0].amount_paid) : null;
      if (ev) notifyEvent(ev, id, req.session.admin.id, (await getSettings()).business_name); // alerts the next role; never throws
      await pool.query('INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [id, status, note, req.session.admin.name]);
      await audit(req, 'request_status', `Request #${id} → ${status}`);
      if (qcOverrideReason) {
        // A visible record in Quality control (passed, with no checks ticked) so an override is never silent.
        await pool.query(
          `INSERT INTO quality_inspections (request_id, checked_by, passed, notes) VALUES ($1,$2,TRUE,$3)`,
          [id, req.session.admin.id, `OVERRIDE by ${req.session.admin.name}: ${qcOverrideReason}`]
        );
        await audit(req, 'qc_override', `Request #${id} marked ready without inspection: ${qcOverrideReason}`);
      }
      const gone = vis && !vis.includes(status); // the job just left this role's stages
      flash(req, 'success', gone ? `Marked as “${STATUS_MAP[status].label}”. Done, so it has left your list.` : `Status updated to “${STATUS_MAP[status].label}”.`);
      if (gone) return res.redirect('/admin/requests');
    }
    res.redirect(`/admin/requests/${id}`);
  })
);

router.post(
  '/requests/:id/billing',
  need('billing'),
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const subtotal = Number(req.body.total_amount);
    const paid = Number(req.body.amount_paid);
    if (!Number.isInteger(id)) return res.redirect('/admin/requests');
    const bs = await pool.query('SELECT bill_status FROM requests WHERE id = $1', [id]);
    if (!bs.rows.length || bs.rows[0].bill_status !== 'legacy') {
      flash(req, 'error', 'Prices now come from the weighed bill. Use the Bill section on this request.');
      return res.redirect(`/admin/requests/${id}`);
    }
    if (!Number.isInteger(id) || !Number.isFinite(subtotal) || !Number.isFinite(paid) || subtotal < 0 || paid < 0) {
      flash(req, 'error', 'Please enter valid amounts (0 or more).');
      return res.redirect(`/admin/requests/${id}`);
    }
    // Discounts now come only from promotions; a legacy order keeps whatever discount it already has.
    const cur = await pool.query('SELECT discount_code, discount_amount FROM requests WHERE id=$1',[id]);
    const code = cur.rows[0] ? cur.rows[0].discount_code : '';
    const discount = cur.rows[0] ? Math.min(subtotal, Number(cur.rows[0].discount_amount) || 0) : 0;
    const total=Math.max(0,subtotal-discount);
    await pool.query('UPDATE requests SET subtotal_amount=$1,discount_code=$2,discount_amount=$3,total_amount=$4,amount_paid=$5,updated_at=now() WHERE id=$6',[subtotal,code,discount,total,paid,id]);
    await audit(req, 'request_billing', `Request #${id}: subtotal ${subtotal}, discount ${discount}, total ${total}, paid ${paid}`);
    flash(req, 'success', 'Billing saved.');
    res.redirect(`/admin/requests/${id}`);
  })
);

router.post(
  '/requests/:id/notes',
  need('notes'),
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.redirect('/admin/requests');
    const vis = visibleStatuses(req.session.admin.role); // null = every status
    const upd = await pool.query(
      `UPDATE requests SET admin_notes = $1, updated_at = now() WHERE id = $2 AND ($3::text[] IS NULL OR status = ANY($3::text[]))${riderSql(req.session.admin, 'rider_admin_id')} RETURNING id`,
      [cleanMultiline(req.body.admin_notes, 2000), id, vis]
    );
    if (!upd.rows.length) {
      await audit(req, 'access_denied', `Notes on request #${id}`);
      flash(req, 'error', 'That request is not one of your jobs.');
      return res.redirect('/admin/requests');
    }
    flash(req, 'success', 'Notes saved.');
    res.redirect(`/admin/requests/${id}`);
  })
);

router.post(
  '/requests/:id/delete',
  need('delete'),
  wrap(async (req, res) => {
    const rid = parseInt(req.params.id, 10);
    if (!Number.isInteger(rid)) {
      flash(req, 'error', 'Request not found.');
      return res.redirect('/admin/requests');
    }
    // Keep the money: copy the totals to deleted_requests and keep the payment rows before removing the request.
    const client = await pool.connect();
    let kept = null;
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `SELECT r.id, r.ref_code, r.customer_id, r.status, r.total_amount, r.amount_paid, r.created_at, c.name, c.phone
           FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1 FOR UPDATE OF r`,
        [rid]
      );
      if (r.rows.length) {
        const q = r.rows[0];
        kept = q;
        await client.query('UPDATE payments SET request_ref = $1 WHERE request_id = $2', [q.ref_code, rid]);
        await client.query(
          `INSERT INTO deleted_requests (original_id, ref_code, customer_id, customer_name, customer_phone, status, total_amount, amount_paid, created_at, deleted_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [q.id, q.ref_code, q.customer_id, q.name, q.phone, q.status, q.total_amount, q.amount_paid, q.created_at, req.session.admin.name]
        );
        await client.query('DELETE FROM requests WHERE id = $1', [rid]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    await audit(req, 'request_delete', kept ? `Request #${rid} ${kept.ref_code} (paid ${kept.amount_paid} kept in the totals)` : `Request #${rid}`);
    flash(req, 'success', kept && Number(kept.amount_paid) > 0 ? 'Request deleted. The money already received on it is still counted in your totals.' : 'Request deleted.');
    res.redirect('/admin/requests');
  })
);

// ---------- categories ----------
function parseCategory(body) {
  const name = cleanText(body.name, 60);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#087F8C';
  const priceRaw = String(body.price == null ? '' : body.price).trim();
  const price = priceRaw === '' ? null : Number(priceRaw);
  const sort = parseInt(body.sort_order, 10);
  return {
    name,
    description: cleanText(body.description, 200),
    icon: categoryIconName(body.icon),
    color,
    price: price !== null && Number.isFinite(price) && price >= 0 ? price : null,
    unit: cleanText(body.unit, 20) || 'item',
    sort_order: Number.isFinite(sort) ? sort : 0,
  };
}

router.get(
  '/categories',
  need('categories'),
  wrap(async (req, res) => {
    const [ctx, cats, versions] = await Promise.all([
      buildCtx(req),
      pool.query(
        `SELECT c.*, (SELECT COUNT(*)::int FROM request_items i WHERE i.category_id = c.id) AS used
           FROM categories c ORDER BY c.sort_order, c.name`
      ),
      mediaVersions(),
    ]);
    res.view(categoriesPage(ctx, { rows: cats.rows, versions }));
  })
);

router.post(
  '/categories',
  need('categories'),
  wrap(async (req, res) => {
    const c = parseCategory(req.body);
    if (!c.name) {
      flash(req, 'error', 'Please give the category a name.');
      return res.redirect('/admin/categories');
    }
    await pool.query(
      'INSERT INTO categories (name, description, icon, color, price, unit, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [c.name, c.description, c.icon, c.color, c.price, c.unit, c.sort_order]
    );
    await audit(req, 'category_add', c.name);
    flash(req, 'success', `Category “${c.name}” added. It is now live on the public page.`);
    res.redirect('/admin/categories');
  })
);

router.post(
  '/categories/:id',
  need('categories'),
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const c = parseCategory(req.body);
    if (!Number.isInteger(id) || !c.name) {
      flash(req, 'error', 'Please give the category a name.');
      return res.redirect('/admin/categories');
    }
    await pool.query(
      'UPDATE categories SET name=$1, description=$2, icon=$3, color=$4, price=$5, unit=$6, sort_order=$7 WHERE id=$8',
      [c.name, c.description, c.icon, c.color, c.price, c.unit, c.sort_order, id]
    );
    await audit(req, 'category_edit', `#${id} ${c.name}`);
    flash(req, 'success', 'Category updated.');
    res.redirect('/admin/categories');
  })
);

// Category photography is stored in the existing media table, one image per category.
router.post(
  '/categories/:id/image',
  need('categories'),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' }),
  wrap(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const buf = req.body;
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ ok: false, error: 'Invalid category.' });
    if (!Buffer.isBuffer(buf) || buf.length < 1000) return res.status(400).json({ ok: false, error: 'Choose a valid image first.' });
    if (buf.length > 2.5 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'Image is too large. Maximum size is 2.5 MB.' });
    const mime = req.get('content-type').split(';')[0].toLowerCase();
    const valid = mime === 'image/jpeg'
      ? buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
      : mime === 'image/png'
        ? buf.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
        : mime === 'image/webp' && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) return res.status(400).json({ ok: false, error: 'The selected file is not a valid JPEG, PNG or WebP image.' });
    const exists = await pool.query('SELECT id FROM categories WHERE id = $1', [id]);
    if (!exists.rows.length) return res.status(404).json({ ok: false, error: 'Category not found.' });
    const slot = `category-${id}`;
    await pool.query(
      `INSERT INTO media (slot, mime, data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (slot) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`,
      [slot, mime, buf]
    );
    await audit(req, 'category_image_upload', `Category #${id} (${Math.round(buf.length / 1024)} KB)`);
    res.json({ ok: true });
  })
);

router.post(
  '/categories/:id/image/reset',
  need('categories'),
  wrap(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isInteger(id) && id > 0) {
      await pool.query('DELETE FROM media WHERE slot = $1', [`category-${id}`]);
      await audit(req, 'category_image_reset', `Category #${id}`);
      flash(req, 'success', 'Category photo reset to its built-in image.');
    }
    res.redirect('/admin/categories');
  })
);

router.post(
  '/categories/:id/toggle',
  need('categories'),
  wrap(async (req, res) => {
    const cid = parseInt(req.params.id, 10);
    if (!Number.isInteger(cid)) return res.redirect('/admin/categories');
    await pool.query('UPDATE categories SET is_active = NOT is_active WHERE id = $1', [cid]);
    await audit(req, 'category_toggle', `#${req.params.id}`);
    flash(req, 'success', 'Category visibility changed.');
    res.redirect('/admin/categories');
  })
);

router.post(
  '/categories/:id/delete',
  need('categories'),
  wrap(async (req, res) => {
    const cid = parseInt(req.params.id, 10);
    if (!Number.isInteger(cid)) return res.redirect('/admin/categories');
    await pool.query('DELETE FROM categories WHERE id = $1', [cid]);
    await audit(req, 'category_delete', `#${req.params.id}`);
    flash(req, 'success', 'Category deleted.');
    res.redirect('/admin/categories');
  })
);

// ---------- customers ----------
async function customersView(req, created = null) {
  const q = cleanText(req.query.q, 80);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const where = `($1 = '' OR c.name ILIKE $2 OR c.phone ILIKE $2 OR COALESCE(c.email, '') ILIKE $2)`;
  const wantAccounts = can(req.session.admin.role, 'accounts');
  const [ctx, count, rows, accounts] = await Promise.all([
    buildCtx(req),
    pool.query(`SELECT COUNT(*)::int AS n FROM customers c WHERE ${where}`, [q, like]),
    pool.query(
      `SELECT c.id, c.name, c.phone, c.created_at,
          COUNT(r.id)::int AS requests,
          COALESCE(SUM(r.amount_paid), 0) + (SELECT COALESCE(SUM(d.amount_paid), 0) FROM deleted_requests d WHERE d.customer_id = c.id) AS paid,
          MAX(r.created_at) AS last_request
         FROM customers c LEFT JOIN requests r ON r.customer_id = c.id
        WHERE ${where}
        GROUP BY c.id
        ORDER BY MAX(r.created_at) DESC NULLS LAST, c.created_at DESC
        LIMIT ${PAGE_SIZE} OFFSET $3`,
      [q, like, (page - 1) * PAGE_SIZE]
    ),
    wantAccounts
      ? pool.query(
          `SELECT a.id, a.name, a.email, a.phone, a.is_active, a.must_change_password, a.last_login_at,
                  (SELECT COUNT(*)::int FROM requests r WHERE r.account_id = a.id) AS orders
             FROM accounts a
            WHERE ($1 = '' OR a.name ILIKE $2 OR a.email ILIKE $2 OR a.phone ILIKE $2)
            ORDER BY a.created_at DESC LIMIT 50`,
          [q, like]
        )
      : { rows: [] },
  ]);
  const total = count.rows[0].n;
  return customersPage(ctx, { rows: rows.rows, total, page, pages: Math.max(Math.ceil(total / PAGE_SIZE), 1), q, accounts: accounts.rows, created });
}

router.get(
  '/customers',
  need('customers'),
  wrap(async (req, res) => {
    res.view(await customersView(req));
  })
);

// ---------- settings ----------
router.get(
  '/settings',
  need('settings'),
  wrap(async (req, res) => {
    res.view(settingsPage(await buildCtx(req)));
  })
);

router.post(
  '/settings',
  need('settings'),
  wrap(async (req, res) => {
    const b = req.body;
    const currency = cleanText(b.currency, 6).toUpperCase() || 'KES';
    await saveSettings({
      business_name: cleanText(b.business_name, 80) || 'Tap to Wash',
      tagline: cleanText(b.tagline, 120),
      about: cleanMultiline(b.about, 400),
      phone: cleanText(b.phone, 30),
      whatsapp: cleanText(b.whatsapp, 30),
      email: cleanText(b.email, 120),
      address: cleanText(b.address, 200),
      opening_hours: cleanText(b.opening_hours, 120),
      currency,
    });
    await audit(req, 'settings_save', 'Business details');
    flash(req, 'success', 'Settings saved.');
    res.redirect('/admin/settings');
  })
);

router.post(
  '/settings/auto-confirm',
  need('settings'),
  wrap(async (req, res) => {
    const on = req.body.enabled === '1';
    await saveSettings({ auto_confirm: on ? '1' : '0' });
    await audit(req, 'auto_confirm_toggle', on ? 'Auto-confirm new requests switched on' : 'Auto-confirm new requests switched off (staff confirm by hand)');
    flash(req, 'success', on ? 'Auto-confirm is on. New requests are confirmed straight away and the rider is alerted.' : 'Auto-confirm is off. Staff confirm new requests by hand.');
    res.redirect('/admin/settings#confirmCard');
  })
);

router.post(
  '/settings/pay-before-cleaning',
  need('settings'),
  wrap(async (req, res) => {
    const on = req.body.enabled === '1';
    await saveSettings({ pay_before_cleaning: on ? '1' : '0' });
    await audit(req, 'pay_before_cleaning_toggle', on ? 'Pay Before Cleaning switched on' : 'Pay Before Cleaning switched off (pay on delivery)');
    live.broadcastStaff('policy', { pay_before_cleaning: on });
    flash(req, 'success', on ? 'Pay Before Cleaning is on. Payment is needed before pick-up.' : 'Pay Before Cleaning is off. Orders can be picked up now and paid on delivery.');
    res.redirect('/admin/settings#payCard');
  })
);

router.post(
  '/settings/mpesa',
  need('settings'),
  wrap(async (req, res) => {
    const b = req.body;
    const check = validateMpesa({ type: cleanText(b.mpesa_type, 10), number: cleanText(b.mpesa_number, 12), account: cleanText(b.mpesa_account, 40), name: cleanText(b.mpesa_name, 80) });
    if (!check.ok) {
      flash(req, 'error', check.error);
      return res.redirect('/admin/settings#mpesaCard');
    }
    await saveSettings(check.value);
    const v = check.value;
    await audit(req, 'mpesa_settings', v.mpesa_type ? `M-Pesa set to ${v.mpesa_type === 'till' ? 'Till' : 'Paybill'} ${v.mpesa_number}${v.mpesa_account ? `, account ${v.mpesa_account}` : ''}` : 'M-Pesa payment details removed');
    flash(req, 'success', v.mpesa_type ? `Customers will now be asked to pay to ${v.mpesa_type === 'till' ? 'Till' : 'Paybill'} ${v.mpesa_number}.` : 'M-Pesa payment details removed. Customers will only see the cash and M-Pesa wording.');
    res.redirect('/admin/settings#mpesaCard');
  })
);

router.post(
  '/settings/branches',
  need('settings'),
  wrap(async (req, res) => {
    const on = req.body.enabled === '1';
    await saveSettings({ branches_enabled: on ? '1' : '0' });
    await audit(req, 'branches_toggle', on ? 'Multiple branches switched on' : 'Multiple branches switched off');
    flash(req, 'success', on ? 'Multiple branches is on. Add your branches under Operations.' : 'Multiple branches is off.');
    res.redirect('/admin/settings#branchCard');
  })
);

router.post(
  '/settings/terms',
  need('settings'),
  wrap(async (req, res) => {
    const text = cleanMultiline(req.body.terms_text, 20000);
    if (text.length < 50) {
      flash(req, 'error', 'The Terms of Service are too short.');
      return res.redirect('/admin/settings');
    }
    const cur = await getSettings();
    if (text === cur.terms_text) {
      flash(req, 'success', 'No changes - the terms are the same as before.');
      return res.redirect('/admin/settings');
    }
    const version = (Number(cur.terms_version) || 1) + 1;
    await saveSettings({ terms_text: text, terms_version: String(version) });
    await audit(req, 'terms_update', `Terms version ${version}`);
    flash(req, 'success', `Terms saved as version ${version}. Customers will be asked to accept the new version.`);
    res.redirect('/admin/settings');
  })
);

router.post(
  '/settings/privacy',
  need('settings'),
  wrap(async (req, res) => {
    const text = cleanMultiline(req.body.privacy_text, 20000);
    if (text.length < 50) {
      flash(req, 'error', 'The Privacy Notice is too short.');
      return res.redirect('/admin/settings');
    }
    const cur = await getSettings();
    if (text === cur.privacy_text) {
      flash(req, 'success', 'No changes - the notice is the same as before.');
      return res.redirect('/admin/settings');
    }
    const version = (Number(cur.privacy_version) || 1) + 1;
    await saveSettings({ privacy_text: text, privacy_version: String(version) });
    await audit(req, 'privacy_update', `Privacy notice version ${version}`);
    flash(req, 'success', `Privacy Notice saved as version ${version}.`);
    res.redirect('/admin/settings');
  })
);

// ---------- my account (every role) ----------
router.get(
  '/account',
  wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT last_login_at, phone, notify_inapp, notify_push, notify_whatsapp FROM admins WHERE id = $1', [req.session.admin.id]);
    const role = req.session.admin.role;
    const alerts = Object.entries(ROUTES).filter(([, roles]) => roles.includes(role)).map(([ev]) => HEADLINES[ev]);
    res.view(accountPage(await buildCtx(req), { lastLogin: rows[0] && rows[0].last_login_at, prefs: rows[0], alerts, waMode: waCanSend() ? 'auto' : 'link' }));
  })
);

router.post(
  '/account/password',
  wrap(async (req, res) => {
    const { current, password, confirm } = req.body;
    const { rows } = await pool.query('SELECT password_hash, name, email FROM admins WHERE id = $1', [req.session.admin.id]);
    const problem = passwordProblem(password, rows[0] || {});
    if (!rows.length || !(await bcrypt.compare(String(current || ''), rows[0].password_hash))) {
      await audit(req, 'password_change_failed', 'Wrong current password');
      flash(req, 'error', 'Your current password is incorrect.');
    } else if (problem) {
      flash(req, 'error', problem);
    } else if (password !== confirm) {
      flash(req, 'error', 'The new passwords do not match.');
    } else if (password === current) {
      flash(req, 'error', 'The new password must be different from the current one.');
    } else {
      await pool.query('UPDATE admins SET password_hash = $1, must_change_password = FALSE, failed_attempts = 0, locked_until = NULL WHERE id = $2', [
        await bcrypt.hash(password, 12),
        req.session.admin.id,
      ]);
      req.session.admin.mustChange = false;
      await audit(req, 'password_change', 'Password updated');
      flash(req, 'success', 'Password updated.');
      return res.redirect(can(req.session.admin.role, 'dashboard') ? '/admin' : '/admin/requests');
    }
    res.redirect('/admin/account');
  })
);

require('./admin-tools')(router, { buildCtx, flash, need });
require('./admin-staff')(router, { buildCtx, flash, need });
require('./admin-notify')(router, { buildCtx, flash, need });
require('./admin-accounts')(router, { flash, need, customersView });
require('./admin-whatsapp')(router, { buildCtx, flash, need });
require('./admin-operations')(router, { buildCtx, flash, need });
require('./admin-inventory')(router, { buildCtx, flash, need });
require('./admin-billing')(router, { flash, need });

module.exports = router;
module.exports.staffRouter = staffRouter;
