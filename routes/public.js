const express = require('express');
const path = require('path');
const { pool } = require('../config/db');
const { getSettings } = require('../lib/settings');
const { rateLimit } = require('../lib/security');
const { wrap, phoneKey, validPhone, genRef, cleanText, cleanMultiline } = require('../lib/helpers');
const { homePage } = require('../views/public/home');
const { trackPage } = require('../views/public/track');
const { termsPage } = require('../views/public/terms');
const { privacyPage } = require('../views/public/privacy');
const { notifyEvent } = require('../lib/notify');
const { toIntl, validWaNumber } = require('../lib/whatsapp');
const { SLOTS, mediaVersions } = require('../lib/media');
const live = require('../lib/live');
const stk = require('../lib/stk');
const { BILL_ROW, billFrom, payState, loadOrderParts } = require('../lib/order-view');
const { respondToBill } = require('../lib/customer-bill');

const router = express.Router();

const submitLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: +process.env.REQUEST_MAX || 30, message: 'Too many requests from this device. Please try again in a few minutes.' });
const payLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: 'Too many payment attempts. Please try again in a few minutes.' });
const payStatusLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, message: 'Too many checks. Please wait a moment.' });
const trackLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, message: 'Too many lookups. Please try again in a few minutes.' });

router.get(
  '/',
  wrap(async (req, res) => {
    const acc = req.session.account;
    const again = parseInt(req.query.again, 10);
    const [settings, media, cats, mine] = await Promise.all([
      getSettings(),
      mediaVersions(),
      pool.query(
        `SELECT id, name, description, icon, color, price, unit
           FROM categories WHERE is_active ORDER BY sort_order, name`
      ),
      acc ? pool.query('SELECT name, phone FROM accounts WHERE id = $1 AND is_active', [acc.id]) : { rows: [] },
    ]);
    // Signed-in customers get their details pre-filled, a list of earlier places, and "request again".
    let personal = null;
    if (acc && mine.rows.length) {
      const [places, prev] = await Promise.all([
        pool.query(
          `SELECT * FROM (
             SELECT DISTINCT ON (location_description) location_description, latitude, longitude, created_at
               FROM requests WHERE account_id = $1 ORDER BY location_description, created_at DESC
           ) t ORDER BY created_at DESC LIMIT 5`,
          [acc.id]
        ),
        Number.isInteger(again)
          ? pool.query(
              `SELECT r.location_description, r.latitude, r.longitude, r.preferred_time,
                      (SELECT json_agg(json_build_object('category_id', i.category_id, 'quantity', i.quantity)) FROM request_items i WHERE i.request_id = r.id AND i.category_id IS NOT NULL) AS items
                 FROM requests r WHERE r.id = $1 AND r.account_id = $2`,
              [again, acc.id]
            )
          : { rows: [] },
      ]);
      personal = {
        name: mine.rows[0].name,
        phone: mine.rows[0].phone,
        places: places.rows.map((p) => ({ text: p.location_description, lat: p.latitude, lng: p.longitude })),
        again: prev.rows[0] ? { items: prev.rows[0].items || [], text: prev.rows[0].location_description, lat: prev.rows[0].latitude, lng: prev.rows[0].longitude, time: prev.rows[0].preferred_time } : null,
        start: req.query.start === '1' || !!prev.rows[0],
      };
    }
    const wa = validWaNumber(settings.whatsapp) ? toIntl(settings.whatsapp) : '';
    const branches = settings.branches_enabled === '1' ? (await pool.query('SELECT id, name, address, phone FROM branches WHERE is_active ORDER BY name')).rows : [];
    // Home screen extras: the signed-in customer's latest order ("Recent laundry") and the shop's average review rating.
    const [recentQ, ratingQ] = await Promise.all([
      acc
        ? pool.query(
            `SELECT r.ref_code, r.status, r.created_at,
                    (SELECT string_agg(i.category_name, ', ' ORDER BY i.id) FROM request_items i WHERE i.request_id = r.id) AS items
               FROM requests r WHERE r.account_id = $1 ORDER BY r.created_at DESC LIMIT 1`,
            [acc.id]
          )
        : { rows: [] },
      pool.query('SELECT ROUND(AVG(rating)::numeric, 1) AS avg, COUNT(*)::int AS n FROM customer_reviews').catch(() => ({ rows: [] })),
    ]);
    const rating = ratingQ.rows[0] && ratingQ.rows[0].n > 0 ? { avg: Number(ratingQ.rows[0].avg), count: ratingQ.rows[0].n } : null;
    res.view(homePage({ settings, media, account: acc, personal, whatsapp: wa, branches, recent: recentQ.rows[0] || null, rating }, cats.rows));
  })
);

