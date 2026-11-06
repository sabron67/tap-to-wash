const { html } = require('../../lib/html');
const { head, blobs } = require('./public');
const { logo } = require('../partials/logo');
const { csrfField } = require('../partials/ui');
const { themeSwitch } = require('../partials/theme');

const NAV = [
  ['dashboard', '/admin', '📊', 'Dashboard'],
  ['requests', '/admin/requests', '🧺', 'Requests'],
  ['categories', '/admin/categories', '🏷️', 'Categories'],
  ['customers', '/admin/customers', '👥', 'Customers'],
  ['settings', '/admin/settings', '⚙️', 'Settings'],
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
${blobs}
<div class="shell">
  <aside class="sidebar glass" id="sidebar">
    <a class="brand" href="/admin">${logo({ prefix: 'adm', animated: false, className: 'brand-logo' })}<span>${s.business_name}<small>Admin</small></span></a>
    <nav class="side-nav">
      ${NAV.map(
        ([key, href, icon, label]) => html`<a href="${href}" class="${key === active ? 'active' : ''}">
          <span class="ni">${icon}</span><span>${label}</span>
          ${key === 'requests' && ctx.newCount > 0 ? html`<span class="count">${ctx.newCount}</span>` : ''}
        </a>`
      )}
    </nav>
    <div class="side-foot">
      <a href="/" target="_blank" rel="noopener" class="side-link">🌐 View website</a>
      <div class="who">Signed in as <strong>${ctx.admin.name}</strong></div>
      <form method="post" action="/admin/logout">${csrfField(ctx)}<button class="btn btn-ghost btn-sm btn-block" type="submit">Sign out</button></form>
    </div>
  </aside>

  <div class="main">
    <header class="topbar glass">
      <button class="icon-btn menu-btn" id="menuBtn" aria-label="Menu">☰</button>
      <h1>${title}</h1>
      ${themeSwitch()}
      <span class="topbar-date">${new Intl.DateTimeFormat('en-KE', { dateStyle: 'full', timeZone: 'Africa/Nairobi' }).format(new Date())}</span>
    </header>
    ${ctx.flash ? html`<div class="flash ${ctx.flash.type}" role="status">${ctx.flash.msg}</div>` : ''}
    <main class="content">${body}</main>
  </div>
</div>
<script src="/js/theme.js"></script>
<script src="/js/admin.js"></script>
</body>
</html>`;
}

module.exports = { adminLayout };
