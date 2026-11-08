const { html } = require('../../lib/html');
const { STATUSES, STATUS_MAP, FLOW, nextStatus, money, fmtDate, mapsLink } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { csrfField, statusBadge, paymentBadge, timeline, pager } = require('../partials/ui');
const { icon } = require('../../lib/icons');

function requestsPage(ctx, { rows, total, page, pages, status, q, tabCounts }) {
  const cur = ctx.settings.currency;
  const qs = (st) => {
    const p = new URLSearchParams();
    if (st) p.set('status', st);
    if (q) p.set('q', q);
    const s = p.toString();
    return `/admin/requests${s ? `?${s}` : ''}`;
  };
  const base = (() => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (q) p.set('q', q);
    const s = p.toString();
    return `/admin/requests${s ? `?${s}` : ''}`;
  })();

  const body = html`
  <section class="glass pad">
    <form class="filters" method="get" action="/admin/requests">
      <input type="hidden" name="status" value="${status}">
      <input class="search" type="search" name="q" value="${q}" placeholder="Search ref, name, phone or location…">
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
      ${q || status ? html`<a class="btn btn-ghost btn-sm" href="/admin/requests">Clear</a>` : ''}
    </form>

    <div class="tabs">
      <a class="tab ${status === '' ? 'active' : ''}" href="${qs('')}">All <span>${tabCounts.all}</span></a>
      ${STATUSES.filter((s) => !ctx.visible || ctx.visible.includes(s.key)).map((s) => html`<a class="tab ${status === s.key ? 'active' : ''}" href="${qs(s.key)}">${icon(s.icon)} ${s.label} <span>${tabCounts[s.key] || 0}</span></a>`)}
    </div>

    ${rows.length
      ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Ref</th><th>Customer</th><th>Items</th><th>Location</th><th>Status</th>${ctx.can('billing') ? html`<th>Payment</th>` : ''}<th>Received</th></tr></thead>
          <tbody>${rows.map(
            (r) => html`<tr>
              <td><a class="link strong" href="/admin/requests/${r.id}">${r.ref_code}</a></td>
              <td>${r.customer_name}<div class="muted small">${r.customer_phone}</div></td>
              <td class="clip">${r.items || '—'}</td>
              <td class="clip">${r.latitude !== null ? html`<a class="link" href="${mapsLink(r.latitude, r.longitude)}" target="_blank" rel="noopener" aria-label="Open location in maps">${icon('map-pin')}</a> ` : ''}${r.location_description}</td>
              <td>${statusBadge(r.status)}</td>
              ${ctx.can('billing') ? html`<td>${paymentBadge(r.total_amount, r.amount_paid)}<div class="muted small">${Number(r.total_amount) > 0 ? money(r.total_amount, cur) : ''}</div></td>` : ''}
              <td class="nowrap">${fmtDate(r.created_at)}</td>
            </tr>`
          )}</tbody></table></div>
        ${pager(base, page, pages)}
        <p class="muted small">${total} request${total === 1 ? '' : 's'}</p>`
      : html`<div class="empty"><div class="big">${icon('clipboard-list')}</div><p>No requests match.</p></div>`}
  </section>`;

  return adminLayout(ctx, { title: 'Requests', active: 'requests', body });
}

function requestDetailPage(ctx, { r, items, events, estimate, wa }) {
  const cur = ctx.settings.currency;
  const nxt = nextStatus(r.status);
  const balance = Math.max(0, Number(r.total_amount) - Number(r.amount_paid));

  const body = html`
  <a class="link back" href="/admin/requests">${icon('arrow-left')} All requests</a>

  <section class="glass pad">
    <div class="detail-head">
      <div>
        <span class="muted small">Reference</span>
        <div class="ref-box sm">${r.ref_code}</div>
        <div class="muted small">Received ${fmtDate(r.created_at)}</div>
      </div>
      <div class="detail-badges">${statusBadge(r.status)} ${ctx.can('billing') ? paymentBadge(r.total_amount, r.amount_paid) : ''} <a class="btn btn-ghost btn-sm" href="/admin/requests/${r.id}/receipt">Receipt</a></div>
    </div>
    ${timeline(r.status)}
    ${ctx.settable && ctx.settable.length === 0
      ? ''
      : html`<div class="status-actions">
      ${nxt && (!ctx.settable || ctx.settable.includes(nxt))
        ? html`<form method="post" action="/admin/requests/${r.id}/status" class="inline">${csrfField(ctx)}<input type="hidden" name="status" value="${nxt}"><button class="btn btn-primary" type="submit">Move to: ${icon(STATUS_MAP[nxt].icon)} ${STATUS_MAP[nxt].label}</button></form>`
        : ''}
      <form method="post" action="/admin/requests/${r.id}/status" class="inline row-form">
        ${csrfField(ctx)}
        <select name="status" aria-label="Set status">${STATUSES.filter((s) => !ctx.settable || ctx.settable.includes(s.key)).map((s) => html`<option value="${s.key}" ${s.key === r.status ? 'selected' : ''}>${s.label}</option>`)}</select>
        <input name="note" type="text" maxlength="200" placeholder="Optional note for the customer">
        <button class="btn btn-ghost" type="submit">Update status</button>
      </form>
    </div>`}
  </section>


  ${wa.team.length
    ? html`<section class="glass pad">
    <h2>Alert the team on WhatsApp</h2>
    <p class="muted small">${wa.headline}: tap a name and WhatsApp opens with the job details ready - just press Send.${wa.auto ? ' Staff who turned on WhatsApp alerts are also messaged automatically.' : ''}</p>
    <div class="row-gap">${wa.team.map((p) => (p.link
      ? html`<a class="btn btn-accent btn-sm" href="${p.link}" target="_blank" rel="noopener">${icon('message-circle')} ${p.name}</a>`
      : html`<span class="badge pay-partial" title="Add their number on the Staff page">${p.name}: no number</span>`))}</div>
  </section>`
    : ''}

  <section class="grid-2 gap">
    <div class="glass pad">
      <h2>Customer</h2>
      <p class="big-name">${r.customer_name}</p>
      <p><a class="btn btn-accent btn-sm" href="tel:${r.customer_phone}">${icon('phone')} ${r.customer_phone}</a>
      ${r.customer_phone ? html` <a class="btn btn-ghost btn-sm" href="${wa.customer}" target="_blank" rel="noopener" title="Opens WhatsApp with a message about this request's status, ready to send">${icon('message-circle')} WhatsApp customer</a>` : ''}</p>
      <h3>Location</h3>
      <p>${r.location_description}</p>
      ${r.latitude !== null
        ? html`<div class="mapbox"><iframe title="Customer location" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${r.longitude - 0.004}%2C${r.latitude - 0.0025}%2C${r.longitude + 0.004}%2C${r.latitude + 0.0025}&amp;layer=mapnik&amp;marker=${r.latitude}%2C${r.longitude}"></iframe></div>
          <p><a class="btn btn-primary btn-sm" href="${mapsLink(r.latitude, r.longitude)}" target="_blank" rel="noopener">${icon('navigation')} Open in Google Maps</a>
          <span class="muted small"> ${r.location_accuracy ? `± ${Math.round(r.location_accuracy)} m` : ''}</span></p>`
        : html`<p class="muted small">The customer did not share GPS coordinates.</p>`}
      ${r.preferred_time ? html`<h3>Preferred pick-up</h3><p>${r.preferred_time}</p>` : ''}
      ${r.notes ? html`<h3>Customer notes</h3><p class="pre">${r.notes}</p>` : ''}
      <h3>Terms of Service</h3>
      <p>${r.terms_version ? html`Accepted version ${r.terms_version} on ${fmtDate(r.terms_accepted_at)}` : html`<span class="muted">Placed before terms acceptance was required.</span>`}</p>
    </div>

    <div class="glass pad">
      <h2>Items to wash</h2>
      <ul class="plain-list large">${items.map((i) => html`<li>${i.category_name} <strong>× ${i.quantity}</strong></li>`)}</ul>

      ${ctx.can('billing') ? html`<h2>Billing</h2>
      <form method="post" action="/admin/requests/${r.id}/billing" class="stack">
        ${csrfField(ctx)}
        <div class="grid-2">
          <label class="field"><span>Subtotal before discount (${cur})</span><input type="number" step="0.01" min="0" name="total_amount" value="${r.subtotal_amount || r.total_amount}" id="totalInput"></label>
          <label class="field"><span>Paid so far (${cur})</span><input type="number" step="0.01" min="0" name="amount_paid" value="${r.amount_paid}"></label>
        </div>
        <label class="field"><span>Discount code (optional)</span><input name="discount_code" value="${r.discount_code || ''}" maxlength="40" placeholder="Enter active promotion code"></label>
        <div class="row-between">
          ${estimate > 0 ? html`<button type="button" class="link-btn" data-fill="#totalInput" data-value="${estimate}">Use estimate: ${money(estimate, cur)}</button>` : html`<span class="muted small">Set prices on categories to get estimates.</span>`}
          <span class="muted small">Current discount: ${money(r.discount_amount || 0, cur)} · Balance: <strong>${money(balance, cur)}</strong></span>
        </div>
        <button class="btn btn-primary" type="submit">Save billing</button>
      </form>`  : ''}
    </div>
  </section>

  <section class="grid-2 gap">
    <div class="glass pad">
      <h2>Internal notes</h2>
      ${ctx.can('notes')
        ? html`<form method="post" action="/admin/requests/${r.id}/notes" class="stack">
        ${csrfField(ctx)}
        <textarea name="admin_notes" rows="4" maxlength="2000" placeholder="Only staff can see this…">${r.admin_notes}</textarea>
        <button class="btn btn-ghost" type="submit">Save notes</button>
      </form>`
        : html`<p class="pre">${r.admin_notes || '—'}</p>`}
    </div>
    <div class="glass pad">
      <h2>History</h2>
      <ul class="events">${events.map((e) => html`<li><span class="ev-dot"></span><div><strong>${STATUS_MAP[e.status] ? STATUS_MAP[e.status].label : e.status}</strong><span class="muted small"> · ${fmtDate(e.created_at)} · ${e.created_by}</span>${e.note ? html`<p class="muted small">${e.note}</p>` : ''}</div></li>`)}</ul>
    </div>
  </section>

  ${ctx.can('delete') ? html`  <section class="danger glass pad">
    <form method="post" action="/admin/requests/${r.id}/delete" data-confirm="Delete this request permanently? This cannot be undone.">
      ${csrfField(ctx)}
      <button class="btn btn-danger btn-sm" type="submit">${icon('trash-2')} Delete request</button>
    </form>
  </section>` : ''}`;

  return adminLayout(ctx, { title: `Request ${r.ref_code}`, active: 'requests', body });
}

module.exports = { requestsPage, requestDetailPage };
