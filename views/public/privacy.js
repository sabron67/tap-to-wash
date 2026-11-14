const { html } = require('../../lib/html');
const { publicLayout } = require('../layouts/public');
const { pubNav } = require('../partials/pubnav');
const { renderTerms } = require('../../lib/terms');

function privacyPage(ctx) {
  const s = ctx.settings;
  const body = html`
  ${pubNav(ctx, 'privacy')}
  <main class="container narrow section" style="padding-top:calc(var(--nav-h) + 2.5rem)">
    <article class="glass terms">
      <h1>Privacy Notice</h1>
      <p class="muted small">${s.business_name} · Version ${s.privacy_version} · <a class="link" href="/terms">Terms of Service</a></p>
      <div class="terms-body">${renderTerms(s.privacy_text, s.business_name)}</div>
    </article>
  </main>`;
  return publicLayout(ctx, { title: 'Privacy Notice', body, bodyClass: 'public', seo: { canonical: require('../../lib/seo').abs('/privacy') } });
}

module.exports = { privacyPage };
