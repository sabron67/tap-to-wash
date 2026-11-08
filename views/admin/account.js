const { html } = require('../../lib/html');
const { fmtDate } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { roleOf } = require('../../lib/roles');

function accountPage(ctx, { lastLogin }) {
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
  </section>`;
  return adminLayout(ctx, { title: 'My account', active: 'account', body });
}

module.exports = { accountPage };
