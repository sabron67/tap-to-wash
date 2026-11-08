const { html } = require('../../lib/html');
const { publicLayout } = require('../layouts/public');
const { themeSwitch } = require('../partials/theme');
const { renderTerms } = require('../../lib/terms');

function termsPage(ctx) {
  const s = ctx.settings;
  const body = html`
  <header class="nav scrolled">
    <a class="brand" href="/"><span>${s.business_name}</span></a>
    <nav class="nav-links"><a href="/#categories">Services</a><a href="/track">Track order</a><a class="active" href="/terms">Terms</a></nav>
    ${themeSwitch()}
    <a class="btn btn-primary btn-sm" href="/">Tap to wash</a>
  </header>
  <main class="container narrow section" style="padding-top:calc(var(--nav-h) + 2.5rem)">
    <article class="glass terms">
      <h1>Terms of Service</h1>
      <p class="muted small">${s.business_name} · Version ${s.terms_version}</p>
      <div class="terms-body">${renderTerms(s.terms_text, s.business_name)}</div>
    </article>
  </main>`;
  return publicLayout(ctx, { title: 'Terms of Service', body, bodyClass: 'public' });
}

module.exports = { termsPage };
