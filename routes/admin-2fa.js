// Two-step verification: set up, turn off and new recovery codes (signed-in admin and staff).
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { pool } = require('../config/db');
const { wrap } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { getSettings } = require('../lib/settings');
const totp = require('../lib/totp');
const twofa = require('../lib/twofa');
const { setupPage, recoveryPage } = require('../views/admin/twofa');
const { rateLimit } = require('../lib/security');

const limit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, name: 'twofa-account', message: 'Too many attempts. Please wait a few minutes.' });

module.exports = function mount(router, { buildCtx, flash }) {
  const me = (req) => req.session.admin;
  const passwordOk = async (req, pw) => {
    const { rows } = await pool.query('SELECT password_hash FROM admins WHERE id = $1', [me(req).id]);
    return rows.length && (await bcrypt.compare(String(pw || '').slice(0, 200), rows[0].password_hash));
  };

  const showSetup = async (req, res, error = '') => {
    if (!req.session.twofaSetup) req.session.twofaSetup = totp.newSecret();
    const secret = req.session.twofaSetup;
    const settings = await getSettings();
    const uri = totp.otpauthUri(secret, me(req).email, settings.business_name || 'Tap to Wash');
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    const ctx = await buildCtx(req);
    ctx.require2fa = settings.require_2fa === '1';
    res.status(error ? 400 : 200).view(setupPage(ctx, { qr, secret, error }));
  };

  router.get('/account/2fa/setup', wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT totp_enabled FROM admins WHERE id = $1', [me(req).id]);
    if (rows[0] && rows[0].totp_enabled) return res.redirect('/admin/account');
    await showSetup(req, res);
  }));

  router.post('/account/2fa/enable', limit, wrap(async (req, res) => {
    const secret = req.session.twofaSetup;
    if (!secret) return res.redirect('/admin/account/2fa/setup');
    if (totp.verify(secret, req.body.code) === null) {
      await audit(req, 'twofa_setup_failed', 'Wrong code while setting up two-step verification');
      return showSetup(req, res, 'That code is not right. Check the code in your app and try again.');
    }
    const codes = await twofa.enable(me(req).id, secret);
    delete req.session.twofaSetup;
    req.session.admin.twofa = true;
    await audit(req, 'twofa_enabled', 'Two-step verification turned on');
    res.view(recoveryPage(await buildCtx(req), { codes }));
  }));

  router.post('/account/2fa/disable', limit, wrap(async (req, res) => {
    const settings = await getSettings();
    if (settings.require_2fa === '1') {
      flash(req, 'error', 'The owner requires two-step verification, so it cannot be turned off.');
      return res.redirect('/admin/account#twofa');
    }
    if (!(await passwordOk(req, req.body.password)) || !(await twofa.checkSecondFactor(me(req).id, req.body.code))) {
      await audit(req, 'twofa_disable_failed', 'Wrong password or code');
      flash(req, 'error', 'Your password or code was not right.');
      return res.redirect('/admin/account#twofa');
    }
    await twofa.disable(me(req).id);
    await audit(req, 'twofa_disabled', 'Two-step verification turned off');
    flash(req, 'success', 'Two-step verification is off.');
    res.redirect('/admin/account#twofa');
  }));

  router.post('/account/2fa/recovery', limit, wrap(async (req, res) => {
    if (!(await passwordOk(req, req.body.password))) {
      flash(req, 'error', 'Your password was not right.');
      return res.redirect('/admin/account#twofa');
    }
    const { rows } = await pool.query('SELECT totp_enabled FROM admins WHERE id = $1', [me(req).id]);
    if (!rows[0] || !rows[0].totp_enabled) return res.redirect('/admin/account');
    const codes = await twofa.newRecovery(me(req).id);
    await audit(req, 'twofa_recovery_new', 'New recovery codes created');
    res.view(recoveryPage(await buildCtx(req), { codes, title: 'New recovery codes' }));
  }));
};
