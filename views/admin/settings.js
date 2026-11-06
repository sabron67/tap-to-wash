const { html, raw } = require('../../lib/html');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');

function settingsPage(ctx) {
  const s = ctx.settings;
  const input = (name, label, attrs = '', hint = '') => {
    const extra = raw(`${attrs.includes('maxlength') ? '' : 'maxlength="200" '}${attrs}`);
    return html`<label class="field"><span>${label}</span><input name="${name}" value="${s[name]}" ${extra}>${hint ? html`<small class="muted">${hint}</small>` : ''}</label>`;
  };

  const body = html`
  <section class="grid-2 gap">
    <form class="glass pad stack" method="post" action="/admin/settings">
      ${csrfField(ctx)}
      <h2>Business details</h2>
      ${input('business_name', 'Business name')}
      ${input('tagline', 'Headline on the home page')}
      <label class="field"><span>Short description</span><textarea name="about" rows="3" maxlength="400">${s.about}</textarea></label>
      <div class="grid-2">
        ${input('phone', 'Phone', 'type="tel"')}
        ${input('whatsapp', 'WhatsApp number', 'type="tel"', 'With country code, e.g. 254712345678')}
      </div>
      ${input('email', 'Email', 'type="email"')}
      ${input('address', 'Address / service area')}
      ${input('opening_hours', 'Opening hours')}
      ${input('currency', 'Currency code', 'maxlength="6"', 'e.g. KES')}
      <button class="btn btn-primary" type="submit">Save settings</button>
    </form>

    <form class="glass pad stack" method="post" action="/admin/settings/password">
      ${csrfField(ctx)}
      <h2>Change my password</h2>
      <p class="muted small">Signed in as <strong>${ctx.admin.email}</strong></p>
      <label class="field"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label>
      <label class="field"><span>New password</span><input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
      <label class="field"><span>Repeat new password</span><input type="password" name="confirm" minlength="8" required autocomplete="new-password"></label>
      <button class="btn btn-ghost" type="submit">Update password</button>
    </form>
  </section>`;

  return adminLayout(ctx, { title: 'Settings', active: 'settings', body });
}

module.exports = { settingsPage };
