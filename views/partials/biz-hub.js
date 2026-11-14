// Shared header for Reports and Inventory: one tab bar, one period, and one snapshot strip whose tiles link across both pages,
// so the numbers in Reports (billed, collected, outstanding) and Inventory (supplies, stock, profit) read as one business view.
const { html } = require('../../lib/html');
const { money } = require('../../lib/helpers');
const { icon } = require('../../lib/icons');

function bizHub(ctx, { active, from, to, presets, snap }) {
  const cur = ctx.settings.currency;
  const range = `from=${from}&to=${to}`;
  const tabs = [
    ['reports', '/admin/reports', 'file-spreadsheet', 'Reports', 'reports'],
    ['inventory', '/admin/inventory', 'package', 'Inventory & profit', 'inventory'],
  ].filter((t) => ctx.can(t[4]));
  const base = active === 'reports' ? '/admin/reports' : '/admin/inventory';
  const tile = (href, ic, label, value, tone, hint = '') =>
    html`<a class="hub-tile tone-${tone}" href="${href}"><span class="hub-ico">${icon(ic)}</span><span class="hub-val">${value}</span><span class="hub-lab">${label}</span>${hint ? html`<span class="hub-hint">${hint}</span>` : ''}</a>`;
  const showInv = ctx.can('inventory');
  const showRep = ctx.can('reports');
  const marginTxt = snap.margin === null ? 'No revenue yet' : `${snap.margin.toFixed(1)}% margin`;
  return html`<section class="hub glass">
    <div class="hub-top">
      <nav class="hub-tabs" aria-label="Business">${tabs.map((t) => html`<a href="${t[1]}?${range}" class="${t[0] === active ? 'active' : ''}" ${t[0] === active ? html`aria-current="page"` : ''}>${icon(t[2])}<span>${t[3]}</span></a>`)}</nav>
      <form class="hub-period" method="get" action="${base}">
        <input type="date" name="from" value="${from}" required aria-label="From">
        <span class="muted">to</span>
        <input type="date" name="to" value="${to}" required aria-label="To">
        <button class="btn btn-ghost btn-sm" type="submit">Apply</button>
      </form>
    </div>
    <div class="presets">${presets.map(([label, f, t]) => html`<a class="tab ${f === from && t === to ? 'active' : ''}" href="${base}?from=${f}&to=${t}">${label}</a>`)}</div>
    <div class="hub-strip">
      ${showRep ? tile(`/admin/reports?${range}`, 'wallet', 'Collected', money(snap.revenue, cur), 'green', 'Payments received') : ''}
      ${showRep ? tile(`/admin/reports?${range}`, 'receipt', 'Outstanding', money(snap.outstanding, cur), 'red', 'Still to collect') : ''}
      ${showInv ? tile(`/admin/inventory?${range}#items`, 'droplets', 'Supplies used', money(snap.suppliesCost, cur), 'cyan', 'Cost of washing') : ''}
      ${showInv ? tile(`/admin/operations#finance`, 'clipboard-list', 'Expenses', money(snap.expenses, cur), 'amber', 'Rent, wages, water') : ''}
      ${showInv ? tile(`/admin/inventory?${range}#profit`, 'sparkles', 'Net profit', money(snap.net, cur), snap.net >= 0 ? 'green' : 'red', marginTxt) : ''}
      ${showInv ? tile(`/admin/inventory?${range}#reorder`, 'package', 'Stock on hand', money(snap.stockValue, cur), 'violet', snap.lowCount ? `${snap.lowCount} to reorder` : 'All supplies OK') : ''}
    </div>
  </section>`;
}

module.exports = { bizHub };
