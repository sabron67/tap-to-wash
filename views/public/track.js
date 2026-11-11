const { html } = require('../../lib/html');
const { fmtDate, STATUS_MAP, money } = require('../../lib/helpers');
const { publicLayout } = require('../layouts/public');
const { timeline } = require('../partials/ui');
const { pubNav } = require('../partials/pubnav');
const { icon } = require('../../lib/icons');
const { payInstructions } = require('../../lib/mpesa');
const { mpesaBadge, paidTick } = require('../../lib/pay-ui');

// The M-Pesa prompt: the customer types their number, a prompt appears on their phone, they enter their PIN.
function stkBox(ctx, result, balance) {
  const pay = result.pay;
  if (!pay || !pay.enabled) return '';
  const cur = ctx.settings.currency;
  const a = pay.attempt;
  const hiddenFields = html`${pay.csrf ? html`<input type="hidden" name="_csrf" value="${pay.csrf}">` : ''}<input type="hidden" name="ref" value="${result.ref_code}">${result.phone ? html`<input type="hidden" name="phone" value="${result.phone}">` : ''}`;
  if (a && a.status === 'pending') {
    return html`<div class="pay-box stk-box" id="stkWait" data-status-url="${pay.statusUrl(a.id)}">
      <h4>${mpesaBadge()} <span>Check your phone</span></h4>
      <p class="stk-msg" data-msg role="status">We sent an M-Pesa prompt to ${a.phone}. Enter your M-Pesa PIN to pay ${money(balance, cur)}.</p>
      <p class="muted small">This page updates by itself once you have paid. No prompt? Wait a moment, or use the steps below.</p>
    </div>`;
  }
  return html`<div class="pay-box stk-box">
    <h4>${mpesaBadge()} <span>Pay with an M-Pesa prompt</span></h4>
    ${a && a.status !== 'success' ? html`<p class="err show" role="alert">${a.message}</p>` : ''}
    <p class="muted small">We send a prompt to your phone. Enter your M-Pesa PIN and ${money(balance, cur)} is paid. Nothing is taken until you enter the PIN.</p>
    <form method="post" action="${pay.payAction}" class="stack">
      ${hiddenFields}
      <label class="field"><span>M-Pesa phone number</span><input name="msisdn" type="tel" inputmode="tel" value="${pay.phone || ''}" placeholder="0712 345 678" maxlength="20" autocomplete="tel" required></label>
      <button class="btn btn-primary" type="submit">${icon('smartphone')} Pay ${money(balance, cur)} with M-Pesa</button>
    </form>
  </div>`;
}

// How to pay by M-Pesa: the Till number or the Paybill (with the order reference as the account) the owner chose in Settings.
function mpesaBox(ctx, result, balance, { manualOnly = true } = {}) {
  const how = payInstructions(ctx.settings, { ref: result.ref_code });
  if (!how) return '';
  return html`<div class="pay-box">
    <h4>${mpesaBadge()} <span>Pay by M-Pesa</span></h4>
    <dl class="pay-grid">
      <div><dt>${how.label}</dt><dd>${how.number}</dd></div>
      ${how.type === 'paybill' ? html`<div><dt>Account number</dt><dd>${how.account}</dd></div>` : ''}
      <div><dt>Amount</dt><dd>${money(balance, ctx.settings.currency)}</dd></div>
    </dl>
    ${how.name ? html`<p class="muted small">The name shown on M-Pesa will be <strong>${how.name}</strong>.</p>` : ''}
    <ol class="pay-steps">${how.steps.map((st) => html`<li>${st}</li>`)}</ol>
    <p class="muted small">After paying, show the M-Pesa confirmation message to the rider or cashier so your payment is recorded.</p>
  </div>`;
}

