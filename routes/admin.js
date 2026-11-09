const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { getSettings, saveSettings } = require('../lib/settings');
const { rateLimit, safeEqual, adminNoCache } = require('../lib/security');
const { audit } = require('../lib/audit');
const { passwordProblem } = require('../lib/password');
const { wrap, STATUS_MAP, cleanText, cleanMultiline } = require('../lib/helpers');
const { categoryIconName } = require('../lib/icons');
const { can, roleOf, visibleStatuses, settableStatuses } = require('../lib/roles');
const { ROUTES, eventFor, notifyEvent, recipientsFor, teamMessage, customerMessage, HEADLINES } = require('../lib/notify');
const { waLink, canSend: waCanSend } = require('../lib/whatsapp');

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

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: +process.env.LOGIN_MAX || 12, message: 'Too many sign-in attempts. Please wait a few minutes.' });

// ---------- session helpers ----------
router.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  next();
});

router.use((req, res, next) => {
  const sent = req.get('x-csrf-token') || (req.body && req.body._csrf);
  if (req.method === 'POST' && !safeEqual(sent, req.session.csrf)) {
    return res.status(403).send('Your form expired. Go back, refresh the page and try again.');
  }
  next();
});

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
router.get(
  '/login',
  wrap(async (req, res) => {
    if (req.session.admin) return res.redirect('/admin');
    res.view(loginPage(await buildCtx(req)));
  })
);

router.post(
  '/login',
  loginLimit,
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
      return res.status(status).view(loginPage(ctx, { error, email }));
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
        await audit(req, 'login_failed', `Unknown email: ${email}`.slice(0, 120), { email });
      }
      return fail(401, 'Incorrect email or password.');
    }

    if (!a.is_active) {
      await audit(req, 'login_blocked', 'Disabled account', { id: a.id, email: a.email });
      return fail(403, 'This account has been disabled. Please contact the owner.');
    }
    await pool.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [a.id]);
    const admin = { id: a.id, name: a.name, email: a.email, role: a.role, mustChange: a.must_change_password, since: Date.now() };
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.admin = admin;
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      req.session.save(async (err2) => {
        if (err2) return next(err2);
        await audit(req, 'login', `Signed in (${a.role})`, admin);
        res.redirect(admin.mustChange ? '/admin/account' : can(a.role, 'dashboard') ? '/admin' : '/admin/requests');
      });
    });
  })
);

// ---------- forgot / reset password (code sent by WhatsApp to the number on the staff account) ----------
const STAFF_UNAVAILABLE = 'Automatic reset codes are not available right now (WhatsApp is not linked). Ask the owner to reset your password under Staff.';
const STAFF_SENT = `We have sent a 6-digit code to the WhatsApp number saved on your staff account. It works for ${TTL_MINUTES} minutes.`;

router.get(
  '/forgot',
  wrap(async (req, res) => {
    if (req.session.admin) return res.redirect('/admin');
    res.view(forgotPage(await buildCtx(req), 'admin'));
  })
);

router.post(
  '/forgot',
  loginLimit,
  wrap(async (req, res) => {
    const email = cleanText(req.body.email, 120).toLowerCase();
    const ctx = await buildCtx(req);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).view(forgotPage(ctx, 'admin', { error: 'Please enter a valid email address.', email }));
    const r = await requestCode('admin', email, ctx.settings.business_name);
    await audit(req, 'password_reset_requested', `Code requested for ${email}`.slice(0, 120), { email });
    if (r.problem) return res.status(r.problem === 'wait' ? 429 : 400).view(forgotPage(ctx, 'admin', { error: problemMessage(r.problem, 'admin'), email }));
    if (!r.available) return res.view(forgotPage(ctx, 'admin', { error: STAFF_UNAVAILABLE, email }));
    res.view(resetPage(ctx, 'admin', { info: STAFF_SENT, email }));
  })
);

router.get(
  '/reset',
  wrap(async (req, res) => {
    if (req.session.admin) return res.redirect('/admin');
    res.view(resetPage(await buildCtx(req), 'admin', { email: cleanText(req.query.email, 120) }));
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
      return res.status(400).view(resetPage(await buildCtx(req), 'admin', { error: r.error, email }));
    }
    await audit(req, 'password_reset', 'Password reset with a WhatsApp code', { id: r.user.id, email: r.user.email });
    flash(req, 'success', 'Your password was updated. Please sign in.');
    res.redirect('/admin/login');
  })
);

