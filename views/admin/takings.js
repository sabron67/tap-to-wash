const { html } = require('../../lib/html');
const { money } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { icon } = require('../../lib/icons');
const { bizHub } = require('../partials/biz-hub');

const niceDay = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const METHOD = { mpesa: 'M-Pesa', cash: 'Cash' };

function takingsPage(ctx, { from, to, presets, snap, data }) {
  const cur = ctx.settings.currency;
  const q = `from=${from}&to=${to}`;
  const t = data.totals;
  const body = html`
  ${bizHub(ctx, { active: 'takings', from, to, presets, snap })}
  <section class="glass pad">
    <h2>Daily takings</h2>
    <p class="muted">Money received each day, split by M-Pesa and cash, with what is still unpaid. <strong>Received</strong> counts the day the payment came in. <strong>Unpaid</strong> is the balance still owing on orders made that day (cancelled orders are left out).</p>
    <div class="kpis">
      <div class="kpi"><b>${money(t.received, cur)}</b><span>Total received</span></div>
      <div class="kpi"><b>${money(t.mpesa, cur)}</b><span>M-Pesa (${t.mpesa_n} payment${t.mpesa_n === 1 ? '' : 's'})</span></div>
      <div class="kpi"><b>${money(t.cash, cur)}</b><span>Cash (${t.cash_n} payment${t.cash_n === 1 ? '' : 's'})</span></div>
      <div class="kpi"><b>${money(t.unpaid, cur)}</b><span>Unpaid (${t.unpaid_n} order${t.unpaid_n === 1 ? '' : 's'})</span></div>
    </div>
    <a class="btn btn-primary btn-lg" href="/admin/takings/download?${q}">${icon('download')} Download Excel report</a>
  </section>

  <section class="glass pad ops-section">
    <h3>Day by day</h3>
    ${data.days.length
      ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th class="num">M-Pesa</th><th class="num">Cash</th><th class="num">Total received</th><th class="num">Unpaid</th></tr></thead>
        <tbody>${data.days.map((d) => html`<tr>
          <td>${niceDay(d.day)}</td>
          <td class="num">${money(d.mpesa, cur)}</td>
          <td class="num">${money(d.cash, cur)}</td>
          <td class="num"><strong>${money(d.received, cur)}</strong></td>
          <td class="num">${d.unpaid > 0 ? html`<strong>${money(d.unpaid, cur)}</strong> <span class="muted small">(${d.unpaid_n})</span>` : money(0, cur)}</td>
        </tr>`)}</tbody>
        <tfoot><tr><th>Total</th><th class="num">${money(t.mpesa, cur)}</th><th class="num">${money(t.cash, cur)}</th><th class="num">${money(t.received, cur)}</th><th class="num">${money(t.unpaid, cur)}</th></tr></tfoot>
      </table></div>`
      : html`<p class="muted">No payments or orders in this period.</p>`}
  </section>

  <section class="glass pad ops-section">
    <h3>Payments received</h3>
    ${data.payments.length
      ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Time</th><th>Order</th><th>Customer</th><th>Method</th><th>M-Pesa code</th><th>Recorded by</th><th class="num">Amount</th></tr></thead>
        <tbody>${data.payments.map((p) => html`<tr><td>${p.at}</td><td>${p.ref_code}</td><td>${p.customer}</td><td>${METHOD[p.method] || p.method}</td><td>${p.method === 'mpesa' ? p.reference : ''}</td><td>${p.recorded_by}</td><td class="num">${money(p.amount, cur)}</td></tr>`)}</tbody>
      </table></div>${data.paymentsTruncated ? html`<p class="muted small">Showing the latest 1,000 payments. Narrow the dates to see the rest.</p>` : ''}`
      : html`<p class="muted">No payments in this period.</p>`}
  </section>

  <section class="glass pad ops-section">
    <h3>Unpaid orders</h3>
    ${data.unpaidOrders.length
      ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Order date</th><th>Order</th><th>Customer</th><th>Phone</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead>
        <tbody>${data.unpaidOrders.map((o) => html`<tr><td>${o.day}</td><td>${o.ref_code}</td><td>${o.customer}</td><td>${o.phone}</td><td class="num">${money(o.total_amount, cur)}</td><td class="num">${money(o.amount_paid, cur)}</td><td class="num"><strong>${money(o.balance, cur)}</strong></td></tr>`)}</tbody>
      </table></div>${data.unpaidTruncated ? html`<p class="muted small">Showing the latest 500 unpaid orders. Narrow the dates to see the rest.</p>` : ''}`
      : html`<p class="muted">Nothing unpaid for orders made in this period.</p>`}
  </section>`;
  return adminLayout(ctx, { title: 'Daily takings', active: 'reports', body });
}

module.exports = { takingsPage };