router.get(
  '/privacy',
  wrap(async (req, res) => {
    res.view(privacyPage({ settings: await getSettings(), account: req.session.account }));
  })
);

router.get(
  '/terms',
  wrap(async (req, res) => {
    res.view(termsPage({ settings: await getSettings(), account: req.session.account }));
  })
);

// Background pictures: the admin's uploaded photo if there is one, otherwise the drawn default.
router.get(
  '/media/:slot',
  wrap(async (req, res, next) => {
    const slot = req.params.slot;
    if (!Object.prototype.hasOwnProperty.call(SLOTS, slot)) return next();
    const { rows } = await pool.query('SELECT mime, data, updated_at FROM media WHERE slot = $1', [slot]);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!rows.length) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(path.join(__dirname, '..', 'public', 'img', `${slot}.svg`));
    }
    const etag = `"${slot}-${Math.floor(new Date(rows[0].updated_at).getTime() / 1000)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type(rows[0].mime).send(rows[0].data);
  })
);

// Site icon (favicon): the PNG the admin uploaded in Settings (stored in PostgreSQL), otherwise the built-in public/favicon.svg.
// /favicon.ico and /apple-touch-icon.png are asked for by browsers and phones without reading the page, so they serve the same icon.
async function siteIcon(req, res) {
  const { rows } = await pool.query(`SELECT mime, data, updated_at FROM media WHERE slot = 'favicon'`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!rows.length) {
    if (req.path !== '/site-icon') return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.sendFile(path.join(__dirname, '..', 'public', 'favicon.svg'));
  }
  const etag = `"favicon-${Math.floor(new Date(rows[0].updated_at).getTime() / 1000)}"`;
  res.setHeader('ETag', etag);
  // URLs with ?v=<version> never change, so they can be cached for a year; bare URLs are re-checked hourly.
  res.setHeader('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.type(rows[0].mime).send(rows[0].data);
}
router.get(['/site-icon', '/favicon.ico', '/apple-touch-icon.png'], wrap(siteIcon));

// Customer taps to wash -> this creates the request.
router.post(
  '/api/requests',
  submitLimit,
  wrap(async (req, res) => {
    const b = req.body || {};
    const fail = (error, status = 400) => res.status(status).json({ ok: false, error });

    if (b.website) return res.json({ ok: true, ref: 'TTW-OK' }); // honeypot: pretend success to bots

    // An account is required to book. Guests are sent to sign in or sign up, then returned to the booking.
    if (!req.session.account) {
      return res.status(401).json({ ok: false, login: '/account/login?next=' + encodeURIComponent('/?start=1'), error: 'Please sign in or create an account to book a pick-up.' });
    }

    const settings = await getSettings();
    if (b.accept_terms !== true) return fail('Please accept the Terms of Service to continue.');
    if (String(b.terms_version) !== String(settings.terms_version)) {
      return fail('Our Terms of Service were just updated. Please refresh the page, read them and try again.', 409);
    }

    const name = cleanText(b.name, 80);
    const phone = cleanText(b.phone, 20);
    const locationDescription = cleanMultiline(b.location_description, 500);
    const notes = cleanMultiline(b.notes, 1000);
    const preferredTime = cleanText(b.preferred_time, 80);

    if (name.length < 2) return fail('Please enter your name.');
    if (!validPhone(phone)) return fail('Please enter a valid phone number.');
    if (locationDescription.length < 3) return fail('Please describe where you are so we can find you.');

    let lat = null;
    let lng = null;
    let accuracy = null;
    if (b.latitude !== null && b.latitude !== undefined && b.latitude !== '') {
      lat = Number(b.latitude);
      lng = Number(b.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return fail('The shared location looks invalid. Please share it again.');
      }
      accuracy = Number.isFinite(Number(b.accuracy)) ? Math.min(Number(b.accuracy), 100000) : null;
    }

    const rawItems = Array.isArray(b.items) ? b.items.slice(0, 40) : [];
    const wanted = new Map();
    for (const it of rawItems) {
      const id = parseInt(it && it.category_id, 10);
      const qty = Math.min(Math.max(parseInt(it && it.quantity, 10) || 1, 1), 999);
      if (Number.isInteger(id)) wanted.set(id, qty);
    }
    if (wanted.size === 0) return fail('Please choose at least one thing to wash.');

    // Branch: only used when the owner has switched multi-branch mode on and the branch is active.
    let branchId = null;
    if (settings.branches_enabled === '1') {
      const bid = parseInt(b.branch_id, 10);
      if (Number.isInteger(bid)) {
        const ok = await pool.query('SELECT id FROM branches WHERE id = $1 AND is_active', [bid]);
        if (!ok.rowCount) return fail('That branch is not available. Please choose another one.');
        branchId = bid;
      }
    }

    const cats = await pool.query('SELECT id, name FROM categories WHERE is_active AND id = ANY($1::int[])', [[...wanted.keys()]]);
    if (cats.rows.length === 0) return fail('Those categories are no longer available. Please refresh the page.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const cust = await client.query(
        `INSERT INTO customers (name, phone, phone_key) VALUES ($1, $2, $3)
         ON CONFLICT (phone_key) DO UPDATE SET phone = EXCLUDED.phone
         RETURNING id`,
        [name, phone, phoneKey(phone)]
      );

      let ref = null;
      let requestId = null;
      for (let attempt = 0; attempt < 6 && !requestId; attempt++) {
        const candidate = genRef();
        await client.query('SAVEPOINT ref_try');
        try {
          const ins = await client.query(
            `INSERT INTO requests (ref_code, customer_id, location_description, notes, latitude, longitude, location_accuracy, preferred_time, terms_version, terms_accepted_at, account_id, branch_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), (SELECT id FROM accounts WHERE id = $10 AND is_active), $11) RETURNING id`,
            [candidate, cust.rows[0].id, locationDescription, notes, lat, lng, accuracy, preferredTime, Number(settings.terms_version) || 1, req.session.account ? req.session.account.id : null, branchId]
          );
          requestId = ins.rows[0].id;
          ref = candidate;
          await client.query('RELEASE SAVEPOINT ref_try');
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT ref_try');
          if (err.code !== '23505') throw err;
        }
      }
      if (!requestId) throw new Error('Could not generate a unique reference');

      for (const c of cats.rows) {
        await client.query('INSERT INTO request_items (request_id, category_id, category_name, quantity) VALUES ($1,$2,$3,$4)', [
          requestId,
          c.id,
          c.name,
          wanted.get(c.id),
        ]);
      }
      await client.query(`INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,'new','Request received','customer')`, [requestId]);

      await client.query('COMMIT');
      notifyEvent('new', requestId, null, settings.business_name); // alerts staff; never throws, not awaited
      live.publish(requestId, { force: true });
      res.json({ ok: true, ref });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

// Live updates for the customer who owns the order (reference code + phone, the same check as the tracking page).
router.get(
  '/live/order',
  wrap(async (req, res) => {
    const ref = cleanText(req.query.ref, 20).toUpperCase();
    const phone = cleanText(req.query.phone, 20);
    // Allowed when the reference code + phone match (tracking link), or when the signed-in customer's account placed the order
    // (the order page inside the account has no phone number in it, so it used to be refused and never updated).
    const found = ref
      ? await pool.query('SELECT r.id, r.account_id, c.phone_key FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.ref_code = $1', [ref])
      : { rows: [] };
    const row = found.rows[0];
    const acc = req.session.account;
    const byPhone = !!row && validPhone(phone) && row.phone_key === phoneKey(phone);
    const byAccount = !!row && !!acc && row.account_id !== null && Number(row.account_id) === Number(acc.id);
    if (!byPhone && !byAccount) return res.status(403).end();
    live.open(req, res, { kind: 'order', orderId: row.id }); // this connection only ever receives this order's room
  })
);

// A signed-in customer does not have to type their phone number again.
const savedPhone = async (req) => {
  const a = req.session.account;
  if (!a) return '';
  const { rows } = await pool.query('SELECT phone FROM accounts WHERE id = $1 AND is_active', [a.id]);
  return rows[0] && rows[0].phone ? rows[0].phone : '';
};

router.get(
  '/track',
  trackLimit,
  wrap(async (req, res) => {
    const settings = await getSettings();
    const ref = cleanText(req.query.ref, 20).toUpperCase();
    const phone = cleanText(req.query.phone, 20);
    const ctx = { settings, account: req.session.account, accountPhone: phone || (await savedPhone(req)) };

    if (!ref && !phone) return res.view(trackPage(ctx, {}));
    if (!ref || !validPhone(phone)) return res.view(trackPage(ctx, { ref, error: 'Enter both your reference code and phone number.' }));

    const found = await pool.query(`SELECT ${BILL_ROW}, c.phone_key FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.ref_code = $1`, [ref]);
    if (!found.rows.length || found.rows[0].phone_key !== phoneKey(phone)) {
      return res.view(trackPage(ctx, { ref, error: 'We could not find a request matching those details. Please check and try again.' }));
    }

    const r = found.rows[0];
    const { items, events } = await loadOrderParts(r.id);
    const bill = billFrom(r, items);
    const pay = await payState(r, bill, { wantedId: parseInt(req.query.stk, 10) || 0, phone: phone || '' });
    pay.billAction = '/track/bill';
    pay.payAction = '/track/pay';
    pay.statusUrl = (id) => `/track/pay/${id}/status?ref=${encodeURIComponent(r.ref_code)}&phone=${encodeURIComponent(phone)}`;
    const payErrors = { phone: 'Enter a Safaricom number like 0712 345 678.', fail: 'M-Pesa did not accept the request. Please try again, or pay using the steps below.', unavailable: 'Pay by M-Pesa prompt is not available right now. Use the steps below.', notdue: 'There is nothing to pay on this order right now.' };
    const infoMsg = req.query.bill === 'confirmed' ? 'Thank you. Your bill is confirmed.' : req.query.bill === 'queried' ? 'Thank you. We have noted your question and will check the bill with you.' : req.query.bill === 'stale' ? 'Your bill was updated while you were looking at it. Please review it again.' : req.query.feedback === 'sent' ? 'Thank you. Your feedback has been received.' : '';
    res.view(trackPage(ctx, { ref, info: infoMsg, error: payErrors[req.query.pay] || '', result: { ref_code: r.ref_code, status: r.status, items, events, pickup_scheduled_at: r.pickup_scheduled_at, delivery_scheduled_at: r.delivery_scheduled_at, dispatch_stage: r.dispatch_stage, bill, phone, pay } }));
  })
);

// Customer confirms or queries the bill that the rider's weighing produced.
router.post(
  '/track/bill',
  trackLimit,
  wrap(async (req, res) => {
    const ref = cleanText(req.body.ref, 20).toUpperCase();
    const phone = cleanText(req.body.phone, 20);
    const action = req.body.action === 'dispute' ? 'dispute' : req.body.action === 'confirm' ? 'confirm' : '';
    const found = await pool.query(`SELECT r.id, r.status, r.bill_status, r.bill_version, c.phone_key, c.name FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.ref_code = $1`, [ref]);
    if (!found.rows.length || !validPhone(phone) || found.rows[0].phone_key !== phoneKey(phone) || !action) {
      const settings = await getSettings();
      return res.status(400).view(trackPage({ settings, account: req.session.account, accountPhone: await savedPhone(req) }, { ref, error: 'We could not verify that order. Check the reference code and phone number.' }));
    }
    const r = found.rows[0];
    const back = (flag) => res.redirect(`/track?ref=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}&bill=${flag}`);
    const business = (await getSettings()).business_name;
    return back(await respondToBill(r, { action, version: req.body.version, comment: req.body.comment, business }));
  })
);

// Pay the confirmed bill with an M-Pesa prompt on the customer's phone (reference code + phone check, like the rest of tracking).
router.post(
  '/track/pay',
  payLimit,
  wrap(async (req, res) => {
    const ref = cleanText(req.body.ref, 20).toUpperCase();
    const phone = cleanText(req.body.phone, 20);
    const found = await pool.query('SELECT r.id, r.ref_code, r.status, r.bill_status, r.total_amount, r.amount_paid, c.phone_key FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.ref_code = $1', [ref]);
    if (!found.rows.length || !validPhone(phone) || found.rows[0].phone_key !== phoneKey(phone)) {
      const settings = await getSettings();
      return res.status(400).view(trackPage({ settings, account: req.session.account, accountPhone: await savedPhone(req) }, { ref, error: 'We could not verify that order. Check the reference code and phone number.' }));
    }
    const r = found.rows[0];
    const back = (q) => res.redirect(`/track?ref=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}&${q}#bill`);
    if (!stk.enabled()) return back('pay=unavailable');
    const out = await stk.startPush(r, cleanText(req.body.msisdn, 20) || phone);
    if (out.ok) return back(`stk=${out.stk.id}`);
    return back(`pay=${!stk.normalizePhone(req.body.msisdn || phone) ? 'phone' : stk.cannotPay(r) ? 'notdue' : 'fail'}`);
  })
);

