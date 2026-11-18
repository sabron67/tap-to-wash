// Owner tools on the Settings page: the email server, and the emailed database backup (who gets it, when, and the backup password).
// Secrets are never shown again after saving: a blank password box means "keep the saved one".
const { wrap, cleanText } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const settings = require('../lib/backup-settings');
const mailer = require('../lib/mailer');
const backup = require('../lib/auto-backup');

const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

module.exports = function mount(router, { flash, need }) {
  router.post(
    '/settings/mail',
    need('settings'),
    wrap(async (req, res) => {
      const b = req.body;
      const host = cleanText(b.mail_host, 120).toLowerCase();
      const port = Number(cleanText(b.mail_port, 5));
      const user = cleanText(b.mail_user, 160);
      const from = cleanText(b.mail_from, 200);
      const pass = typeof b.mail_pass === 'string' ? b.mail_pass.trim().slice(0, 200) : '';
      const back = '/admin/settings#mailCard';
      if (host && !HOST_RE.test(host)) { flash(req, 'error', 'The mail server name looks wrong. Example: smtp.gmail.com'); return res.redirect(back); }
      if (host && !(Number.isInteger(port) && port > 0 && port < 65536)) { flash(req, 'error', 'The port must be a number such as 587 or 465.'); return res.redirect(back); }
      if (host && !user && !from) { flash(req, 'error', 'Enter the email address to send from.'); return res.redirect(back); }
      if (from && !/<[^<>@\s]+@[^<>@\s]+>$/.test(from) && !mailer.validEmail(from)) { flash(req, 'error', 'The "send from" address is not a valid email address.'); return res.redirect(back); }
      const patch = { mail_host: host, mail_port: host ? String(port) : '587', mail_secure: port === 465 ? '1' : '', mail_user: user, mail_from: from };
      if (!host) patch.mail_pass = ''; // clearing the server also forgets its password
      else if (pass) patch.mail_pass = /^([a-z]{4} ){3}[a-z]{4}$/i.test(pass) ? pass.replace(/ /g, '') : pass; // Google shows App Passwords as four groups of four letters with spaces
      await settings.save(patch);
      await audit(req, 'mail_settings', host ? `Email server set to ${host}:${port}${pass ? ' (password changed)' : ''}` : 'Email server removed');
      flash(req, 'success', host ? 'Email settings saved. Use "Send a test email" to check them.' : 'Email settings removed.');
      res.redirect(back);
    })
  );

  router.post(
    '/settings/mail/test',
    need('settings'),
    wrap(async (req, res) => {
      const to = cleanText(req.body.test_to, 160) || settings.get().backup_to || '';
      const back = '/admin/settings#mailCard';
      if (!mailer.validEmail(to)) { flash(req, 'error', 'Type the email address to send the test to.'); return res.redirect(back); }
      if (!mailer.enabled()) { flash(req, 'error', 'Email sending is not set up yet. Save the email settings first.'); return res.redirect(back); }
      const r = await mailer.send(to, 'Test email', 'This is a test email from your website. If you can read it, email sending works and backups can be delivered here.');
      await audit(req, 'mail_test', r.ok ? `Test email sent to ${to}` : `Test email to ${to} failed: ${r.error}`);
      flash(req, r.ok ? 'success' : 'error', r.ok ? `Test email sent to ${to}. Check the inbox (and the spam folder).` : `The test email failed: ${r.error}`);
      res.redirect(back);
    })
  );

  router.post(
    '/settings/backup',
    need('settings'),
    wrap(async (req, res) => {
      const b = req.body;
      const back = '/admin/settings#backupCard';
      const on = b.backup_on === '1';
      const to = cleanText(b.backup_to, 160);
      const hour = Math.min(23, Math.max(0, parseInt(b.backup_hour, 10) || 0));
      const pass = typeof b.backup_pass === 'string' ? b.backup_pass.trim() : '';
      if (to && !mailer.validEmail(to)) { flash(req, 'error', 'The backup email address is not valid.'); return res.redirect(back); }
      if (pass && pass.length < 8) { flash(req, 'error', 'The backup password must be at least 8 characters. A long phrase is best.'); return res.redirect(back); }
      if (pass.length > 200) { flash(req, 'error', 'The backup password is too long (200 characters at most).'); return res.redirect(back); }
      const hasPass = !!(pass || settings.passphrase());
      if (on && !mailer.validEmail(to)) { flash(req, 'error', 'Enter the email address that should receive the backups before switching them on.'); return res.redirect(back); }
      if (on && !hasPass) { flash(req, 'error', 'Choose a backup password before switching backups on. It protects the file, because a backup holds customer details.'); return res.redirect(back); }
      const patch = { backup_on: on ? '1' : '0', backup_to: to, backup_hour: String(hour) };
      if (pass) patch.backup_pass = pass;
      await settings.save(patch);
      await audit(req, 'backup_settings', `Email backups ${on ? `on, daily after ${hour}:00 to ${to}` : 'off'}${pass ? ' (backup password changed)' : ''}`);
      flash(req, 'success', on ? `Email backups are on. A backup goes to ${to} every day after ${String(hour).padStart(2, '0')}:00.${!mailer.enabled() ? ' Fill in "Email sending" below too, or nothing can be sent.' : ''}` : 'Email backups are off.');
      res.redirect(back);
    })
  );

  router.post(
    '/settings/backup/now',
    need('settings'),
    wrap(async (req, res) => {
      await settings.load();
      const r = await backup.runOnce({ by: req.session.admin });
      flash(req, r.ok ? 'success' : 'error', r.ok ? `Backup sent to ${r.to} (${(r.bytes / 1024).toFixed(0)} KB). Check the inbox (and the spam folder).` : `The backup was not sent: ${r.error}`);
      res.redirect('/admin/settings#backupCard');
    })
  );
};
