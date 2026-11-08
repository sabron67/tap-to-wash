// Owner tool: link the server to WhatsApp by scanning one QR code, check the link, send a test.
const { pool } = require('../config/db');
const { wrap } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const wa = require('../lib/whatsapp');
const { whatsappPage } = require('../views/admin/whatsapp');

module.exports = function mount(router, { buildCtx, flash, need }) {
  router.get(
    '/whatsapp',
    need('settings'),
    wrap(async (req, res) => {
      const { rows } = await pool.query('SELECT phone FROM admins WHERE id = $1', [req.session.admin.id]);
      res.view(whatsappPage(await buildCtx(req), { status: wa.status(), myPhone: (rows[0] && rows[0].phone) || '' }));
    })
  );

  router.get('/api/whatsapp/status', need('settings'), (req, res) => {
    const s = wa.status();
    res.json({ ok: true, state: s.state, qr: s.qr, error: s.error, number: s.number });
  });

  router.post(
    '/whatsapp/restart',
    need('settings'),
    wrap(async (req, res) => {
      wa.restart().catch(() => {});
      await audit(req, 'whatsapp_restart', 'WhatsApp connection restarted');
      flash(req, 'success', 'Restarting the WhatsApp connection. A QR code appears here in a few seconds if linking is needed.');
      res.redirect('/admin/whatsapp');
    })
  );

  router.post(
    '/whatsapp/logout',
    need('settings'),
    wrap(async (req, res) => {
      wa.logout().catch(() => {});
      await audit(req, 'whatsapp_unlink', 'WhatsApp account unlinked');
      flash(req, 'success', 'WhatsApp was unlinked. Scan the new QR code to link a number again.');
      res.redirect('/admin/whatsapp');
    })
  );

  router.post(
    '/whatsapp/test',
    need('settings'),
    wrap(async (req, res) => {
      const phone = String(req.body.phone || '').trim().slice(0, 20);
      if (!wa.validWaNumber(phone)) {
        flash(req, 'error', 'Enter a valid WhatsApp number, e.g. 0712 345 678.');
        return res.redirect('/admin/whatsapp');
      }
      const r = await wa.send(phone, 'Test message: automatic WhatsApp alerts are working.');
      flash(req, r.ok ? 'success' : 'error', r.ok ? 'Test message sent.' : `Could not send: ${r.error}`);
      res.redirect('/admin/whatsapp');
    })
  );
};