// The bill the customer reviews after their laundry is weighed or counted.
function billCard(ctx, result) {
  const b = result.bill;
  const cur = ctx.settings.currency;
  const qty = (n) => Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const balance = Math.max(0, Number(b.total) - Number(b.paid));
  const pay = result.pay || {};
  const billAction = pay.billAction || '/track/bill';
  const hidden = html`${pay.csrf ? html`<input type="hidden" name="_csrf" value="${pay.csrf}">` : ''}<input type="hidden" name="ref" value="${result.ref_code}"><input type="hidden" name="phone" value="${result.phone || ''}"><input type="hidden" name="version" value="${b.version}">`;
  return html`<section class="glass pad bill-card" id="bill">
    <h3>Your bill</h3>
    <p class="muted small">${b.status === 'awaiting_confirm' ? 'We weighed your clothes. Please check the weight and bill, then confirm it.' : b.status === 'confirmed' ? (b.weighed ? 'You confirmed this bill.' : 'Your order is confirmed. This is your bill.') : 'You queried this bill. We will check it and send you a new one.'}</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Service</th><th>${b.weighed ? 'Weight / items' : 'Items'}</th><th>Rate</th><th>Amount</th></tr></thead><tbody>
      ${b.lines.map((l) => html`<tr><td data-label="Service">${l.category_name}</td><td data-label="Measured">${qty(l.measured_qty)} ${l.unit || 'item'}</td><td data-label="Rate">${money(l.rate, cur)}</td><td data-label="Amount">${money(l.line_total, cur)}</td></tr>`)}
    </tbody></table></div>
    <div class="bill-totals">
      <div><span>Subtotal</span><strong>${money(b.subtotal, cur)}</strong></div>
      ${Number(b.discount) > 0 ? html`<div><span>Discount (${b.discount_code})</span><strong>− ${money(b.discount, cur)}</strong></div>` : ''}
      <div class="hl"><span>Total</span><strong>${money(b.total, cur)}</strong></div>
      ${b.status === 'confirmed' ? html`<div><span>Paid</span><strong>${money(b.paid, cur)}</strong></div><div class="${balance > 0 ? 'due' : ''}"><span>Balance</span><strong>${money(balance, cur)}</strong></div>` : ''}
    </div>
    ${b.status === 'awaiting_confirm'
      ? html`<div class="bill-actions">
        <form method="post" action="${billAction}">${hidden}<input type="hidden" name="action" value="confirm"><button class="btn btn-primary" type="submit">${icon('circle-check')} Confirm this bill</button></form>
        <details><summary class="btn btn-ghost">Something looks wrong</summary>
          <form method="post" action="${billAction}" class="stack">${hidden}<input type="hidden" name="action" value="dispute">
            <label class="field"><span>What should we check?</span><textarea name="comment" rows="2" maxlength="300" placeholder="e.g. I also gave two bedsheets"></textarea></label>
            <button class="btn btn-ghost" type="submit">Send to the team</button></form>
        </details>
      </div>`
      : ''}
    ${b.status === 'confirmed' && balance > 0
      ? html`<p class="${result.status === 'delivered' ? 'due' : 'muted small'}">${result.status === 'delivered'
          ? `Your laundry has been delivered. Please settle the balance of ${money(balance, cur)} now, in cash or by M-Pesa.`
          : b.pay_later || ctx.settings.pay_before_cleaning === '0'
            ? 'You can pay on delivery.'
            : 'Pay the rider in cash or by M-Pesa. Your rider will take your laundry once payment is received.'}</p>`
      : ''}
    ${b.status === 'confirmed' && balance > 0 && pay.enabled ? stkBox(ctx, result, balance) : ''}
    ${b.status === 'confirmed' && balance > 0 ? (pay.enabled ? html`<details class="pay-manual"><summary>Or pay with the Till / Paybill steps</summary>${mpesaBox(ctx, result, balance)}</details>` : mpesaBox(ctx, result, balance)) : ''}
    ${b.status === 'confirmed' && balance <= 0 && Number(b.total) > 0 ? html`<p class="paid-line">${paidTick()}<span><strong>Paid in full</strong>Thank you.</span></p>` : ''}
  </section>`;
}