router.post('/logout', async (req, res) => {
  if (req.session.admin) await audit(req, 'logout', 'Signed out');
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use(
  wrap(async (req, res, next) => {
    const a = req.session.admin;
    if (!a) return res.redirect('/admin/login');
    if (Date.now() - (a.since || 0) > ABSOLUTE_SESSION_MS) {
      return req.session.destroy(() => res.redirect('/admin/login'));
    }
    // Re-read the account on every request so role changes and disabling take effect immediately.
    const { rows } = await pool.query('SELECT name, email, role, is_active, must_change_password FROM admins WHERE id = $1', [a.id]);
    if (!rows.length || !rows[0].is_active) {
      return req.session.destroy(() => res.redirect('/admin/login'));
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
  (req, res, next) => (can(req.session.admin.role, 'dashboard') ? next() : res.redirect('/admin/requests')),
  wrap(async (req, res) => {
    const [ctx, counts, customers, money, week, recent, operations] = await Promise.all([
      buildCtx(req),
      pool.query(`SELECT
          COUNT(*) FILTER (WHERE status = 'new')::int AS new,
          COUNT(*) FILTER (WHERE status IN ('confirmed','picked_up','washing'))::int AS in_progress,
          COUNT(*) FILTER (WHERE status = 'ready')::int AS ready
        FROM requests`),
      pool.query('SELECT COUNT(*)::int AS n FROM customers'),
      pool.query(`SELECT
          COALESCE(SUM(amount_paid) FILTER (WHERE date_trunc('month', created_at AT TIME ZONE 'Africa/Nairobi') = date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi')), 0) AS collected,
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
        (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE date_trunc('month',spent_on::timestamp)=date_trunc('month',CURRENT_DATE::timestamp)) AS expenses,
        (SELECT COUNT(*)::int FROM laundry_machines WHERE status='maintenance') AS machines_maintenance`),
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
      AND ($4::text[] IS NULL OR r.status = ANY($4::text[]))`;

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
      pool.query('SELECT status, COUNT(*)::int AS n FROM requests WHERE ($1::text[] IS NULL OR status = ANY($1::text[])) GROUP BY status', [vis]),
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
    const [ctx, reqRes, items, events] = await Promise.all([
      buildCtx(req),
      pool.query(
        `SELECT r.*, c.name AS customer_name, c.phone AS customer_phone, b.name AS branch_name
           FROM requests r JOIN customers c ON c.id = r.customer_id LEFT JOIN branches b ON b.id = r.branch_id WHERE r.id = $1`,
        [id]
      ),
      pool.query(
        `SELECT i.category_name, i.quantity, cat.price
           FROM request_items i LEFT JOIN categories cat ON cat.id = i.category_id
          WHERE i.request_id = $1 ORDER BY i.id`,
        [id]
      ),
      pool.query('SELECT status, note, created_by, created_at FROM request_events WHERE request_id = $1 ORDER BY created_at DESC, id DESC', [id]),
    ]);
    if (!reqRes.rows.length) return next();
    const vis = visibleStatuses(req.session.admin.role);
    if (vis && !vis.includes(reqRes.rows[0].status)) return next(); // not one of this role's jobs
    const estimate = items.rows.reduce((sum, i) => sum + (i.price === null ? 0 : Number(i.price) * i.quantity), 0);
    const r = reqRes.rows[0];
    const biz = ctx.settings.business_name;
    const itemsText = items.rows.map((i) => `${i.category_name} x${i.quantity}`).join(', ');
    const event = eventFor(r.status, r.total_amount, r.amount_paid);
    const team = ctx.can('dispatch') && event ? await recipientsFor(event) : [];
    const wa = {
      customer: waLink(r.customer_phone, customerMessage(r, biz)),
      headline: event ? HEADLINES[event] : '',
      auto: waCanSend(),
      team: team.map((p) => ({ name: p.name, role: p.role, phone: p.phone, link: p.phone ? waLink(p.phone, teamMessage(event, { ...r, items: itemsText }, biz)) : '' })),
    };
    res.view(requestDetailPage(ctx, { r, items: items.rows, events: events.rows, estimate, wa }));
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
    if (status === 'ready') {
      const qc = await pool.query('SELECT passed FROM quality_inspections WHERE request_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[id]);
      if (!qc.rows.length || !qc.rows[0].passed) { flash(req,'error','Complete and pass the quality inspection in Operations before marking this order ready.'); return res.redirect(`/admin/requests/${id}`); }
    }
    const role = req.session.admin.role;
    const settable = settableStatuses(role);
    const vis = visibleStatuses(role);
    if (settable && !settable.includes(status)) {
      await audit(req, 'access_denied', `Status ${status} on request #${id}`);
      flash(req, 'error', 'Your role cannot set that status.');
      return res.redirect(`/admin/requests/${id}`);
    }
    const before = await pool.query('SELECT status FROM requests WHERE id = $1', [id]);
    const upd = await pool.query(
      'UPDATE requests SET status = $1, updated_at = now() WHERE id = $2 AND ($3::text[] IS NULL OR status = ANY($3::text[])) RETURNING id, total_amount, amount_paid',
      [status, id, vis]
    );
    if (upd.rows.length) {
      const ev = before.rows[0] && before.rows[0].status !== status ? eventFor(status, upd.rows[0].total_amount, upd.rows[0].amount_paid) : null;
      if (ev) notifyEvent(ev, id, req.session.admin.id, (await getSettings()).business_name); // alerts the next role; never throws
      await pool.query('INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [id, status, note, req.session.admin.name]);
      await audit(req, 'request_status', `Request #${id} → ${status}`);
      flash(req, 'success', `Status updated to “${STATUS_MAP[status].label}”.`);
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
    const code = cleanText(req.body.discount_code,40).toUpperCase();
    if (!Number.isInteger(id) || !Number.isFinite(subtotal) || !Number.isFinite(paid) || subtotal < 0 || paid < 0) {
      flash(req, 'error', 'Please enter valid amounts (0 or more).');
      return res.redirect(`/admin/requests/${id}`);
    }
    let discount = 0;
    if (code) {
      const found = await pool.query(`SELECT * FROM discounts WHERE code=$1 AND is_active AND (starts_at IS NULL OR starts_at<=CURRENT_DATE) AND (ends_at IS NULL OR ends_at>=CURRENT_DATE) AND (max_uses IS NULL OR uses<max_uses)`,[code]);
      const request = await pool.query('SELECT customer_id,discount_code FROM requests WHERE id=$1',[id]);
      const previousOrders = request.rows.length ? await pool.query(`SELECT COUNT(*)::int AS n FROM requests WHERE customer_id=$1 AND id<>$2 AND status<>'cancelled'`,[request.rows[0].customer_id,id]) : {rows:[{n:0}]};
      if (!found.rows.length || previousOrders.rows[0].n + 1 < Number(found.rows[0].min_orders)) {
        flash(req,'error','That discount code is invalid, expired, exhausted or the customer does not meet its minimum-order requirement.');
        return res.redirect(`/admin/requests/${id}`);
      }
      const d=found.rows[0]; discount=d.discount_type==='percent' ? subtotal*Number(d.value)/100 : Number(d.value);
      discount=Math.min(subtotal,Math.max(0,discount));
      if (request.rows[0].discount_code !== code) await pool.query('UPDATE discounts SET uses=uses+1 WHERE id=$1',[d.id]);
    }
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
    await pool.query('UPDATE requests SET admin_notes = $1, updated_at = now() WHERE id = $2', [cleanMultiline(req.body.admin_notes, 2000), id]);
    flash(req, 'success', 'Notes saved.');
    res.redirect(`/admin/requests/${id}`);
  })
);

router.post(
  '/requests/:id/delete',
  need('delete'),
  wrap(async (req, res) => {
    const rid = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM requests WHERE id = $1', [rid]);
    await audit(req, 'request_delete', `Request #${rid}`);
    flash(req, 'success', 'Request deleted.');
    res.redirect('/admin/requests');
  })
);

// ---------- categories ----------
function parseCategory(body) {
  const name = cleanText(body.name, 60);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#c2663a';
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
    const [ctx, cats] = await Promise.all([
      buildCtx(req),
      pool.query(
        `SELECT c.*, (SELECT COUNT(*)::int FROM request_items i WHERE i.category_id = c.id) AS used
           FROM categories c ORDER BY c.sort_order, c.name`
      ),
    ]);
    res.view(categoriesPage(ctx, { rows: cats.rows }));
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

router.post(
  '/categories/:id/toggle',
  need('categories'),
  wrap(async (req, res) => {
    await pool.query('UPDATE categories SET is_active = NOT is_active WHERE id = $1', [parseInt(req.params.id, 10)]);
    await audit(req, 'category_toggle', `#${req.params.id}`);
    flash(req, 'success', 'Category visibility changed.');
    res.redirect('/admin/categories');
  })
);

router.post(
  '/categories/:id/delete',
  need('categories'),
  wrap(async (req, res) => {
    await pool.query('DELETE FROM categories WHERE id = $1', [parseInt(req.params.id, 10)]);
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
          COALESCE(SUM(r.amount_paid), 0) AS paid,
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

module.exports = router;
