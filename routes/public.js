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

const router = express.Router();

const submitLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, message: 'Too many requests from this device. Please try again in a few minutes.' });
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
    res.view(homePage({ settings, media, account: acc, personal, whatsapp: wa }, cats.rows));
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

    const cats = await pool.query('SELECT id, name FROM categories WHERE is_active AND id = ANY($1::int[])', [[...wanted.keys()]]);
    if (cats.rows.length === 0) return fail('Those categories are no longer available. Please refresh the page.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const cust = await client.query(
        `INSERT INTO customers (name, phone, phone_key) VALUES ($1, $2, $3)
         ON CONFLICT (phone_key) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone
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
            `INSERT INTO requests (ref_code, customer_id, location_description, notes, latitude, longitude, location_accuracy, preferred_time, terms_version, terms_accepted_at, account_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), (SELECT id FROM accounts WHERE id = $10 AND is_active)) RETURNING id`,
            [candidate, cust.rows[0].id, locationDescription, notes, lat, lng, accuracy, preferredTime, Number(settings.terms_version) || 1, req.session.account ? req.session.account.id : null]
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
      res.json({ ok: true, ref });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

router.get(
  '/track',
  trackLimit,
  wrap(async (req, res) => {
    const settings = await getSettings();
    const ctx = { settings, account: req.session.account };
    const ref = cleanText(req.query.ref, 20).toUpperCase();
    const phone = cleanText(req.query.phone, 20);

    if (!ref && !phone) return res.view(trackPage(ctx, {}));
    if (!ref || !validPhone(phone)) return res.view(trackPage(ctx, { ref, error: 'Enter both your reference code and phone number.' }));

    const found = await pool.query(
      `SELECT r.id, r.ref_code, r.status, c.phone_key
         FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.ref_code = $1`,
      [ref]
    );
    if (!found.rows.length || found.rows[0].phone_key !== phoneKey(phone)) {
      return res.view(trackPage(ctx, { ref, error: 'We could not find a request matching those details. Please check and try again.' }));
    }

    const r = found.rows[0];
    const [items, events] = await Promise.all([
      pool.query('SELECT category_name, quantity FROM request_items WHERE request_id = $1 ORDER BY id', [r.id]),
      pool.query('SELECT status, note, created_at FROM request_events WHERE request_id = $1 ORDER BY created_at DESC, id DESC', [r.id]),
    ]);
    res.view(trackPage(ctx, { ref, result: { ref_code: r.ref_code, status: r.status, items: items.rows, events: events.rows } }));
  })
);

module.exports = router;
