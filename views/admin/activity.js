const { html } = require('../../lib/html');
const { fmtDate } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { pager } = require('../partials/ui');

function activityPage(ctx, { rows, total, page, pages }) {
  const body = html`
  <section class="glass pad">
    <div class="card-head"><h2>Activity log</h2><span class="muted small">${total} event${total === 1 ? '' : 's'} · sign-ins, changes and downloads</span></div>
    ${rows.length
      ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th><th>IP address</th></tr></thead>
          <tbody>${rows.map((r) => html`<tr><td class="nowrap">${fmtDate(r.created_at)}</td><td>${r.admin_email || '—'}</td><td><span class="badge">${r.action}</span></td><td>${r.detail}</td><td class="mono">${r.ip}</td></tr>`)}</tbody>
        </table></div>
        ${pager('/admin/activity', page, pages)}`
      : html`<p class="muted">Nothing recorded yet.</p>`}
  </section>`;
  return adminLayout(ctx, { title: 'Activity', active: 'activity', body });
}

module.exports = { activityPage };
