// Admin extras: Excel reports, background photos and the activity log.
const express = require('express');
const { pool } = require('../config/db');
const { getSettings } = require('../lib/settings');
const { wrap, cleanText } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { SLOTS, mediaVersions } = require('../lib/media');
const { buildWorkbook } = require('../lib/report');
const { reportsPage } = require('../views/admin/reports');
const { photosPage } = require('../views/admin/photos');
const { activityPage } = require('../views/admin/activity');

const MAX_PHOTO = 2.5 * 1024 * 1024;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const validYmd = (s) => YMD.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// Index-friendly range on created_at, using Nairobi calendar days.
const RANGE = `r.created_at >= ($1::date)::timestamp AT TIME ZONE 'Africa/Nairobi' AND r.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')`;

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function todayNairobi() {
  const { rows } = await pool.query(`SELECT to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS d`);
  return rows[0].d;
}

function presets(today) {
  const y = today.slice(0, 4);
  const m = today.slice(0, 7);
  const firstThis = `${m}-01`;
  const lastPrev = addDays(firstThis, -1);
  return [
    ['This month', firstThis, today],
    ['Last month', `${lastPrev.slice(0, 7)}-01`, lastPrev],
    ['Last 30 days', addDays(today, -29), today],
    ['Last 90 days', addDays(today, -89), today],
    ['This year', `${y}-01-01`, today],
    ['All time', '2000-01-01', today],
  ];
}

async function resolveRange(q) {
  const today = await todayNairobi();
  let from = cleanText(q.from, 10);
  let to = cleanText(q.to, 10);
  if (!validYmd(from)) from = `${today.slice(0, 7)}-01`;
  if (!validYmd(to)) to = today;
  if (from > to) [from, to] = [to, from];
  return { from, to, today };
}

