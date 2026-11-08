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

  <section class="glass pad">
    <form class="stack" method="post" action="/admin/settings/terms">
      ${csrfField(ctx)}
      <div class="card-head"><h2>Terms of Service</h2><span class="muted small">Current version ${s.terms_version} · <a class="link" href="/terms" target="_blank" rel="noopener">View public page</a></span></div>
      <p class="muted small">Customers must accept these before sending a request. Use <span class="mono">## Heading</span> for headings, <span class="mono">- text</span> for bullet points and <span class="mono">{{business}}</span> for your business name. Saving a change creates a new version that customers accept afresh.</p>
      <textarea name="terms_text" rows="16" maxlength="20000" required>${s.terms_text}</textarea>
      <button class="btn btn-primary" type="submit">Save terms</button>
    </form>
  </section>`;

  return adminLayout(ctx, { title: 'Settings', active: 'settings', body });
}

module.exports = { settingsPage };
