// "Bill and payment" panel on the admin request page. Prices only appear for people allowed to see them:
// a rider sees the weighing form, and the amount due only after the customer has confirmed the bill.
const { html } = require('../../lib/html');
const { money, fmtDate } = require('../../lib/helpers');
const { csrfField } = require('../partials/ui');
const { icon } = require('../../lib/icons');
const { measureLabel, isWeight, orderNeedsWeighing } = require('../../lib/bill');

const STATE = {
  none: ['Not billed yet', 'pay-unpriced'],
  needs_price: ['Price needed', 'pay-partial'],
  awaiting_confirm: ['Waiting for customer', 'pay-partial'],
  confirmed: ['Bill confirmed', 'pay-paid'],
  disputed: ['Customer queried it', 'pay-unpaid'],
  legacy: ['Older order', 'pay-unpriced'],
};

const qty = (n) => Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const unitText = (u) => (u ? String(u).trim() : 'item');

function billPanel(ctx, { r, items, payments, wa }) {
  const can = ctx.can;
  if (!(can('weigh') || can('collect') || can('billing'))) return '';
  if (r.status === 'cancelled') return '';
  const cur = ctx.settings.currency;
  const bs = r.bill_status || 'none';
  const [stateLabel, stateCls] = STATE[bs] || STATE.none;
  const seesPrices = can('billing');
  const total = Number(r.total_amount) || 0;
  const paid = Number(r.amount_paid) || 0;
  const balance = Math.max(0, total - paid);
  const over = Math.max(0, paid - total);
  const showDue = seesPrices || (can('collect') && bs === 'confirmed');
  const weighed = items.length > 0 && items.every((i) => i.measured_qty !== null && i.measured_qty !== undefined);
  // Only clothes charged per kg are weighed and confirmed by the customer. Other orders are billed once the order is confirmed.
  const hasKg = orderNeedsWeighing(items);

  const privileged = can('billadmin');
  const stageOk = privileged ? ['confirmed', 'picked_up', 'washing', 'ready'].includes(r.status) : r.status === 'confirmed';
  const canWeigh = hasKg && can('weigh') && stageOk && ['none', 'needs_price', 'awaiting_confirm', 'disputed'].includes(bs);
  const canPay = can('collect') && balance > 0 && (bs === 'confirmed' || (seesPrices && bs === 'legacy'));

  const stepDone = (ok) => (ok ? 'done' : '');
  const paidOrLater = bs === 'confirmed' && (balance <= 0 || r.pay_later);
  const steps =
    bs === 'legacy'
      ? ''
      : !hasKg
      ? html`<ol class="bill-steps">
      <li class="${stepDone(bs === 'confirmed' || bs === 'needs_price')}"><span>1</span> Order confirmed and billed</li>
      <li class="${stepDone(paidOrLater)}"><span>2</span> ${r.pay_later && balance > 0 ? 'Pay later approved' : 'Payment received'}</li>
    </ol>`
      : html`<ol class="bill-steps">
      <li class="${stepDone(weighed && bs !== 'none')}"><span>1</span> Weighed (per-kg clothes)</li>
      <li class="${stepDone(bs === 'confirmed')}"><span>2</span> Customer confirms the bill</li>
      <li class="${stepDone(paidOrLater)}"><span>3</span> ${r.pay_later && balance > 0 ? 'Pay later approved' : 'Payment received'}</li>
    </ol>`;

  const readiness =
    bs === 'legacy'
      ? ''
      : paidOrLater
      ? html`<p class="bill-ok">${icon('circle-check')} Ready for pick-up.</p>`
      : html`<p class="bill-wait">${icon('clock')} ${
          bs === 'none' ? (hasKg ? 'Weigh the per-kg clothes, then send the customer their bill to confirm.' : 'Confirm the order and the bill is created automatically, ready for payment.')
          : bs === 'needs_price' ? 'A service has no price yet, so a manager or cashier needs to price it.'
          : bs === 'awaiting_confirm' ? 'Waiting for the customer to confirm the bill.'
          : bs === 'disputed' ? 'The customer queried the bill. Weigh again to send a new one.'
          : 'Collect the payment, or ask a manager to allow pay later.'
        }</p>`;

  // ----- weigh / count form -----
  const weighForm = canWeigh
    ? html`<form method="post" action="/admin/requests/${r.id}/weigh" class="stack bill-form">
      ${csrfField(ctx)}
      <h3>${weighed ? 'Weigh again' : 'Weigh the clothes'}</h3>
      <p class="muted small">Enter the weight in kilograms for each per-kg service. Other services are billed from the number of items ordered.</p>
      <div class="bill-lines">
        ${items.map((i) => {
          const u = i.cat_unit || i.unit;
          if (!isWeight(u)) return html`<div class="bill-line"><span><strong>${i.category_name}</strong><small class="muted">Not weighed. Billed as ordered</small></span><span class="bill-input"><strong>${qty(i.quantity)}</strong><em>${unitText(u)}</em></span></div>`;
          return html`<label class="bill-line">
            <span><strong>${i.category_name}</strong><small class="muted">Customer said ${qty(i.quantity)} ${unitText(u)}</small></span>
            <span class="bill-input"><input name="qty_${i.id}" type="text" inputmode="decimal" autocomplete="off" required placeholder="${isWeight(u) ? 'e.g. 4.5' : 'e.g. 3'}" value="${i.measured_qty !== null && i.measured_qty !== undefined ? qty(i.measured_qty) : ''}" aria-label="${measureLabel(u)} for ${i.category_name}"><em>${unitText(u)}</em></span>
          </label>`;
        })}
      </div>
      <button class="btn btn-primary" type="submit">${icon('check')} Save and create the bill</button>
    </form>`
    : '';

  // ----- the bill itself -----
  const billTable =
    weighed && bs !== 'none'
      ? seesPrices
        ? html`<div class="table-wrap"><table class="table bill-table"><thead><tr><th>Service</th><th>Measured</th><th>Rate</th><th>Amount</th></tr></thead><tbody>
          ${items.map((i) => html`<tr><td data-label="Service">${i.category_name}</td><td data-label="Measured">${qty(i.measured_qty)} ${unitText(i.unit || i.cat_unit)}</td><td data-label="Rate">${i.rate === null || i.rate === undefined ? html`<span class="badge pay-partial">No price</span>` : money(i.rate, cur)}</td><td data-label="Amount">${i.line_total === null || i.line_total === undefined ? '-' : money(i.line_total, cur)}</td></tr>`)}
          </tbody></table></div>
          <div class="bill-totals">
            <div><span>Subtotal</span><strong>${money(r.subtotal_amount, cur)}</strong></div>
            ${Number(r.discount_amount) > 0 ? html`<div><span>Discount (${r.discount_code})</span><strong>− ${money(r.discount_amount, cur)}</strong></div>` : ''}
            <div class="hl"><span>Total</span><strong>${money(total, cur)}</strong></div>
            <div><span>Paid</span><strong>${money(paid, cur)}</strong></div>
            <div class="${balance > 0 ? 'due' : ''}"><span>Balance</span><strong>${money(balance, cur)}</strong></div>
          </div>`
        : html`<ul class="plain-list">${items.map((i) => html`<li><span>${i.category_name}</span><strong>${qty(i.measured_qty)} ${unitText(i.unit || i.cat_unit)}</strong></li>`)}</ul>`
      : '';

  const dueBox =
    showDue && !seesPrices && bs === 'confirmed'
      ? html`<div class="bill-totals">
        <div class="hl"><span>Amount due</span><strong>${money(total, cur)}</strong></div>
        <div><span>Paid</span><strong>${money(paid, cur)}</strong></div>
        <div class="${balance > 0 ? 'due' : ''}"><span>Balance</span><strong>${money(balance, cur)}</strong></div>
      </div>`
      : '';

  const overNote = over > 0 && showDue ? html`<p class="notice">The customer has paid ${money(over, cur)} more than the new total. Refund the difference under Operations, then Refunds.</p>` : '';

  // ----- customer link (so the customer can confirm) -----
  const sendLink =
    bs === 'awaiting_confirm' || bs === 'disputed'
      ? bs === 'awaiting_confirm'
        ? html`<p><a class="btn btn-accent btn-sm" href="${wa.customer}" target="_blank" rel="noopener">${icon('message-circle')} Send the bill to the customer on WhatsApp</a>
            <span class="muted small"> They open the link, review the bill and tap Confirm.</span></p>`
        : ''
      : '';

  // ----- staff actions on the bill -----
  const autoConfirmed = bs === 'confirmed' && r.bill_confirmed_by === 'Order confirmation' && paid === 0;
  const recalcForm =
    seesPrices && (['needs_price', 'awaiting_confirm', 'disputed'].includes(bs) || autoConfirmed) && weighed
      ? html`<form method="post" action="/admin/requests/${r.id}/bill/recalc" class="row-form bill-inline">
        ${csrfField(ctx)}
        <input name="discount_code" maxlength="40" placeholder="Discount code (optional)" value="${r.discount_code || ''}" aria-label="Discount code">
        <button class="btn btn-ghost btn-sm" type="submit">${bs === 'needs_price' ? 'Recalculate after pricing' : 'Apply code and recalculate'}</button>
      </form>`
      : '';

  const confirmForm =
    seesPrices && bs === 'awaiting_confirm'
      ? html`<form method="post" action="/admin/requests/${r.id}/bill/confirm" class="row-form bill-inline">
        ${csrfField(ctx)}<input type="hidden" name="version" value="${r.bill_version}">
        <input name="how" maxlength="100" required placeholder="How did the customer agree? e.g. by phone" aria-label="How the customer agreed">
        <button class="btn btn-ghost btn-sm" type="submit">Confirm for the customer</button>
      </form>`
      : '';

  const confirmedLine =
    bs === 'confirmed'
      ? html`<p class="muted small">${icon('circle-check')} ${hasKg ? 'Confirmed' : 'Order confirmed and billed'} ${fmtDate(r.bill_confirmed_at)}${seesPrices && r.bill_confirmed_by && hasKg ? ` · ${r.bill_confirmed_by}` : ''}.${hasKg ? ` Weighed by ${r.weighed_by || '-'}${r.weighed_at ? ` · ${fmtDate(r.weighed_at)}` : ''}.` : ''}</p>`
      : '';

  // ----- payment -----
  const payForm = canPay
    ? html`<form method="post" action="/admin/requests/${r.id}/payments" class="stack bill-form" data-pay-form>
      ${csrfField(ctx)}
      <h3>Record a payment</h3>
      <div class="grid-2">
        <label class="field"><span>Paid by</span><select name="method"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option></select></label>
        <label class="field"><span>Amount received (${cur})</span><input name="amount" type="text" inputmode="decimal" required value="${Number(balance)}" autocomplete="off"></label>
      </div>
      <label class="field"><span>M-Pesa confirmation code <small class="muted">(only for M-Pesa, from the customer's SMS)</small></span><input name="reference" maxlength="12" autocapitalize="characters" autocomplete="off" placeholder="e.g. QGH7ABC123"></label>
      <button class="btn btn-primary" type="submit">${icon('wallet')} Record payment</button>
    </form>`
    : '';

  const payRows = payments.length
    ? html`<h3>Payments</h3><div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Method</th><th>Amount</th><th>Recorded by</th><th>Checked</th></tr></thead><tbody>
        ${payments.map((p) => html`<tr><td data-label="When">${fmtDate(p.created_at)}</td><td data-label="Method">${p.method === 'mpesa' ? html`M-Pesa <span class="muted small">${p.reference}</span>` : 'Cash'}</td><td data-label="Amount">${money(p.amount, cur)}</td><td data-label="By">${p.recorded_by}</td>
          <td data-label="Checked">${p.reconciled ? html`<span class="badge pay-paid">Received</span>` : seesPrices
            ? html`<form method="post" action="/admin/payments/${p.id}/reconcile" class="inline">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">Mark received</button></form>`
            : html`<span class="badge pay-partial">Awaiting check</span>`}</td></tr>`)}
      </tbody></table></div>`
    : '';

  const payLater =
    privileged && bs === 'confirmed' && (balance > 0 || r.pay_later)
      ? html`<form method="post" action="/admin/requests/${r.id}/pay-later" class="inline bill-inline">
        ${csrfField(ctx)}<input type="hidden" name="on" value="${r.pay_later ? '0' : '1'}">
        <button class="btn btn-ghost btn-sm" type="submit">${r.pay_later ? `Cancel pay later (approved by ${r.pay_later_by})` : 'Allow pick-up before payment (pay later)'}</button>
      </form>`
      : '';

  const reopen =
    privileged && hasKg && ['awaiting_confirm', 'confirmed'].includes(bs)
      ? html`<details class="bill-reopen"><summary>Re-open the bill to weigh again</summary>
        <form method="post" action="/admin/requests/${r.id}/bill/reopen" class="row-form bill-inline">
          ${csrfField(ctx)}
          <input name="reason" maxlength="150" required placeholder="Reason, e.g. customer added two duvets" aria-label="Reason">
          <button class="btn btn-ghost btn-sm" type="submit">Re-open bill</button>
        </form>
        <p class="muted small">The customer will have to confirm the new bill. Payments already recorded stay on the order.</p></details>`
      : '';

  const legacyNote =
    bs === 'legacy'
      ? html`<p class="muted small">This order was already under way before weigh-and-confirm billing was switched on, so it is billed by hand below.</p>`
      : '';

  return html`<section class="glass pad bill-panel" id="bill">
    <div class="card-head"><h2>Bill and payment</h2><span class="badge ${stateCls}">${stateLabel}</span></div>
    ${steps}${readiness}
    ${legacyNote}
    ${weighForm}
    ${billTable}${dueBox}${overNote}${confirmedLine}
    ${sendLink}
    ${recalcForm}${confirmForm}
    ${payForm}${payRows}
    ${payLater}${reopen}
  </section>`;
}

module.exports = { billPanel };
