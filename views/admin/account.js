const { html } = require('../../lib/html');
const { fmtDate } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { roleOf } = require('../../lib/roles');
const { icon } = require('../../lib/icons');

function accountPage(ctx, { lastLogin, prefs, alerts, waMode }) {
  const role = roleOf(ctx.role);
  const body = html`
  ${ctx.admin.mustChange ? html`<div class="notice"><strong>Please choose your own password.</strong> You are using a temporary or default password. The rest of the admin area unlocks once you change it.</div>` : ''}
  <section class="grid-2 gap" style="margin-top:0">
    <div class="glass pad">
      <h2>My account</h2>
      <p><strong>${ctx.admin.name}</strong><br><span class="muted">${ctx.admin.email}</span></p>
      <p><span class="badge">${role.label}</span></p>
      <p class="muted small">${role.desc}</p>
      ${lastLogin ? html`<p class="muted small">Last sign-in: ${fmtDate(lastLogin)}</p>` : ''}
    </div>
    <form class="glass pad stack" method="post" action="/admin/account/password">
      ${csrfField(ctx)}
      <h2>Change my password</h2>
      <label class="field"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label>
      <label class="field"><span>New password</span><input type="password" name="password" minlength="10" required autocomplete="new-password"><small class="muted">At least 10 characters with a letter and a number.</small></label>
      <label class="field"><span>Repeat new password</span><input type="password" name="confirm" minlength="10" required autocomplete="new-password"></label>
      <button class="btn btn-primary" type="submit">Update password</button>
    </form>
  </section>
<form class="glass pad stack" method="post" action="/admin/account/notifications" style="margin-top:1.25rem">
    ${csrfField(ctx)}
    <h2>Job alerts</h2>
    <p class="muted small">${alerts.length ? html`As ${role.label.toLowerCase()} you are alerted when a job is: <strong>${alerts.join(', ')}</strong>.` : 'Your role does not receive automatic job alerts.'} Choose how you want to hear about them.</p>
    <label class="check"><input type="checkbox" name="notify_inapp" value="1" ${prefs.notify_inapp ? 'checked' : ''}><span><strong>In the admin</strong> - bell, sound and a pop-up while the page is open.</span></label>
    <label class="check"><input type="checkbox" name="notify_push" value="1" ${prefs.notify_push ? 'checked' : ''}><span><strong>On this phone or computer</strong> - even when the page is closed (needs the button below, once per device).</span></label>
    <div class="row-gap">
      <button class="btn btn-accent btn-sm" type="button" data-push-enable>${icon('smartphone')} Enable on this device</button>
      <button class="btn btn-ghost btn-sm" type="button" data-push-test>Send a test</button>
      <span class="muted small" data-push-status role="status"></span>
    </div>
    <label class="check"><input type="checkbox" name="notify_whatsapp" value="1" ${prefs.notify_whatsapp ? 'checked' : ''}><span><strong>WhatsApp</strong> - ${waMode === 'auto' ? 'alerts are sent to your number automatically.' : 'your manager can message you with one tap from the job page. (Automatic sending starts once the owner links WhatsApp under Admin → WhatsApp.)'}</span></label>
    <label class="field"><span>My WhatsApp number</span><input type="tel" name="phone" value="${prefs.phone}" maxlength="20" placeholder="0712 345 678"></label>
    <button class="btn btn-primary" type="submit">Save alert settings</button>
  </form>`;
  return adminLayout(ctx, { title: 'My account', active: 'account', body });
}

module.exports = { accountPage };
