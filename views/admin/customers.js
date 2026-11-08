const { html } = require('../../lib/html');
const { money, fmtDate } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { pager } = require('../partials/ui');
const { icon } = require('../../lib/icons');
const { csrfField } = require('../partials/ui');
const { waLink, validWaNumber } = require('../../lib/whatsapp');

function customersPage(ctx, { rows, total, page, pages, q, accounts = [], created = null }) {
  const cur = ctx.settings.currency;
  const base = `/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  const body = html`
  ${created
    ? html`<section class="glass pad notice">
        <h2>New temporary password for ${created.name}</h2>
        <p>Give these details to the customer now. <strong>The password is shown only once</strong> and they must choose their own when they sign in.</p>
        <p class="mono" style="font-size:1rem">Email: <strong>${created.email}</strong><br>Temporary password: <strong>${created.password}</strong></p>
        ${created.phone && validWaNumber(created.phone)
          ? html`<p><a class="btn btn-accent btn-sm" href="${waLink(created.phone, `Hello ${String(created.name).split(' ')[0]}, this is ${ctx.settings.business_name}. Your account password was reset.\nEmail: ${created.email}\nTemporary password: ${created.password}\nSign in at /account/login and choose your own password.`)}" target="_blank" rel="noopener">${icon('message-circle')} Send on WhatsApp</a></p>`
          : html`<p class="muted small">No phone number on the account - read the password to the customer.</p>`}
      </section>`
    : ''}
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
      : html`<div class="empty"><div class="big">${icon('users')}</div><p>No customers yet.</p></div>`}
  </section>
  ${ctx.can('accounts')
    ? html`<section class="glass pad">
    <div class="card-head"><h2>Customer accounts</h2><span class="muted small">${accounts.length} shown · customers who chose to sign up (guests are listed above)</span></div>
    ${accounts.length
      ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Orders</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>${accounts.map((a) => html`<tr>
          <td class="strong">${a.name}${a.is_active ? '' : html` <span class="badge pay-unpaid">Disabled</span>`}${a.must_change_password ? html` <span class="badge pay-partial">Temp password</span>` : ''}</td>
          <td>${a.email}</td>
          <td>${a.phone || '—'}</td>
          <td>${a.orders}</td>
          <td class="nowrap">${a.last_login_at ? fmtDate(a.last_login_at) : html`<span class="muted">Never</span>`}</td>
          <td class="nowrap">
            <form method="post" action="/admin/customers/accounts/${a.id}/reset" class="inline" data-confirm="Create a new temporary password for ${a.name}? Their current password will stop working.">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${icon('key-round')} Reset</button></form>
            <form method="post" action="/admin/customers/accounts/${a.id}/toggle" class="inline">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${a.is_active ? 'Disable' : 'Enable'}</button></form>
          </td>
        </tr>`)}</tbody></table></div>`
      : html`<div class="empty"><p>No customer accounts yet.</p></div>`}
  </section>`
    : ''}`;
  return adminLayout(ctx, { title: 'Customers', active: 'customers', body });
}

module.exports = { customersPage };
