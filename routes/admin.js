const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { getSettings, saveSettings } = require('../lib/settings');
const { rateLimit, safeEqual } = require('../lib/security');
const { wrap, STATUS_MAP, cleanText, cleanMultiline } = require('../lib/helpers');

const { loginPage } = require('../views/admin/login');
const { dashboardPage } = require('../views/admin/dashboard');
const { requestsPage, requestDetailPage } = require('../views/admin/requests');
const { categoriesPage } = require('../views/admin/categories');
const { customersPage } = require('../views/admin/customers');
const { settingsPage } = require('../views/admin/settings');

const router = express.Router();
const PAGE_SIZE = 20;
const NAIROBI_TODAY = `(now() AT TIME ZONE 'Africa/Nairobi')::date`;

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, message: 'Too many sign-in attempts. Please wait a few minutes.' });

// ---------- session helpers ----------
router.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  next();
});

router.use((req, res, next) => {
  if (req.method === 'POST' && !safeEqual(req.body && req.body._csrf, req.session.csrf)) {
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
  if (req.session.admin) {
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM requests WHERE status = 'new'`);
    newCount = n.rows[0].n;
  }
  return { settings, admin: req.session.admin, csrf: req.session.csrf, flash: f, newCount };
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
    const password = String(req.body.password || '');
    const { rows } = await pool.query('SELECT id, name, email, password_hash FROM admins WHERE email = $1', [email]);
    const ok = rows.length && (await bcrypt.compare(password, rows[0].password_hash));
    if (!ok) {
      const ctx = await buildCtx(req);
      return res.status(401).view(loginPage(ctx, { error: 'Incorrect email or password.', email }));
    }
    const admin = { id: rows[0].id, name: rows[0].name, email: rows[0].email };
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.admin = admin;
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      req.session.save((err2) => (err2 ? next(err2) : res.redirect('/admin')));
    });
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use((req, res, next) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  next();
});

// ---------- dashboard ----------
router.get(
  '/',
  wrap(async (req, res) => {
    const [ctx, counts, customers, money, week, recent] = await Promise.all([
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
    ]);
    res.view(
      dashboardPage(ctx, {
        counts: counts.rows[0],
        customers: customers.rows[0].n,
        collected: money.rows[0].collected,
        outstanding: money.rows[0].outstanding,
        week: week.rows,
        recent: recent.rows,
      })
    );
  })
);

// ---------- requests ----------
router.get(
  '/requests',
  wrap(async (req, res) => {
    const status = STATUS_MAP[req.query.status] ? req.query.status : '';
    const q = cleanText(req.query.q, 80);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;

    const where = `($1 = '' OR r.status = $1)
      AND ($2 = '' OR r.ref_code ILIKE $3 OR c.name ILIKE $3 OR c.phone ILIKE $3 OR r.location_description ILIKE $3)`;

    const [ctx, count, rows, tabs] = await Promise.all([
      buildCtx(req),
      pool.query(`SELECT COUNT(*)::int AS n FROM requests r JOIN customers c ON c.id = r.customer_id WHERE ${where}`, [status, q, like]),
      pool.query(
        `SELECT r.id, r.ref_code, r.status, r.created_at, r.location_description, r.latitude, r.longitude, r.total_amount, r.amount_paid,
            c.name AS customer_name, c.phone AS customer_phone,
            (SELECT string_agg(i.category_name || ' ×' || i.quantity, ', ' ORDER BY i.id) FROM request_items i WHERE i.request_id = r.id) AS items
           FROM requests r JOIN customers c ON c.id = r.customer_id
          WHERE ${where}
          ORDER BY r.created_at DESC LIMIT ${PAGE_SIZE} OFFSET $4`,
        [status, q, like, (page - 1) * PAGE_SIZE]
      ),
      pool.query('SELECT status, COUNT(*)::int AS n FROM requests GROUP BY status'),
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
  wrap(async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return next();
    const [ctx, reqRes, items, events] = await Promise.all([
      buildCtx(req),
      pool.query(
        `SELECT r.*, c.name AS customer_name, c.phone AS customer_phone
           FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1`,
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
    const estimate = items.rows.reduce((sum, i) => sum + (i.price === null ? 0 : Number(i.price) * i.quantity), 0);
    res.view(requestDetailPage(ctx, { r: reqRes.rows[0], items: items.rows, events: events.rows, estimate }));
  })
);

router.post(
  '/requests/:id/status',
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const status = req.body.status;
    if (!Number.isInteger(id) || !STATUS_MAP[status]) {
      flash(req, 'error', 'Invalid status.');
      return res.redirect('/admin/requests');
    }
    const note = cleanText(req.body.note, 200);
    const upd = await pool.query('UPDATE requests SET status = $1, updated_at = now() WHERE id = $2 RETURNING id', [status, id]);
    if (upd.rows.length) {
      await pool.query('INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [id, status, note, req.session.admin.name]);
      flash(req, 'success', `Status updated to “${STATUS_MAP[status].label}”.`);
    }
    res.redirect(`/admin/requests/${id}`);
  })
);

router.post(
  '/requests/:id/billing',
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const total = Number(req.body.total_amount);
    const paid = Number(req.body.amount_paid);
    if (!Number.isInteger(id) || !Number.isFinite(total) || !Number.isFinite(paid) || total < 0 || paid < 0) {
      flash(req, 'error', 'Please enter valid amounts (0 or more).');
      return res.redirect(`/admin/requests/${id}`);
    }
    await pool.query('UPDATE requests SET total_amount = $1, amount_paid = $2, updated_at = now() WHERE id = $3', [total, paid, id]);
    flash(req, 'success', 'Billing saved.');
    res.redirect(`/admin/requests/${id}`);
  })
);

router.post(
  '/requests/:id/notes',
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await pool.query('UPDATE requests SET admin_notes = $1, updated_at = now() WHERE id = $2', [cleanMultiline(req.body.admin_notes, 2000), id]);
    flash(req, 'success', 'Notes saved.');
    res.redirect(`/admin/requests/${id}`);
  })
);

router.post(
  '/requests/:id/delete',
  wrap(async (req, res) => {
    await pool.query('DELETE FROM requests WHERE id = $1', [parseInt(req.params.id, 10)]);
    flash(req, 'success', 'Request deleted.');
    res.redirect('/admin/requests');
  })
);

// ---------- categories ----------
function parseCategory(body) {
  const name = cleanText(body.name, 60);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#10b981';
  const priceRaw = String(body.price == null ? '' : body.price).trim();
  const price = priceRaw === '' ? null : Number(priceRaw);
  const sort = parseInt(body.sort_order, 10);
  return {
    name,
    description: cleanText(body.description, 200),
    icon: cleanText(body.icon, 8) || '🧺',
    color,
    price: price !== null && Number.isFinite(price) && price >= 0 ? price : null,
    unit: cleanText(body.unit, 20) || 'item',
    sort_order: Number.isFinite(sort) ? sort : 0,
  };
}

router.get(
  '/categories',
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
    flash(req, 'success', `Category “${c.name}” added. It is now live on the public page.`);
    res.redirect('/admin/categories');
  })
);

router.post(
  '/categories/:id',
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
    flash(req, 'success', 'Category updated.');
    res.redirect('/admin/categories');
  })
);

router.post(
  '/categories/:id/toggle',
  wrap(async (req, res) => {
    await pool.query('UPDATE categories SET is_active = NOT is_active WHERE id = $1', [parseInt(req.params.id, 10)]);
    flash(req, 'success', 'Category visibility changed.');
    res.redirect('/admin/categories');
  })
);

router.post(
  '/categories/:id/delete',
  wrap(async (req, res) => {
    await pool.query('DELETE FROM categories WHERE id = $1', [parseInt(req.params.id, 10)]);
    flash(req, 'success', 'Category deleted.');
    res.redirect('/admin/categories');
  })
);

// ---------- customers ----------
router.get(
  '/customers',
  wrap(async (req, res) => {
    const q = cleanText(req.query.q, 80);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const where = `($1 = '' OR c.name ILIKE $2 OR c.phone ILIKE $2 OR COALESCE(c.email, '') ILIKE $2)`;
    const [ctx, count, rows] = await Promise.all([
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
    ]);
    const total = count.rows[0].n;
    res.view(customersPage(ctx, { rows: rows.rows, total, page, pages: Math.max(Math.ceil(total / PAGE_SIZE), 1), q }));
  })
);

// ---------- settings ----------
router.get(
  '/settings',
  wrap(async (req, res) => {
    res.view(settingsPage(await buildCtx(req)));
  })
);

router.post(
  '/settings',
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
    flash(req, 'success', 'Settings saved.');
    res.redirect('/admin/settings');
  })
);

router.post(
  '/settings/password',
  wrap(async (req, res) => {
    const { current, password, confirm } = req.body;
    const { rows } = await pool.query('SELECT password_hash FROM admins WHERE id = $1', [req.session.admin.id]);
    if (!rows.length || !(await bcrypt.compare(String(current || ''), rows[0].password_hash))) {
      flash(req, 'error', 'Your current password is incorrect.');
    } else if (String(password || '').length < 8) {
      flash(req, 'error', 'The new password must be at least 8 characters.');
    } else if (password !== confirm) {
      flash(req, 'error', 'The new passwords do not match.');
    } else {
      await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(password, 10), req.session.admin.id]);
      flash(req, 'success', 'Password updated.');
    }
    res.redirect('/admin/settings');
  })
);

module.exports = router;
