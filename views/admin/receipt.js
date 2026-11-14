const { html, raw } = require('../../lib/html');
const { money, fmtDate, STATUS_MAP, FLOW } = require('../../lib/helpers');
const { icon, has } = require('../../lib/icons');

// Customer receipt, laid out like a mobile app screen:
// banner -> rounded sheet -> title + status -> progress chips -> order items -> total card -> action buttons.
// Colours are the site's existing warm-white / clay palette (light values from public/css/style.css).
function receiptPage(ctx, { request, items, backHref, backLabel }) {
  const s = ctx.settings;
  const cur = s.currency;
  const total = Number(request.total_amount) || 0;
  const paid = Number(request.amount_paid) || 0;
  const balance = Math.max(0, total - paid);
  const st = STATUS_MAP[request.status] || { label: request.status };
  const idx = FLOW.indexOf(request.status);
  const qtyCount = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
  const payLabel = total <= 0 ? 'Not priced' : paid >= total ? 'Paid' : paid > 0 ? 'Part paid' : 'Unpaid';
  const back = backHref || `/admin/requests/${request.id}`;

  const priced = (i) => i.price != null && Number(i.price) > 0;
  const weighed = (i) => i.measured_qty != null && i.line_total != null;
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="robots" content="noindex,nofollow"><title>Receipt ${request.ref_code}</title><link rel="stylesheet" href="/css/receipt.css"></head><body class="rc-solo"><div class="rc">
  <header class="rc-banner">
    <div class="rc-brand"><span class="rc-mark">${icon('washing-machine')}</span><div><b>${s.business_name}</b>${s.address ? html`<small>${s.address}</small>` : ''}${s.phone || s.email ? html`<small>${[s.phone, s.email].filter(Boolean).join(' · ')}</small>` : ''}</div></div>
    <span class="rc-ref">${request.ref_code}</span>
  </header>

  <main class="rc-sheet">
    <div class="rc-grab" aria-hidden="true"></div>
    <div class="rc-title"><h1>Laundry receipt</h1><span class="rc-badge">${payLabel}</span></div>
    <p class="rc-sub"><span>${icon('clock')} ${fmtDate(request.created_at)}</span><span>${icon('shopping-basket')} ${qtyCount} ${qtyCount === 1 ? 'item' : 'items'}</span></p>

    ${request.status === 'cancelled'
      ? html`<div class="rc-chips"><span class="rc-chip now">${icon('circle-x')} Cancelled</span></div>`
      : html`<div class="rc-chips" aria-label="Order progress">${FLOW.map((k, i) => html`<span class="rc-chip ${i < idx ? 'done' : i === idx ? 'now' : ''}">${i < idx ? icon('check') : i === idx ? icon(STATUS_MAP[k].icon) : ''} ${STATUS_MAP[k].label}</span>`)}</div>`}

    <h2 class="rc-h">Order items <small>${items.length} ${items.length === 1 ? 'service' : 'services'}</small></h2>
    <ul class="rc-rows">${items.map((i) => html`<li class="rc-row"><span class="rc-thumb">${icon(i.icon && has(i.icon) ? i.icon : 'shopping-basket')}</span>${weighed(i) ? html`<div class="rc-nm"><b>${i.category_name}</b><small>${money(i.rate, cur)} per ${i.line_unit || i.unit || 'item'}</small></div><span class="rc-qty">${Number(i.measured_qty).toLocaleString('en-KE', { maximumFractionDigits: 2 })} ${i.line_unit || i.unit || 'item'}</span><span class="rc-lt">${money(i.line_total, cur)}</span>` : html`<div class="rc-nm"><b>${i.category_name}</b>${priced(i) ? html`<small>${money(i.price, cur)} per ${i.unit || 'item'}</small>` : ''}</div><span class="rc-qty">× ${i.quantity}</span>${priced(i) ? html`<span class="rc-lt">${money(Number(i.price) * Number(i.quantity), cur)}</span>` : ''}`}</li>`)}</ul>

    <h2 class="rc-h">Customer and delivery</h2>
    <div class="rc-info">
      <div>${icon('user-round')}<span><small>Customer</small><b>${request.customer_name}</b></span></div>
      <div>${icon('phone')}<span><small>Phone</small><b>${request.customer_phone}</b></span></div>
      <div>${icon('map-pin')}<span><small>Pick-up and delivery</small><b>${request.location_description}</b></span></div>
    </div>

    <section class="rc-total" aria-label="Payment summary">
      <div class="rc-line"><span>Subtotal</span><strong>${money(request.subtotal_amount || request.total_amount, cur)}</strong></div>
      ${Number(request.discount_amount) > 0 ? html`<div class="rc-line"><span>Discount</span><strong>− ${money(request.discount_amount, cur)}</strong></div>` : ''}
      <div class="rc-line"><span>Total</span><strong>${money(total, cur)}</strong></div>
      <div class="rc-line"><span>Paid</span><strong>${money(paid, cur)}</strong></div>
      <div class="rc-big"><span>Balance due</span><strong>${money(balance, cur)}</strong></div>
      <div class="rc-tags"><span class="rc-tag solid">${st.label}</span><span class="rc-tag">${payLabel}</span></div>
    </section>

    <p class="rc-thanks"><b>Thank you for choosing ${s.business_name}.</b>This receipt is a record of the laundry order and amounts entered in the system.</p>
  </main>

  <nav class="rc-actions"><a class="rc-btn ghost" href="${back}">${icon('arrow-left')} ${backLabel || 'Back'}</a><button class="rc-btn primary" type="button" data-print>${icon('download')} Save as PDF / Print</button></nav>
  </div><script src="/js/receipt.js"></script></body></html>`;
}
module.exports = { receiptPage };
