const { html } = require('../../lib/html');
const { money } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { icon } = require('../../lib/icons');
const { csrfField } = require('../partials/ui');
const { bizHub } = require('../partials/biz-hub');
const { FIGURES, SECTIONS } = require('../../lib/figures');

function reportsPage(ctx, { from, to, kpi, presets, figures = {}, snap }) {
  const cur = ctx.settings.currency;
  const q = (f, t) => `from=${f}&to=${t}`;
  const setCount = FIGURES.filter((f) => figures[f.key] && figures[f.key].saved).length;
  const shown = (f) => {
    const x = figures[f.key];
    if (!x || !x.saved) return '';
    return f.kind === 'pct' ? String(Math.round(x.value * 10000) / 100) : String(x.value);
  };
  const sample = (f) => (f.def === null ? 'Auto' : `Sample: ${f.kind === 'pct' ? Math.round(f.def * 10000) / 100 : f.def}`);
  const figureField = (f) => html`<label class="field"><span>${f.label.replace('{cur}', cur)}</span><input name="${f.key}" type="number" inputmode="decimal" min="${f.min ?? 0}" ${f.max !== undefined ? html`max="${f.max}"` : ''} step="${f.kind === 'int' ? '1' : '0.01'}" value="${shown(f)}" placeholder="${sample(f)}"></label>`;
  const body = html`
  ${bizHub(ctx, { active: 'reports', from, to, presets, snap })}
  <section class="glass pad">
    <h2>Requests and income</h2>
    <p class="muted">Figures for the period above. The Excel workbook adds your stock, supply costs and profit from Inventory, plus calculators for pricing and break-even. Everything is a live formula, so you can change the yellow cells and watch the results update.</p>

    <div class="kpis">
      <div class="kpi"><b>${kpi.requests}</b><span>Requests</span></div>
      <div class="kpi"><b>${kpi.delivered}</b><span>Delivered</span></div>
      <div class="kpi"><b>${money(kpi.billed, cur)}</b><span>Billed</span></div>
      <div class="kpi"><b>${money(kpi.collected, cur)}</b><span>Collected</span></div>
      <div class="kpi"><b>${money(kpi.outstanding, cur)}</b><span>Outstanding</span></div>
    </div>

    <div class="profit-link">
      <div><strong>Profit for this period: ${money(snap.net, cur)}</strong><span class="muted small"> after ${money(snap.suppliesCost, cur)} supplies and ${money(snap.expenses, cur)} expenses${snap.margin === null ? '' : ` · ${snap.margin.toFixed(1)}% margin`}</span></div>
      ${ctx.can('inventory') ? html`<a class="btn btn-ghost btn-sm" href="/admin/inventory?${q(from, to)}#profit">See the profit breakdown ${icon('arrow-right')}</a>` : ''}
    </div>
    <a class="btn btn-primary btn-lg" href="/admin/reports/download?${q(from, to)}">${icon('download')} Download Excel report</a>
  </section>


  <section class="glass pad ops-section" id="figures">
    <div class="card-head"><div><h2>Business figures</h2><p class="muted small">These are the numbers behind the Costing, Quote and Summary sheets of the Excel report. ${setCount} of ${FIGURES.length} are set; the rest still use a sample figure. Leave a box empty to keep the sample.</p></div></div>
    <form method="post" action="/admin/reports/figures">
      ${csrfField(ctx)}
      ${SECTIONS.map((sec) => html`<h3>${sec}</h3><div class="ops-form">${FIGURES.filter((f) => f.section === sec).map(figureField)}</div>`)}
      <button class="btn btn-primary" type="submit">Save business figures</button>
    </form>
  </section>

  <section class="glass pad">
    <h2>What is inside the workbook</h2>
    <ul class="sheet-list">
      <li><strong>Summary</strong> - requests, income, collection rate, turnaround, customers and business-model highlights.</li>
      <li><strong>Inputs</strong> - your business figures (saved above): prices, VAT, capacity, water, power, detergent, wages, rent, machines. Anything you have not set is marked as a sample figure.</li>
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
