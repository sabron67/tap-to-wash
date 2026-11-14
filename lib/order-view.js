// What a customer sees about one order, built the same way for the tracking link (/track) and for the order page
// inside a customer account (/account/requests/:ref), so the bill and the pay box can never differ between the two.
const { pool } = require('../config/db');
const stk = require('./stk');

const BILL_ROW = `r.id, r.ref_code, r.status, r.pickup_scheduled_at, r.delivery_scheduled_at, r.dispatch_stage,
  r.bill_status, r.bill_version, r.subtotal_amount, r.discount_code, r.discount_amount, r.total_amount, r.amount_paid, r.pay_later`;

// The bill is shown once the laundry has been weighed and priced (or, for per-item orders, once the order is confirmed).
function billFrom(r, items) {
  const billed = ['awaiting_confirm', 'confirmed', 'disputed'].includes(r.bill_status) && items.length && items.every((i) => i.measured_qty !== null && i.line_total !== null);
  if (!billed) return null;
  return {
    status: r.bill_status,
    version: r.bill_version,
    lines: items,
    weighed: items.some((i) => /^(kg|kgs|g)$/i.test(String(i.unit || '').trim())),
    subtotal: r.subtotal_amount,
    discount: r.discount_amount,
    total: r.total_amount,
    paid: r.amount_paid,
    pay_later: r.pay_later,
  };
}

// The M-Pesa prompt part of the pay box: is it available, and what is the state of the latest prompt?
// `wantedId` is the prompt the page was opened for (?stk=ID); without it a prompt still waiting for an answer is shown.
async function payState(r, bill, { wantedId = 0, phone = '' } = {}) {
  const state = { enabled: stk.enabled(), phone, attempt: null };
  if (!state.enabled || !bill || bill.status !== 'confirmed') return state;
  let row = null;
  if (wantedId) {
    const f = await pool.query('SELECT id FROM mpesa_stk WHERE id = $1 AND request_id = $2', [wantedId, r.id]);
    if (f.rows.length) row = await stk.refresh(wantedId);
  } else {
    const f = await pool.query("SELECT id FROM mpesa_stk WHERE request_id = $1 AND status = 'pending' AND created_at > now() - interval '4 minutes' ORDER BY id DESC LIMIT 1", [r.id]);
    if (f.rows.length) row = await stk.refresh(f.rows[0].id);
  }
  if (row) state.attempt = { id: row.id, status: row.status, message: stk.describe(row), phone: stk.maskPhone(row.phone) };
  return state;
}

async function loadOrderParts(requestId) {
  const [items, events] = await Promise.all([
    pool.query('SELECT category_name, quantity, unit, measured_qty, rate, line_total FROM request_items WHERE request_id = $1 ORDER BY id', [requestId]),
    pool.query('SELECT status, note, created_at FROM request_events WHERE request_id = $1 ORDER BY created_at DESC, id DESC', [requestId]),
  ]);
  return { items: items.rows, events: events.rows };
}

module.exports = { BILL_ROW, billFrom, payState, loadOrderParts };
