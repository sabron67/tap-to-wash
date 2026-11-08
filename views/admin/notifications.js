const { html } = require('../../lib/html');
const { fmtDate } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { icon } = require('../../lib/icons');

function notificationsPage(ctx, { rows }) {
  const unread = rows.filter((r) => !r.read_at).length;
  const body = html`
  <section class="glass pad">
    <div class="card-head">
      <h2>Alerts</h2>
      ${unread ? html`<form method="post" action="/admin/notifications/read" class="inline">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${icon('check')} Mark all read</button></form>` : html`<span class="muted small">All caught up</span>`}
    </div>
    ${rows.length
      ? html`<ul class="alert-list">${rows.map(
          (n) => html`<li class="${n.read_at ? '' : 'unread'}">
            <a href="/admin/notifications/${n.id}/go"><strong>${n.title}</strong><span class="muted small">${n.body}</span><span class="muted small">${fmtDate(n.created_at)}</span></a>
          </li>`
        )}</ul>`
      : html`<div class="empty"><div class="big">${icon('bell')}</div><p>No alerts yet. New jobs for your role will appear here.</p></div>`}
    <p class="muted small">Choose how you are alerted in <a class="link" href="/admin/account">My account</a>.</p>
  </section>`;
  return adminLayout(ctx, { title: 'Alerts', active: 'notifications', body });
}

module.exports = { notificationsPage };