function trackPage(ctx, { ref = '', error = '', result = null, info = '' }) {
  const s = ctx.settings;
  const body = html`
  ${pubNav(ctx, 'track')}

  <main class="container narrow section" style="padding-top:calc(var(--nav-h) + 2.5rem)">
    <div class="section-head">
      <span class="pill">Track</span>
      <h2>Where is my laundry?</h2>
      <p class="muted">Enter your reference code and the phone number you used.</p>
    </div>

    <form class="glass pad" method="get" action="/track">
      <div class="grid-2">
        <label class="field"><span>Reference code</span><input name="ref" value="${ref}" placeholder="TTW-XXXXXX" maxlength="20" required autocapitalize="characters"></label>
        <label class="field"><span>Phone number</span><input name="phone" type="tel" placeholder="0712 345 678" maxlength="20" value="${ctx.accountPhone || ''}" autocomplete="tel" required></label>
      </div>
      <button class="btn btn-primary" type="submit">Check status</button>
      ${error ? html`<p class="err show">${error}</p>` : ''}
      ${info ? html`<p class="success show">${info}</p>` : ''}
    </form>

    ${result
      ? html`<section class="glass pad result">
          <div class="result-head">
            <div><span class="muted small">Reference</span><div class="ref-box sm">${result.ref_code}</div></div>
            <div class="result-status" style="--bc:${STATUS_MAP[result.status].color}">${STATUS_MAP[result.status].icon} ${STATUS_MAP[result.status].label}</div>
          </div>
          ${timeline(result.status)}
          ${result.receipt_href ? html`<p><a class="btn btn-primary" href="${result.receipt_href}">${icon('receipt')} View receipt</a></p>` : ''}
          ${result.bill ? billCard(ctx, result) : result.status === 'cancelled' ? '' : html`<p class="muted small" id="bill">Your bill will appear here as soon as it is ready. You will be able to confirm and pay it on this page.</p>`}
          <h3>Items</h3>
          <ul class="plain-list">${result.items.map((i) => html`<li>${i.category_name} <strong>× ${i.quantity}</strong></li>`)}</ul>
          ${result.pickup_scheduled_at || result.delivery_scheduled_at || result.dispatch_stage ? html`<h3>Collection and delivery</h3><p class="muted small">${result.dispatch_stage ? `Dispatch: ${result.dispatch_stage} · ` : ''}${result.pickup_scheduled_at ? `Pickup scheduled: ${fmtDate(result.pickup_scheduled_at)}` : ''}${result.delivery_scheduled_at ? ` · Delivery scheduled: ${fmtDate(result.delivery_scheduled_at)}` : ''}</p>` : ''}
          <h3>Updates</h3>
          <ul class="events">${result.events.map((e) => html`<li><span class="ev-dot"></span><div><strong>${STATUS_MAP[e.status] ? STATUS_MAP[e.status].label : e.status}</strong><span class="muted small"> · ${fmtDate(e.created_at)}</span>${e.note ? html`<p class="muted small">${e.note}</p>` : ''}</div></li>`)}</ul>
          <form class="glass pad feedback-form" method="post" action="/track/feedback"><h3>Feedback and support</h3><input type="hidden" name="ref" value="${result.ref_code}"><label class="field"><span>Phone number used for this order</span><input name="phone" type="tel" value="${ctx.accountPhone || ''}" autocomplete="tel" required></label><label class="field"><span>Feedback type</span><select name="kind">${result.status === 'delivered' ? html`<option value="review">Rate my laundry service</option>` : ''}<option value="complaint">Report a problem</option></select></label><label class="field"><span>Rating (1–5)</span><select name="rating"><option value="5">5 - Excellent</option><option value="4">4 - Good</option><option value="3">3 - Average</option><option value="2">2 - Poor</option><option value="1">1 - Very poor</option></select></label><label class="field"><span>Comment / issue details</span><textarea name="comment" rows="3" maxlength="1500"></textarea></label><button class="btn btn-primary" type="submit">Send feedback</button></form>
        </section>
        <div id="liveCfg" data-kind="order" data-ref="${result.ref_code}" data-phone="${result.phone || ''}" hidden></div>
        <script src="/js/live.js"></script>
        <script src="/js/pay.js" defer></script>`
      : ''}
  </main>`;

  return publicLayout(ctx, { title: 'Track order', body, bodyClass: 'public' });
}

function messagePage(ctx, { title, message, code = '' }) {
  const body = html`
  <header class="nav scrolled"><a class="brand" href="/"><span>${ctx.settings.business_name}</span></a></header>
  <main class="container narrow section center" style="padding-top:calc(var(--nav-h) + 2.5rem)">
    <div class="glass pad">
      <div class="big">${icon(code === '404' ? 'shopping-basket' : 'droplets')}</div>
      <h2>${title}</h2>
      <p class="muted">${message}</p>
      <a class="btn btn-primary" href="/">Back to home</a>
    </div>
  </main>`;
  return publicLayout(ctx, { title, body, bodyClass: 'public' });
}

module.exports = { trackPage, messagePage };
