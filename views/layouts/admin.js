const { html } = require('../../lib/html');
const { head } = require('./public');
const { csrfField } = require('../partials/ui');
const { themeSwitch } = require('../partials/theme');
const { icon } = require('../../lib/icons');
const { adminTabbar } = require('../partials/tabbar');

const NAV = [
  ['dashboard', '/admin', 'layout-dashboard', 'Dashboard', 'dashboard'],
  ['requests', '/admin/requests', 'clipboard-list', 'Requests', 'requests'],
  ['categories', '/admin/categories', 'tag', 'Categories', 'categories'],
  ['customers', '/admin/customers', 'users', 'Customers', 'customers'],
  ['reports', '/admin/reports', 'file-spreadsheet', 'Reports', 'reports'],
  ['photos', '/admin/photos', 'image', 'Photos', 'photos'],
  ['staff', '/admin/staff', 'shield-check', 'Staff', 'staff'],
  ['activity', '/admin/activity', 'history', 'Activity', 'activity'],
  ['settings', '/admin/settings', 'settings', 'Settings', 'settings'],
  ['whatsapp', '/admin/whatsapp', 'message-circle', 'WhatsApp', 'settings'],
];

function adminLayout(ctx, { title, active, body }) {
  const s = ctx.settings;
  return html`<!doctype html>
<html lang="en">
<head>
${head(`${title} · Admin`, s)}
<meta name="robots" content="noindex,nofollow">
</head>
<body class="admin">
<div class="shell">
  <aside class="sidebar glass" id="sidebar">
    <a class="brand" href="${ctx.can('dashboard') ? '/admin' : '/admin/requests'}"><span>${s.business_name}<small>Admin</small></span></a>
    <nav class="side-nav">
      ${NAV.filter((n) => ctx.can(n[4])).map(
        ([key, href, ic, label]) => html`<a href="${href}" class="${key === active ? 'active' : ''}">
          <span class="ni">${icon(ic)}</span><span>${label}</span>
          ${key === 'requests' && ctx.newCount > 0 ? html`<span class="count">${ctx.newCount}</span>` : ''}
        </a>`
      )}
    </nav>
    <div class="side-foot">
      <a href="/" target="_blank" rel="noopener" class="side-link">${icon('globe')} View website</a>
      <a class="side-link ${active === 'account' ? 'strong' : ''}" href="/admin/account">${icon('key-round')} My account</a>
      <div class="who">Signed in as <strong>${ctx.admin.name}</strong> · ${ctx.roleLabel}</div>
      <form method="post" action="/admin/logout">${csrfField(ctx)}<button class="btn btn-ghost btn-sm btn-block" type="submit">${icon('log-out')} Sign out</button></form>
    </div>
  </aside>

  <div class="main">
    <header class="topbar glass">
      <button class="icon-btn menu-btn" id="menuBtn" aria-label="Menu">${icon('menu')}</button>
      <h1>${title}</h1>
      <a class="icon-btn bell" id="bell" href="/admin/notifications" aria-label="Alerts" data-last="${ctx.lastAlert || 0}">${icon('bell')}<span class="bell-count" id="bellCount" ${ctx.unread ? '' : 'hidden'}>${ctx.unread || 0}</span></a>
      ${themeSwitch()}
      <span class="topbar-date">${new Intl.DateTimeFormat('en-KE', { dateStyle: 'full', timeZone: 'Africa/Nairobi' }).format(new Date())}</span>
    </header>
    ${ctx.flash ? html`<div class="flash ${ctx.flash.type}" role="status">${ctx.flash.msg}</div>` : ''}
    <main class="content">${body}</main>
  </div>
</div>
<div class="side-scrim" id="sideScrim"></div>
${adminTabbar(ctx, NAV, active)}
<script src="/js/theme.js"></script>
<script src="/js/password.js"></script>
<script src="/js/admin.js"></script>
</body>
</html>`;
}

module.exports = { adminLayout };
