// Staff alerts: the bell, the alert feed polled by the page, phone push subscriptions and each person's channel switches.
const { pool } = require('../config/db');
const { wrap, cleanText } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { publicKey, pushToAdmin, available } = require('../lib/push');
const { validWaNumber, mode } = require('../lib/whatsapp');
const { notificationsPage } = require('../views/admin/notifications');

module.exports = function mount(router, { buildCtx, flash }) {
  // Polled every few seconds by the open admin page.
  router.get(
    '/api/alerts',
    wrap(async (req, res) => {
      const id = req.session.admin.id;
      const after = Math.max(parseInt(req.query.after, 10) || 0, 0);
      const [items, stat] = await Promise.all([
        pool.query('SELECT id, title, body, request_id FROM notifications WHERE admin_id = $1 AND id > $2 ORDER BY id LIMIT 20', [id, after]),
        pool.query('SELECT COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread, COALESCE(MAX(id), 0)::int AS last FROM notifications WHERE admin_id = $1', [id]),
      ]);
      res.json({
        unread: stat.rows[0].unread,
        last: stat.rows[0].last,
        items: items.rows.map((n) => ({ id: Number(n.id), title: n.title, body: n.body, url: `/admin/notifications/${n.id}/go` })),
      });
    })
  );

  router.get(
    '/notifications',
    wrap(async (req, res) => {
      const [ctx, rows] = await Promise.all([
        buildCtx(req),
        pool.query('SELECT id, title, body, created_at, read_at FROM notifications WHERE admin_id = $1 ORDER BY id DESC LIMIT 60', [req.session.admin.id]),
      ]);
      res.view(notificationsPage(ctx, { rows: rows.rows }));
    })
  );

  router.post(
    '/notifications/read',
    wrap(async (req, res) => {
      await pool.query('UPDATE notifications SET read_at = now() WHERE admin_id = $1 AND read_at IS NULL', [req.session.admin.id]);
      res.redirect('/admin/notifications');
    })
  );

  // Opening an alert marks it read and goes to the job (only ever touches the person's own alerts).
  router.get(
    '/notifications/:id/go',
    wrap(async (req, res) => {
      const nid = parseInt(req.params.id, 10);
      const { rows } = Number.isInteger(nid)
        ? await pool.query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND admin_id = $2 RETURNING request_id', [nid, req.session.admin.id])
        : { rows: [] };
      res.redirect(rows[0] && rows[0].request_id ? `/admin/requests/${rows[0].request_id}` : '/admin/notifications');
    })
  );

  // ---------- phone push ----------
  router.get(
    '/api/push/key',
    wrap(async (req, res) => {
      const key = available() ? await publicKey() : null;
      res.json({ ok: !!key, key });
    })
  );

  router.post(
    '/api/push/subscribe',
    wrap(async (req, res) => {
      const s = req.body || {};
      const endpoint = String(s.endpoint || '');
      const p256dh = s.keys && String(s.keys.p256dh || '');
      const auth = s.keys && String(s.keys.auth || '');
      if (!/^https:\/\/.{10,}/.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return res.status(400).json({ ok: false, error: 'Invalid subscription.' });
      await pool.query(
        `INSERT INTO push_subscriptions (admin_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
         ON CONFLICT (endpoint) DO UPDATE SET admin_id = EXCLUDED.admin_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
        [req.session.admin.id, endpoint, p256dh, auth]
      );
      await audit(req, 'push_enabled', 'Phone alerts enabled on a device');
      res.json({ ok: true });
    })
  );

  router.post(
    '/api/push/unsubscribe',
    wrap(async (req, res) => {
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND admin_id = $2', [String((req.body || {}).endpoint || ''), req.session.admin.id]);
      res.json({ ok: true });
    })
  );

  router.post(
    '/api/push/test',
    wrap(async (req, res) => {
      const sent = await pushToAdmin(req.session.admin.id, { title: 'Test alert', body: 'Phone alerts are working.', url: '/admin/notifications', tag: 'test' });
      res.json({ ok: true, sent });
    })
  );

  // ---------- my channel switches ----------
  router.post(
    '/account/notifications',
    wrap(async (req, res) => {
      const phone = cleanText(req.body.phone, 20);
      if (phone && !validWaNumber(phone)) {
        flash(req, 'error', 'That phone number does not look right (use e.g. 0712 345 678).');
        return res.redirect('/admin/account');
      }
      const on = (k) => req.body[k] === '1';
      await pool.query('UPDATE admins SET phone = $1, notify_inapp = $2, notify_push = $3, notify_whatsapp = $4 WHERE id = $5', [
        phone,
        on('notify_inapp'),
        on('notify_push'),
        on('notify_whatsapp'),
        req.session.admin.id,
      ]);
      flash(req, 'success', 'Alert settings saved.');
      res.redirect('/admin/account');
    })
  );
  void mode;
};
