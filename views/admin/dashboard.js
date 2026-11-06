const { html } = require('../../lib/html');
const { money, fmtDate } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { statusBadge } = require('../partials/ui');
const { icon } = require('../../lib/icons');

function dashboardPage(ctx, d) {
  const cur = ctx.settings.currency;
  const max = Math.max(1, ...d.week.map((w) => w.n));

  const stat = (ic, label, value, tone, href) => html`<a class="stat glass tone-${tone}" href="${href}">
    <span class="stat-ico">${icon(ic)}</span>
    <span class="stat-val">${value}</span>
    <span class="stat-label">${label}</span>
  </a>`;

  const body = html`
  <section class="stats">
    ${stat('sparkles', 'New requests', d.counts.new, 'amber', '/admin/requests?status=new')}
    ${stat('droplets', 'In progress', d.counts.in_progress, 'cyan', '/admin/requests')}
    ${stat('shopping-basket', 'Ready for delivery', d.counts.ready, 'green', '/admin/requests?status=ready')}
    ${stat('users', 'Customers', d.customers, 'violet', '/admin/customers')}
    ${stat('wallet', 'Collected this month', money(d.collected, cur), 'pink', '/admin/requests')}
    ${stat('receipt', 'Outstanding balance', money(d.outstanding, cur), 'red', '/admin/requests')}
  </section>

  <section class="grid-main">
    <div class="glass pad">
      <div class="card-head"><h2>Requests · last 7 days</h2><span class="muted small">${d.week.reduce((a, w) => a + w.n, 0)} total</span></div>
      <div class="bars">
        ${d.week.map((w) => html`<div class="bar-col"><span class="bar-n">${w.n}</span><div class="bar" style="height:${Math.max(6, Math.round((w.n / max) * 100))}%"></div><span class="bar-l">${w.label}</span></div>`)}
      </div>
    </div>

    <div class="glass pad">
      <div class="card-head"><h2>Quick actions</h2></div>
      <div class="quick">
        <a class="btn btn-primary" href="/admin/requests?status=new">Review new requests</a>
        <a class="btn btn-ghost" href="/admin/categories">Manage categories</a>
        <a class="btn btn-ghost" href="/admin/settings">Business settings</a>
        <a class="btn btn-ghost" href="/" target="_blank" rel="noopener">Open public site</a>
      </div>
    </div>
  </section>

  <section class="glass pad">
    <div class="card-head"><h2>Latest requests</h2><a class="link" href="/admin/requests">View all ${icon('arrow-right')}</a></div>
    ${d.recent.length
      ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Ref</th><th>Customer</th><th>Items</th><th>Status</th><th>Received</th></tr></thead>
          <tbody>${d.recent.map(
            (r) => html`<tr>
              <td><a class="link strong" href="/admin/requests/${r.id}">${r.ref_code}</a></td>
              <td>${r.customer_name}<div class="muted small">${r.customer_phone}</div></td>
              <td class="clip">${r.items || '—'}</td>
              <td>${statusBadge(r.status)}</td>
              <td class="nowrap">${fmtDate(r.created_at)}</td>
            </tr>`
          )}</tbody></table></div>`
      : html`<div class="empty"><div class="big">${icon('droplets')}</div><p>No requests yet. They will appear here as customers tap to wash.</p></div>`}
  </section>`;

  return adminLayout(ctx, { title: 'Dashboard', active: 'dashboard', body });
}

module.exports = { dashboardPage };