module.exports = function mount(router, { buildCtx, flash }) {
  /* ---------- reports ---------- */
  router.get(
    '/reports',
    wrap(async (req, res) => {
      const { from, to, today } = await resolveRange(req.query);
      const [ctx, k] = await Promise.all([
        buildCtx(req),
        pool.query(
          `SELECT COUNT(*)::int AS requests,
                  COUNT(*) FILTER (WHERE r.status = 'delivered')::int AS delivered,
                  COALESCE(SUM(r.total_amount), 0) AS billed,
                  COALESCE(SUM(r.amount_paid), 0) AS collected,
                  COALESCE(SUM(GREATEST(r.total_amount - r.amount_paid, 0)) FILTER (WHERE r.status <> 'cancelled'), 0) AS outstanding
             FROM requests r WHERE ${RANGE}`,
          [from, to]
        ),
      ]);
      res.view(reportsPage(ctx, { from, to, kpi: k.rows[0], presets: presets(today) }));
    })
  );

  router.get(
    '/reports/download',
    wrap(async (req, res) => {
      const { from, to } = await resolveRange(req.query);
      const [settings, reqs, itemRows, custs, cats] = await Promise.all([
        getSettings(),
        pool.query(
          `SELECT r.ref_code, to_char((r.created_at AT TIME ZONE 'Africa/Nairobi')::date, 'YYYY-MM-DD') AS day, r.status, r.location_description,
                  r.total_amount, r.amount_paid, r.terms_version, c.name AS customer_name, c.phone AS customer_phone,
                  (SELECT string_agg(i.category_name || ' x' || i.quantity, ', ' ORDER BY i.id) FROM request_items i WHERE i.request_id = r.id) AS items,
                  (SELECT to_char((max(e.created_at) AT TIME ZONE 'Africa/Nairobi')::date, 'YYYY-MM-DD') FROM request_events e WHERE e.request_id = r.id AND e.status = 'delivered') AS delivered_day
             FROM requests r JOIN customers c ON c.id = r.customer_id
            WHERE ${RANGE} ORDER BY r.created_at DESC LIMIT 5001`,
          [from, to]
        ),
        pool.query(
          `SELECT r.ref_code, to_char((r.created_at AT TIME ZONE 'Africa/Nairobi')::date, 'YYYY-MM-DD') AS day, i.category_name, i.quantity
             FROM request_items i JOIN requests r ON r.id = i.request_id
            WHERE ${RANGE} AND r.status <> 'cancelled' ORDER BY r.created_at DESC, i.id LIMIT 10001`,
          [from, to]
        ),
        pool.query(
          `SELECT c.name, c.phone, MAX(r.created_at) AS last
             FROM customers c JOIN requests r ON r.customer_id = c.id
            WHERE ${RANGE} GROUP BY c.id ORDER BY MAX(r.created_at) DESC LIMIT 2001`,
          [from, to]
        ),
        pool.query('SELECT name, unit, price, is_active FROM categories ORDER BY sort_order, name LIMIT 100'),
      ]);
      const truncated = { requests: reqs.rows.length > 5000, items: itemRows.rows.length > 10000, customers: custs.rows.length > 2000 };
      const wb = await buildWorkbook({
        settings,
        from,
        to,
        requests: reqs.rows.slice(0, 5000),
        items: itemRows.rows.slice(0, 10000),
        customers: custs.rows.slice(0, 2000),
        categories: cats.rows,
        truncated,
      });
      const buf = await wb.xlsx.writeBuffer();
      await audit(req, 'report_download', `Excel report ${from} to ${to}`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="TapToWash_Report_${from}_to_${to}.xlsx"`);
      res.send(Buffer.from(buf));
    })
  );

  /* ---------- background photos ---------- */
  router.get(
    '/photos',
    wrap(async (req, res) => {
      const [ctx, versions] = await Promise.all([buildCtx(req), mediaVersions()]);
      res.view(photosPage(ctx, { versions }));
    })
  );

  router.post(
    '/photos/:slot',
    express.raw({ type: 'image/jpeg', limit: '3mb' }),
    wrap(async (req, res) => {
      const slot = req.params.slot;
      const buf = req.body;
      if (!Object.prototype.hasOwnProperty.call(SLOTS, slot)) return res.status(404).json({ ok: false, error: 'Unknown picture slot.' });
      if (!Buffer.isBuffer(buf) || buf.length < 1000) return res.status(400).json({ ok: false, error: 'No image received.' });
      if (buf.length > MAX_PHOTO) return res.status(413).json({ ok: false, error: 'That image is too large. Choose a smaller one.' });
      // Only real JPEG files: starts with FF D8 FF and ends with FF D9.
      if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) || !(buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9)) {
        return res.status(400).json({ ok: false, error: 'Only JPEG pictures are accepted.' });
      }
      await pool.query(
        `INSERT INTO media (slot, mime, data, updated_at) VALUES ($1, 'image/jpeg', $2, now())
         ON CONFLICT (slot) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`,
        [slot, buf]
      );
      await audit(req, 'photo_upload', `${slot} (${Math.round(buf.length / 1024)} KB)`);
      res.json({ ok: true });
    })
  );

  router.post(
    '/photos/:slot/reset',
    wrap(async (req, res) => {
      if (Object.prototype.hasOwnProperty.call(SLOTS, req.params.slot)) {
        await pool.query('DELETE FROM media WHERE slot = $1', [req.params.slot]);
        await audit(req, 'photo_reset', req.params.slot);
        flash(req, 'success', 'Picture reset to the default illustration.');
      }
      res.redirect('/admin/photos');
    })
  );

  /* ---------- activity log ---------- */
  router.get(
    '/activity',
    wrap(async (req, res) => {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const size = 30;
      const [ctx, count, rows] = await Promise.all([
        buildCtx(req),
        pool.query('SELECT COUNT(*)::int AS n FROM audit_log'),
        pool.query('SELECT admin_email, action, detail, ip, created_at FROM audit_log ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2', [size, (page - 1) * size]),
      ]);
      const total = count.rows[0].n;
      res.view(activityPage(ctx, { rows: rows.rows, total, page, pages: Math.max(Math.ceil(total / size), 1) }));
    })
  );
};
