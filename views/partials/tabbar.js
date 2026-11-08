// Bottom navigation bar for phones (hidden on larger screens by CSS).
const { html } = require('../../lib/html');
const { icon } = require('../../lib/icons');

// Public site. On the home page the middle button opens the request wizard; on other pages it goes to /?start=1.
function publicTabbar(ctx, active = '', onHome = false) {
  const tab = (key, href, ic, label) => html`<a href="${href}" class="tab-item ${active === key ? 'active' : ''}" ${active === key ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
  return html`<nav class="tabbar" aria-label="Quick menu">
    ${tab('home', '/', 'house', 'Home')}
    ${tab('services', '/#categories', 'shirt', 'Services')}
    ${onHome
      ? html`<button type="button" class="tab-item tab-main" data-open-wizard aria-label="Tap to wash">${icon('droplets')}<span>Order</span></button>`
      : html`<a class="tab-item tab-main" href="/?start=1" aria-label="Tap to wash">${icon('droplets')}<span>Order</span></a>`}
    ${tab('track', '/track', 'map-pin', 'Track')}
    ${ctx.account ? tab('account', '/account', 'user-round', 'Account') : tab('account', '/account/login', 'user-round', 'Sign in')}
  </nav>`;
}

// Admin: the first four sections this role may open, plus "More" which opens the full menu.
function adminTabbar(ctx, nav, active) {
  const items = nav.filter((n) => ctx.can(n[4]) && n[0] !== 'whatsapp').slice(0, 4);
  return html`<nav class="tabbar admin-tabbar" aria-label="Quick menu">
    ${items.map(
      ([key, href, ic, label]) => html`<a href="${href}" class="tab-item ${key === active ? 'active' : ''}" ${key === active ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${key === 'requests' && ctx.newCount > 0 ? html`<b class="tab-badge">${ctx.newCount}</b>` : ''}</a>`
    )}
    <button type="button" class="tab-item" data-menu-open aria-label="More menu">${icon('menu')}<span>More</span></button>
  </nav>`;
}

module.exports = { publicTabbar, adminTabbar };
