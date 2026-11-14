// Inventory and profit page. Only reachable with the 'inventory' permission (owner and manager).
const { html } = require('../../lib/html');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { money } = require('../../lib/helpers');
const { icon } = require('../../lib/icons');
const { bizHub } = require('../partials/biz-hub');

const KINDS = { opening: 'Opening stock', purchase: 'Bought', usage: 'Used', waste: 'Damaged / lost', adjustment: 'Stock count' };
const CATEGORIES = ['Detergents', 'Softeners and stain removers', 'Packaging', 'Hangers and tags', 'Cleaning supplies', 'Other'];
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const qty = (n) => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
const cost4 = (n) => Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function inventoryPage(ctx, d) {
  const cur = ctx.settings.currency;
  const { from, to, profit: p } = d;
  const range = `from=${from}&to=${to}`;
  const rangeFields = html`<input type="hidden" name="from" value="${from}"><input type="hidden" name="to" value="${to}">`;
  const active = d.items.filter((x) => x.is_active);

  const field = (name, label, type = 'text', required = true, extra = '') =>
    html`<label class="field"><span>${label}</span><input name="${name}" type="${type}" ${required ? 'required' : ''} ${extra}></label>`;
  const itemSelect = (name = 'inventory_item_id') =>
    html`<label class="field"><span>Supply</span><select name="${name}" required>${active.map((x) => html`<option value="${x.id}">${x.name} (${qty(x.quantity)} ${x.unit} in stock)</option>`)}</select></label>`;
  const section = (id, title, desc, body) =>
    html`<section class="glass pad ops-section" id="${id}"><div class="card-head"><div><h2>${title}</h2><p class="muted small">${desc}</p></div></div>${body}</section>`;
  const form = (action, body, button = 'Save') =>
    html`<form class="ops-form" method="post" action="/admin/inventory/${action}">${csrfField(ctx)}${rangeFields}${body}<button class="btn btn-primary" type="submit">${button}</button></form>`;
  const table = (headers, rows, empty = 'No records yet.') =>
    rows.length
      ? html`<div class="table-wrap"><table class="table"><thead><tr>${headers.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>`
      : html`<div class="empty"><p>${empty}</p></div>`;
  const line = (label, value, { strong = false, sign = '' } = {}) =>
    html`<tr><td>${strong ? html`<strong>${label}</strong>` : label}</td><td style="text-align:right">${strong ? html`<strong>${sign}${money(value, cur)}</strong>` : html`${sign}${money(value, cur)}`}</td></tr>`;

  const noStock = !active.length;
  const body = html`
  ${bizHub(ctx, { active: 'inventory', from, to, presets: d.presets, snap: d.snap })}
  <div class="ops-intro">
    <p class="muted">Stock, supply costs and profit for the period above. Revenue comes from the same payments as your <a class="link" href="/admin/reports?${range}">Reports</a>, so the two always agree. Visible to the <strong>owner and manager only</strong>.</p>
    <nav class="ops-jumps" aria-label="Sections">
      ${[['profit', 'Profit'], ['receive', 'Receive stock'], ['use', 'Use / count'], ['items', 'Supplies'], ['history', 'History']].map((j) => html`<a href="#${j[0]}">${j[1]}</a>`)}
    </nav>
    <div class="ops-jumps">
      <a href="/admin/inventory/export.xlsx?type=stock">${icon('download')} Stock list (Excel)</a>
      <a href="/admin/inventory/export.xlsx?type=movements&${range}">${icon('download')} Movements (Excel)</a>
      <a href="/admin/inventory/export.xlsx?type=profit&${range}">${icon('download')} Profit workbook (Excel)</a>
      ${ctx.can('reports') ? html`<a href="/admin/reports/download?${range}">${icon('download')} Full business report (Excel)</a>` : ''}
    </div>
  </div>

  ${d.low.length ? html`<section class="glass pad ops-section" id="reorder"><h2>Reorder now</h2><p class="muted small">At or below the reorder level.</p>
    ${table(['Supply', 'In stock', 'Reorder level', 'Supplier'], d.low.map((x) => html`<tr><td>${x.name}</td><td>${qty(x.quantity)} ${x.unit}</td><td>${qty(x.reorder_level)} ${x.unit}</td><td>${x.supplier || '—'}</td></tr>`))}</section>` : ''}

  ${section('profit', 'Profit calculator', 'Profit = money collected, less refunds paid, less supplies used, less other expenses. Supplies are counted when used, not when bought.', html`
    <div class="table-wrap"><table class="table">
      <thead><tr><th>${from} to ${to}</th><th style="text-align:right">${cur}</th></tr></thead>
      <tbody>
        ${line('Revenue collected (payments received)', p.revenue, { strong: true })}
        ${line('Refunds paid', p.refundsPaid, { sign: '− ' })}
        ${line('Supplies used in washing', p.used, { sign: '− ' })}
        ${line('Supplies damaged or lost', p.waste, { sign: '− ' })}
        ${line('Stock count differences', Math.abs(p.adjust), { sign: p.adjust < 0 ? '+ ' : '− ' })}
        ${line('Gross profit', p.gross, { strong: true })}
        ${line('Other operating expenses (Operations › Expenses)', p.expenses, { sign: '− ' })}
        ${line('NET PROFIT', p.net, { strong: true })}
      </tbody>
    </table></div>
    <p class="small"><strong>Profit margin:</strong> ${p.margin === null ? 'n/a (no revenue in this period)' : `${p.margin.toFixed(1)}%`} &nbsp;·&nbsp; <strong>Stock bought in this period:</strong> ${money(p.purchases, cur)} <span class="muted">(information only, already reflected through supplies used)</span></p>
    <p class="muted small"><strong>Avoid double counting:</strong> record detergent, packaging and other stock under <em>Receive stock</em> here, and do not enter the same purchase again as an expense. Use Expenses for rent, salaries, water, electricity, fuel and repairs.</p>
    ${table(['Supply', 'Quantity used or lost', 'Cost'], d.byItem.map((x) => html`<tr><td>${x.name}</td><td>${qty(x.qty_out)} ${x.unit}</td><td>${money(x.cost, cur)}</td></tr>`), 'No supplies used in this period.')}
  `)}

  ${section('receive', 'Receive stock (purchase)', 'Record what you bought. Enter the total you paid; the system works out the cost per unit and keeps an average cost.',
    noStock ? html`<div class="empty"><p>Add a supply first (see Supplies below).</p></div>` :
    form('purchase', html`${itemSelect()}${field('quantity', 'Quantity received', 'number', true, 'min="0.01" step="0.01"')}${field('total_cost', `Total cost paid (${cur})`, 'number', true, 'min="0" step="0.01"')}${field('supplier', 'Supplier', 'text', false, 'maxlength="100"')}${field('reference', 'Invoice / receipt no.', 'text', false, 'maxlength="80"')}${field('occurred_on', 'Date bought', 'date', false)}`, 'Receive stock'))}

  ${section('use', 'Use stock, losses and stock counts', 'Record supplies used up, damaged or lost, or correct the system after counting what is on the shelf.',
    noStock ? html`<div class="empty"><p>Add a supply first.</p></div>` : html`
    <h3>Used or lost</h3>
    ${form('use', html`${itemSelect()}${field('quantity', 'Quantity', 'number', true, 'min="0.01" step="0.01"')}<label class="field"><span>Type</span><select name="kind"><option value="usage">Used in washing</option><option value="waste">Damaged / lost</option></select></label>${field('reason', 'Note', 'text', false, 'maxlength="200"')}${field('occurred_on', 'Date', 'date', false)}`, 'Record')}
    <h3>Stock count</h3>
    ${form('count', html`${itemSelect()}${field('counted', 'Actual quantity counted', 'number', true, 'min="0" step="0.01"')}${field('reason', 'Reason', 'text', true, 'maxlength="200" placeholder="Monthly count"')}`, 'Save count')}`)}

  ${section('items', 'Supplies', 'Your list of supplies with stock, average cost and value. Switch a supply off to hide it from the forms (its history is kept).', html`
    ${form('item', html`${field('name', 'Supply name', 'text', true, 'maxlength="100"')}${field('unit', 'Unit', 'text', true, 'value="litres" maxlength="30"')}<label class="field"><span>Category</span><select name="category">${CATEGORIES.map((c) => html`<option>${c}</option>`)}</select></label>${field('quantity', 'Opening quantity', 'number', false, 'min="0" step="0.01" value="0"')}${field('unit_cost', `Cost per unit (${cur})`, 'number', false, 'min="0" step="0.01" value="0"')}${field('reorder_level', 'Reorder level', 'number', false, 'min="0" step="0.01" value="0"')}${field('supplier', 'Supplier', 'text', false, 'maxlength="100"')}`, 'Add supply')}
    ${table(['Supply', 'Category', 'In stock', 'Avg cost', 'Value', 'Status', 'Edit'], d.items.map((x) => html`<tr>
      <td>${x.name}${x.supplier ? html`<br><small class="muted">${x.supplier}</small>` : ''}</td><td>${x.category}</td><td>${qty(x.quantity)} ${x.unit}</td><td>${cost4(x.unit_cost)}</td><td>${money(x.value, cur)}</td>
      <td>${!x.is_active ? 'Off' : Number(x.quantity) <= Number(x.reorder_level) ? html`<strong>Reorder</strong>` : 'OK'}</td>
      <td><details><summary class="link">Edit</summary>
        <form class="ops-form" method="post" action="/admin/inventory/item/update">${csrfField(ctx)}${rangeFields}<input type="hidden" name="id" value="${x.id}">
          <label class="field"><span>Name</span><input name="name" value="${x.name}" required maxlength="100"></label>
          <label class="field"><span>Unit</span><input name="unit" value="${x.unit}" maxlength="30"></label>
          <label class="field"><span>Category</span><input name="category" value="${x.category}" maxlength="60"></label>
          <label class="field"><span>Supplier</span><input name="supplier" value="${x.supplier}" maxlength="100"></label>
          <label class="field"><span>Reorder level</span><input name="reorder_level" type="number" min="0" step="0.01" value="${x.reorder_level}" required></label>
          <label class="field"><span>Average cost per unit</span><input name="unit_cost" type="number" min="0" step="0.0001" value="${Number(x.unit_cost)}" required></label>
          <label class="field"><span>Status</span><select name="is_active"><option value="1" ${x.is_active ? 'selected' : ''}>Active</option><option value="0" ${x.is_active ? '' : 'selected'}>Off (hidden from forms)</option></select></label>
          <button class="btn btn-primary btn-sm" type="submit">Save</button>
        </form></details></td></tr>`), 'No supplies yet. Add your first one above.')}
  `)}

  ${section('history', 'Stock history', `All movements from ${from} to ${to}${d.moves.length === 300 ? ' (latest 300 shown; export the Excel file for everything)' : ''}.`,
    table(['Date', 'Supply', 'Type', 'Change', 'Cost / unit', 'Value', 'Note', 'By'], d.moves.map((m) => html`<tr><td>${ymd(m.occurred_on)}</td><td>${m.item_name}</td><td>${KINDS[m.kind] || m.kind}</td><td>${Number(m.quantity_change) > 0 ? '+' : ''}${qty(m.quantity_change)} ${m.unit}</td><td>${cost4(m.unit_cost)}</td><td>${money(Number(m.quantity_change) * Number(m.unit_cost), cur)}</td><td>${m.reason || '—'}${m.reference ? html`<br><small class="muted">Ref ${m.reference}</small>` : ''}</td><td>${m.by_name || '—'}</td></tr>`), 'No stock movements in this period.'))}`;
  return adminLayout(ctx, { title: 'Inventory', active: 'inventory', body });
}

module.exports = { inventoryPage };
