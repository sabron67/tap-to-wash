const { html } = require('../../lib/html');
const { themeSwitch } = require('./theme');
const { publicTabbar } = require('./tabbar');

// Header used on the simple public pages (track, terms, privacy, account).
function pubNav(ctx, active = '') {
  const s = ctx.settings;
  const link = (key, href, label) => html`<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return html`<header class="nav scrolled">
    <a class="brand" href="/"><span>${s.business_name}</span></a>
    <nav class="nav-links" aria-label="Main">
      ${link('services', '/#categories', 'Services')}
      ${link('track', '/track', 'Track order')}
      ${link('terms', '/terms', 'Terms')}
      ${ctx.account ? link('account', '/account', 'My account') : link('account', '/account/login', 'Sign in')}
    </nav>
    ${themeSwitch()}
    <a class="btn btn-primary btn-sm" href="/">Tap to wash</a>
  </header>
  ${publicTabbar(ctx, ({ account: 'account', track: 'track', services: 'services' })[active] || '')}`;
}

// Phone bottom bar for the simple public pages.
const pubTabs = (ctx, active) => publicTabbar(ctx, ({ account: 'account', track: 'track', services: 'services' })[active] || '');

module.exports = { pubNav, pubTabs };
