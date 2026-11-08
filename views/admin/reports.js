const { html } = require('../../lib/html');
const { money } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { icon } = require('../../lib/icons');

function reportsPage(ctx, { from, to, kpi, presets }) {
  const cur = ctx.settings.currency;
  const q = (f, t) => `from=${f}&to=${t}`;
  const body = html`
  <section class="glass pad">
    <h2>Excel report</h2>
    <p class="muted">Download a workbook with your requests, income and customers, plus calculators for pricing and break-even. Everything is a live formula, so you can change the yellow cells and watch the results update.</p>

    <div class="presets">
      ${presets.map(([label, f, t]) => html`<a class="tab ${f === from && t === to ? 'active' : ''}" href="/admin/reports?${q(f, t)}">${label}</a>`)}
    </div>

    <form class="row-form" method="get" action="/admin/reports">
      <label class="field" style="margin:0"><span>From</span><input type="date" name="from" value="${from}" required></label>
      <label class="field" style="margin:0"><span>To</span><input type="date" name="to" value="${to}" required></label>
      <button class="btn btn-ghost" type="submit" style="align-self:flex-end">Update preview</button>
    </form>

    <div class="kpis">
      <div class="kpi"><b>${kpi.requests}</b><span>Requests</span></div>
      <div class="kpi"><b>${kpi.delivered}</b><span>Delivered</span></div>
      <div class="kpi"><b>${money(kpi.billed, cur)}</b><span>Billed</span></div>
      <div class="kpi"><b>${money(kpi.collected, cur)}</b><span>Collected</span></div>
      <div class="kpi"><b>${money(kpi.outstanding, cur)}</b><span>Outstanding</span></div>
    </div>

    <a class="btn btn-primary btn-lg" href="/admin/reports/download?${q(from, to)}">${icon('download')} Download Excel report</a>
  </section>

  <section class="glass pad">
    <h2>What is inside the workbook</h2>
    <ul class="sheet-list">
      <li><strong>Summary</strong> - requests, income, collection rate, turnaround, customers and business-model highlights.</li>
      <li><strong>Inputs</strong> - your assumptions: prices, VAT, capacity, water, power, detergent, wages, rent, machines.</li>
      <li><strong>Costing</strong> - cost per load and per kg, fixed costs, profit, break-even kilograms, suggested price for your target margin.</li>
      <li><strong>Quote</strong> - pick services from a list, enter quantities, get subtotal, discount, delivery, VAT and total.</li>
      <li><strong>Rates</strong> - your services and prices (edit to update every sheet).</li>
      <li><strong>Requests, Items, By Category, By Month, Customers</strong> - the detail behind the numbers.</li>
    </ul>
    <p class="muted small">Prepared for A4 printing (black-and-white friendly, headings repeat on every page). Numbers calculate when the file is opened in Excel, LibreOffice or Google Sheets.</p>
  </section>`;
  return adminLayout(ctx, { title: 'Reports', active: 'reports', body });
}

module.exports = { reportsPage };
