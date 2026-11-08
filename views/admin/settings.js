const { html, raw } = require('../../lib/html');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { icon } = require('../../lib/icons');

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

  <section class="glass pad stack" id="faviconCard">
    <h2>Site icon (favicon)</h2>
    <p class="muted small">The small picture shown in the browser tab, bookmarks, the phone home screen and phone alerts. Choose a square logo or picture (PNG, JPG, WebP or SVG). It is resized to 512 × 512 in your browser and saved in the database. Browsers can keep an old icon for a while - refresh the page if the tab still shows the old one.</p>
    <div class="fav-row">
      <img class="fav-preview" src="/site-icon${s.icon_v ? `?v=${s.icon_v}` : ''}" alt="Current site icon" width="64" height="64">
      <div class="fav-controls">
        <p class="muted small" style="margin:0 0 .5rem">${s.icon_v ? 'Using your uploaded icon.' : 'Using the built-in icon.'}</p>
        <div class="row-form">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" id="faviconInput" aria-label="Choose a site icon">
          <button class="btn btn-primary btn-sm" type="button" id="faviconUpload">${icon('upload')} Upload icon</button>
        </div>
        <p class="err" id="faviconErr" role="alert"></p>
      </div>
    </div>
    ${s.icon_v
      ? html`<form method="post" action="/admin/settings/favicon/reset" class="inline" data-confirm="Go back to the built-in icon?">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${icon('rotate-ccw')} Reset to built-in icon</button></form>`
      : ''}
    <input type="hidden" id="csrfToken" value="${ctx.csrf}">
  </section>

  <section class="glass pad">
    <form class="stack" method="post" action="/admin/settings/terms">
      ${csrfField(ctx)}
      <div class="card-head"><h2>Terms of Service</h2><span class="muted small">Current version ${s.terms_version} · <a class="link" href="/terms" target="_blank" rel="noopener">View public page</a></span></div>
      <p class="muted small">Customers must accept these before sending a request. Use <span class="mono">## Heading</span> for headings, <span class="mono">- text</span> for bullet points and <span class="mono">{{business}}</span> for your business name. Saving a change creates a new version that customers accept afresh.</p>
      <textarea name="terms_text" rows="16" maxlength="20000" required>${s.terms_text}</textarea>
      <button class="btn btn-primary" type="submit">Save terms</button>
    </form>
  </section>

  <section class="glass pad">
    <form class="stack" method="post" action="/admin/settings/privacy">
      ${csrfField(ctx)}
      <div class="card-head"><h2>Privacy Notice</h2><span class="muted small">Current version ${s.privacy_version} · <a class="link" href="/privacy" target="_blank" rel="noopener">View public page</a></span></div>
      <p class="muted small">Shown to customers who create an account. Same format as the terms. This is a starting point - please check it matches how you really handle customer information.</p>
      <textarea name="privacy_text" rows="14" maxlength="20000" required>${s.privacy_text}</textarea>
      <button class="btn btn-primary" type="submit">Save Privacy Notice</button>
    </form>
  </section>`;

  return adminLayout(ctx, { title: 'Settings', active: 'settings', body });
}

module.exports = { settingsPage };