// The page that waits for the answer asks here every few seconds.
router.get(
  '/track/pay/:id/status',
  payStatusLimit,
  wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const ref = cleanText(req.query.ref, 20).toUpperCase();
    const phone = cleanText(req.query.phone, 20);
    res.set('Cache-Control', 'no-store');
    const found = await pool.query('SELECT r.id, c.phone_key FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.ref_code = $1', [ref]);
    const owns = found.rows.length && validPhone(phone) && found.rows[0].phone_key === phoneKey(phone) && Number.isInteger(id)
      ? await pool.query('SELECT id FROM mpesa_stk WHERE id = $1 AND request_id = $2', [id, found.rows[0].id])
      : { rows: [] };
    if (!owns.rows.length) return res.status(404).json({ ok: false });
    const row = await stk.refresh(id);
    res.json({ ok: true, status: row.status, message: stk.describe(row) });
  })
);

router.post(
  '/track/feedback',
  trackLimit,
  wrap(async (req, res) => {
    const ref = cleanText(req.body.ref, 20).toUpperCase();
    const phone = cleanText(req.body.phone, 20);
    const kind = cleanText(req.body.kind, 20);
    const rating = Number(req.body.rating);
    const comment = cleanMultiline(req.body.comment, 1500);
    const found = await pool.query(`SELECT r.id,r.customer_id,r.status,c.phone_key FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.ref_code=$1`, [ref]);
    if (!found.rows.length || !validPhone(phone) || found.rows[0].phone_key !== phoneKey(phone)) {
      const settings = await getSettings();
      return res.status(400).view(trackPage({settings,account:req.session.account,accountPhone:await savedPhone(req)},{ref,error:'We could not verify that order. Check the reference code and phone number.'}));
    }
    if (!['review','complaint'].includes(kind) || !Number.isInteger(rating) || rating<1 || rating>5 || (!comment.trim() && kind==='complaint')) {
      const settings = await getSettings();
      return res.status(400).view(trackPage({settings,account:req.session.account,accountPhone:await savedPhone(req)},{ref,error:'Please provide a valid rating and, for a complaint, describe the issue.'}));
    }
    if (kind === 'review' && found.rows[0].status !== 'delivered') {
      const settings = await getSettings();
      return res.status(400).view(trackPage({ settings, account: req.session.account, accountPhone: await savedPhone(req) }, { ref, error: 'You can rate the service once your laundry has been delivered. To report a problem now, choose “Report a problem”.' }));
    }
    if (kind === 'review') {
      await pool.query(`INSERT INTO customer_reviews(request_id,customer_id,rating,comment) VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,created_at=now()`,[found.rows[0].id,found.rows[0].customer_id,rating,comment]);
    } else {
      await pool.query(`INSERT INTO customer_complaints(request_id,customer_id,subject,details) VALUES($1,$2,$3,$4)`,[found.rows[0].id,found.rows[0].customer_id,'Customer complaint',`Rating: ${rating}/5\n${comment}`]);
    }
    res.redirect(`/track?ref=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}&feedback=sent`);
  })
);

module.exports = router;
