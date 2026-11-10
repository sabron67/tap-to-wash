const { html } = require('../../lib/html');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { money, fmtDate } = require('../../lib/helpers');

const STAGES = [['unassigned', 'Unassigned'], ['scheduled', 'Scheduled'], ['picked_up', 'Picked up'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered']];
const stageLabel = (v) => (STAGES.find((s) => s[0] === v) || [v, v || 'Unassigned'])[1];

function operationsPage(ctx, d) {
  const cur = ctx.settings.currency;
  const field = (name, label, type = 'text', required = true, extra = '') =>
    html`<label class="field"><span>${label}</span><input name="${name}" type="${type}" ${required ? 'required' : ''} ${extra}></label>`;
  const select = (name, label, options, required = true) =>
    html`<label class="field"><span>${label}</span><select name="${name}" ${required ? 'required' : ''}>${options.map((o) => html`<option value="${o[0]}">${o[1]}</option>`)}</select></label>`;
  const section = (id, title, desc, body) =>
    html`<section class="glass pad ops-section" id="${id}"><div class="card-head"><div><h2>${title}</h2><p class="muted small">${desc}</p></div></div>${body}</section>`;
  const form = (action, body, button = 'Save') =>
    html`<form class="ops-form" method="post" action="/admin/operations/${action}">${csrfField(ctx)}${body}<button class="btn btn-primary" type="submit">${button}</button></form>`;
  const table = (headers, rows, empty = 'No records yet.') =>
    rows.length
      ? html`<div class="table-wrap"><table class="table"><thead><tr>${headers.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>`
      : html`<div class="empty"><p>${empty}</p></div>`;
  const options = (list, current) => list.map((o) => html`<option value="${o[0]}" ${o[0] === current ? 'selected' : ''}>${o[1]}</option>`);
  const statusForm = (action, x, list, extra = '') =>
    html`<form class="inline-form" method="post" action="/admin/operations/${action}">${csrfField(ctx)}<input type="hidden" name="id" value="${x.id}"><select name="status" aria-label="Status">${options(list, x.status)}</select>${extra}<button class="btn btn-sm btn-ghost" type="submit">Update</button></form>`;
  const toggleForm = (action, x) =>
    html`<form class="inline-form" method="post" action="/admin/operations/${action}">${csrfField(ctx)}<input type="hidden" name="id" value="${x.id}"><input type="hidden" name="active" value="${x.is_active ? '0' : '1'}"><button class="switch sm ${x.is_active ? 'on' : ''}" type="submit" role="switch" aria-checked="${x.is_active ? 'true' : 'false'}" aria-label="${x.is_active ? 'Deactivate' : 'Activate'}"><span class="switch-knob"></span><span class="switch-txt">${x.is_active ? 'Active' : 'Off'}</span></button></form>`;

  const requestOptions = d.requests.map((r) => [r.id, `${r.ref_code} · ${r.customer_name}`]);
  const complaintStatuses = [['open', 'Open'], ['investigating', 'Investigating'], ['resolved', 'Resolved'], ['closed', 'Closed']];
  const refundStatuses = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['paid', 'Paid']];
  const net = Number(d.counts.month_revenue || 0) - Number(d.counts.month_expenses || 0);

  const jumps = [['dispatch', 'Dispatch'], ['quality', 'Quality'], ['finance', 'Expenses'], ['inventory', 'Stock'], ['customers', 'Customer care'], ['growth', 'Discounts']];
  if (d.branchesOn) jumps.push(['branches', 'Branches']);

  const body = html`
  <div class="ops-intro">
    <p class="muted">Day-to-day control: pickup and delivery, quality checks, expenses, stock, customer care and discount codes${d.branchesOn ? ', plus your branches' : ''}.</p>
    <nav class="ops-jumps" aria-label="Sections">${jumps.map((j) => html`<a href="#${j[0]}">${j[1]}</a>`)}</nav>
    <div class="ops-jumps">
      <a href="/admin/operations/export.csv?type=expenses">Export expenses CSV</a>
      <a href="/admin/operations/export.csv?type=inventory">Export inventory CSV</a>
      <a href="/admin/operations/export.csv?type=reviews">Export reviews CSV</a>
      <a href="/admin/operations/export.csv?type=complaints">Export complaints CSV</a>
    </div>
  </div>
  <section class="stats ops-stats">
    <div class="stat glass"><span class="stat-val">${d.counts.open_complaints}</span><span class="stat-label">Open complaints</span></div>
    <div class="stat glass"><span class="stat-val">${money(d.counts.month_expenses, cur)}</span><span class="stat-label">Expenses this month</span></div>
    <div class="stat glass"><span class="stat-val">${d.counts.low_stock}</span><span class="stat-label">Low-stock alerts</span></div>
    <div class="stat glass"><span class="stat-val">${money(net, cur)}</span><span class="stat-label">Collected less expenses (this month)</span></div>
  </section>

  ${section('dispatch', 'Pickup and delivery', 'Assign a rider, set pickup and delivery slots and record the dispatch stage.', html`
    ${form('dispatch', html`${select('request_id', 'Laundry request', requestOptions)}${select('rider_admin_id', 'Assigned rider', [['', 'Unassigned'], ...d.riders.map((r) => [r.id, `${r.name} (${r.phone || r.email})`])], false)}${field('pickup_scheduled_at', 'Pickup date and time', 'datetime-local', false)}${field('delivery_scheduled_at', 'Delivery date and time', 'datetime-local', false)}${d.branchesOn ? select('branch_id', 'Branch', [['', 'No branch'], ...d.branches.filter((b) => b.is_active).map((b) => [b.id, b.name])], false) : ''}${select('dispatch_stage', 'Dispatch stage', STAGES.slice(1))}`, 'Save dispatch')}
    ${table(d.branchesOn ? ['Request', 'Customer', 'Rider', 'Branch', 'Pickup', 'Delivery', 'Stage'] : ['Request', 'Customer', 'Rider', 'Pickup', 'Delivery', 'Stage'],
      d.dispatch.map((x) => html`<tr><td><a class="link" href="/admin/requests/${x.id}">${x.ref_code}</a></td><td>${x.customer_name}</td><td>${x.rider_name || 'Unassigned'}</td>${d.branchesOn ? html`<td>${x.branch_name || '—'}</td>` : ''}<td>${x.pickup_scheduled_at ? fmtDate(x.pickup_scheduled_at) : '—'}</td><td>${x.delivery_scheduled_at ? fmtDate(x.delivery_scheduled_at) : '—'}</td><td>${stageLabel(x.dispatch_stage)}</td></tr>`))}
  `)}

  ${section('quality', 'Quality control', 'Record a final inspection before an order is released to the customer.', html`
    ${form('quality', html`${select('request_id', 'Laundry request', requestOptions)}<div class="check-grid">${['stain_check', 'count_check', 'damage_check', 'packaging_check'].map((k, i) => html`<label><input type="checkbox" name="${k}" value="1"> ${['Stain check', 'Item count check', 'Damage check', 'Packaging check'][i]}</label>`)}</div>${select('passed', 'Result', [['1', 'Passed'], ['0', 'Needs rework']])}<label class="field"><span>Notes</span><input name="notes" maxlength="1000"></label>`, 'Save inspection')}
    ${table(['Request', 'Checked by', 'Result', 'Checks', 'Notes', 'Date'], d.inspections.map((x) => html`<tr><td>${x.ref_code}</td><td>${x.checked_by_name || 'Staff'}</td><td>${x.passed ? (String(x.notes || '').startsWith('OVERRIDE') ? html`<span class="badge pay-partial">Passed (override)</span>` : 'Passed') : 'Rework'}</td><td>${[x.stain_check, x.count_check, x.damage_check, x.packaging_check].filter(Boolean).length}/4</td><td>${x.notes || '—'}</td><td>${fmtDate(x.created_at)}</td></tr>`))}
  `)}

  ${section('finance', 'Expenses', 'Record operating costs. Profit estimate = collected revenue minus recorded expenses.', html`
    ${form('expense', html`${select('category', 'Category', ['Detergents', 'Water', 'Electricity', 'Rent', 'Fuel and delivery', 'Salaries', 'Repairs', 'Packaging', 'Other'].map((c) => [c, c]))}${field('description', 'Description')}${field('amount', 'Amount', 'number', true, 'min="0.01" step="0.01"')}${field('spent_on', 'Date', 'date', false)}`, 'Record expense')}
    ${table(['Date', 'Category', 'Description', 'Amount'], d.expenses.map((x) => html`<tr><td>${x.spent_on instanceof Date ? x.spent_on.toISOString().slice(0, 10) : x.spent_on}</td><td>${x.category}</td><td>${x.description}</td><td>${money(x.amount, cur)}</td></tr>`))}
  `)}

  ${section('inventory', 'Stock and supplies', 'Track stock levels and record supplies received or used. Low stock is flagged in the list.', html`
    ${form('inventory', html`${field('name', 'Supply name')}${field('unit', 'Unit', 'text', true, 'value="litres"')}${field('quantity', 'Opening quantity', 'number', true, 'step="0.01" min="0"')}${field('reorder_level', 'Reorder level', 'number', true, 'step="0.01" min="0"')}${field('unit_cost', 'Unit cost', 'number', false, 'step="0.01" min="0"')}`, 'Add supply')}
    ${d.inventory.length ? form('stock', html`${select('inventory_item_id', 'Supply', d.inventory.map((x) => [x.id, `${x.name} (${x.quantity} ${x.unit})`]))}${field('quantity_change', 'Change (+ received / − used)', 'number', true, 'step="0.01"')}${field('reason', 'Reason')}`, 'Update stock') : ''}
    ${table(['Supply', 'Quantity', 'Reorder level', 'Unit cost', 'Stock status'], d.inventory.map((x) => html`<tr><td>${x.name}</td><td>${x.quantity} ${x.unit}</td><td>${x.reorder_level}</td><td>${money(x.unit_cost, cur)}</td><td>${Number(x.quantity) <= Number(x.reorder_level) ? html`<strong>Reorder</strong>` : 'OK'}</td></tr>`))}
  `)}

  ${section('customers', 'Customer care and refunds', 'Log complaints, follow them up, record refunds and read customer reviews.', html`
    ${form('complaint', html`${select('request_id', 'Related order (optional)', [['', 'No order selected'], ...requestOptions], false)}${field('subject', 'Complaint subject')}${field('details', 'Details', 'text', false)}`, 'Log complaint')}
    ${table(['Complaint', 'Order', 'Customer', 'Status', 'Created'], d.complaints.map((x) => html`<tr><td>${x.subject}</td><td>${x.ref_code || '—'}</td><td>${x.customer_name || '—'}</td><td>${statusForm('complaint-status', x, complaintStatuses, html`<input name="resolution" placeholder="Resolution / action taken" value="${x.resolution || ''}" maxlength="500" aria-label="Resolution">`)}</td><td>${fmtDate(x.created_at)}</td></tr>`))}
    <h3>Refunds</h3>
    ${form('refund', html`${select('request_id', 'Order', requestOptions)}${field('amount', 'Refund amount', 'number', true, 'min="0.01" step="0.01"')}${field('reason', 'Reason')}`, 'Submit refund for approval')}
    ${table(['Order', 'Amount', 'Reason', 'Status'], d.refunds.map((x) => html`<tr><td>${x.ref_code}</td><td>${money(x.amount, cur)}</td><td>${x.reason}</td><td>${statusForm('refund-status', x, refundStatuses)}</td></tr>`))}
    <h3>Customer reviews</h3>
    ${table(['Order', 'Customer', 'Rating', 'Comment', 'Date'], d.reviews.map((x) => html`<tr><td>${x.ref_code}</td><td>${x.customer_name}</td><td>${x.rating}/5</td><td>${x.comment || '—'}</td><td>${fmtDate(x.created_at)}</td></tr>`))}
  `)}

  ${section('growth', 'Discount codes', 'Create promotional codes. Staff apply a code in the billing form on the request page.', html`
    ${form('discount', html`${field('code', 'Code')}${field('description', 'Description', 'text', false)}${select('discount_type', 'Discount type', [['percent', 'Percentage'], ['fixed', 'Fixed amount']])}${field('value', 'Discount value', 'number', true, 'min="0.01" step="0.01"')}${field('min_orders', 'Minimum orders', 'number', true, 'min="1" value="1"')}${field('ends_at', 'Expiry date', 'date', false)}${field('max_uses', 'Maximum uses', 'number', false, 'min="1"')}`, 'Create discount')}
    ${table(['Code', 'Discount', 'Minimum orders', 'Uses', 'Status'], d.discounts.map((x) => html`<tr><td><strong>${x.code}</strong></td><td>${x.discount_type === 'percent' ? `${x.value}%` : money(x.value, cur)}</td><td>${x.min_orders}</td><td>${x.uses}${x.max_uses ? ` / ${x.max_uses}` : ''}</td><td>${toggleForm('discount-status', x)}</td></tr>`))}
  `)}

  ${d.branchesOn ? section('branches', 'Branches', 'Add outlets and switch each one on or off. Only active branches appear to customers when they tap to wash.', html`
    ${form('branch', html`${field('name', 'Branch name')}${field('phone', 'Contact phone', 'tel', false)}${field('address', 'Address', 'text', false)}`, 'Add branch')}
    ${table(['Branch', 'Phone', 'Address', 'Orders', 'Active'], d.branches.map((x) => html`<tr><td>${x.name}</td><td>${x.phone || '—'}</td><td>${x.address || '—'}</td><td>${x.orders}</td><td>${toggleForm('branch-status', x)}</td></tr>`), 'No branches yet. Add your first one above.')}
  `) : ''}
  `;
  return adminLayout(ctx, { title: 'Operations', active: 'operations', body });
}
module.exports = { operationsPage };
