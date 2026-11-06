const { html } = require('../../lib/html');
const { money, fmtDate } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { pager } = require('../partials/ui');

function customersPage(ctx, { rows, total, page, pages, q }) {
  const cur = ctx.settings.currency;
  const base = `/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  const body = html`
  <section class="glass pad">
    <form class="filters" method="get" action="/admin/customers">
      <input class="search" type="search" name="q" value="${q}" placeholder="Search name, phone or email…">
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
      ${q ? html`<a class="btn btn-ghost btn-sm" href="/admin/customers">Clear</a>` : ''}
    </form>
    ${rows.length
      ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Customer</th><th>Phone</th><th>Requests</th><th>Paid</th><th>Last request</th><th></th></tr></thead>
          <tbody>${rows.map(
            (c) => html`<tr>
              <td class="strong">${c.name}</td>
              <td><a class="link" href="tel:${c.phone}">${c.phone}</a></td>
              <td>${c.requests}</td>
              <td>${money(c.paid, cur)}</td>
              <td class="nowrap">${c.last_request ? fmtDate(c.last_request) : '—'}</td>
              <td><a class="btn btn-ghost btn-sm" href="/admin/requests?q=${encodeURIComponent(c.phone)}">View requests</a></td>
            </tr>`
          )}</tbody></table></div>
        ${pager(base, page, pages)}
        <p class="muted small">${total} customer${total === 1 ? '' : 's'}</p>`
      : html`<div class="empty"><div class="big">👥</div><p>No customers yet.</p></div>`}
  </section>`;
  return adminLayout(ctx, { title: 'Customers', active: 'customers', body });
}

module.exports = { customersPage };
