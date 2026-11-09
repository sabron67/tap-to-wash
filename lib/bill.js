// Weigh -> bill -> customer confirms -> payment (stage 1).
//
// bill_status on a request:
//   none              not weighed yet
//   needs_price       weighed, but a service has no price, so a staff member must price it
//   awaiting_confirm  bill calculated, waiting for the customer to confirm it
//   confirmed         customer (or staff on their behalf) confirmed the bill
//   disputed          customer disagreed (or staff re-opened it): weigh again
//   legacy            order was already past pick-up before this feature existed; never blocked
const { pool } = require('../config/db');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Units that can be fractional (kg, sq m ...). Everything else (item, pair, piece) is counted in whole numbers.
const DECIMAL_UNIT = /^(kg|kgs|g|sq\.?\s*m|m2|m|metre|meter|l|litre|liter)$/i;
const allowsDecimals = (unit) => DECIMAL_UNIT.test(String(unit || '').trim());
const isWeight = (unit) => /^(kg|kgs|g)$/i.test(String(unit || '').trim());
const measureLabel = (unit) => (isWeight(unit) ? `Weight (${String(unit).trim() || 'kg'})` : `Count (${String(unit || 'item').trim() || 'item'})`);

// Safaricom M-Pesa confirmation codes: 10 letters/digits, e.g. QGH7ABC123.
const MPESA_CODE = /^[A-Z0-9]{10}$/;
const cleanMpesaCode = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();

const MAX_QTY = 100000;

// Parse what the rider typed for each line. Returns { values: Map(itemId -> qty), error }.
function parseMeasurements(items, body) {
  const values = new Map();
  let any = false;
  for (const it of items) {
    const unit = it.cat_unit || it.unit;
    const raw = String(body[`qty_${it.id}`] ?? '').trim().replace(',', '.');
    if (raw === '') return { error: `Enter the ${isWeight(unit) ? 'weight' : 'count'} for ${it.category_name}.` };
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: `“${raw}” is not a valid number for ${it.category_name}.` };
    const n = Number(raw);
    if (n > MAX_QTY) return { error: `That amount is too large for ${it.category_name}.` };
    if (!allowsDecimals(unit) && !Number.isInteger(n)) return { error: `${it.category_name} is counted in whole ${String(unit || 'item')}s.` };
    if (n > 0) any = true;
    values.set(it.id, round2(n));
  }
  if (!any) return { error: 'Enter at least one weight or count above zero.' };
  return { values };
}

// Work out line totals. `rate` is the price per unit (null = not priced).
function computeLines(lines) {
  let subtotal = 0;
  let missing = false;
  const out = lines.map((l) => {
    const rate = l.rate === null || l.rate === undefined || l.rate === '' ? null : Number(l.rate);
    if (rate === null || !(rate >= 0)) {
      missing = true;
      return { ...l, rate: null, line_total: null };
    }
    const line_total = round2(Number(l.measured_qty) * rate);
    subtotal += line_total;
    return { ...l, rate, line_total };
  });
  return { lines: out, subtotal: round2(subtotal), missing };
}

// Look up an active discount code for this customer. Returns { discount, row } or { error }.
async function discountFor(db, code, subtotal, requestId, customerId) {
  if (!code) return { discount: 0, row: null };
  const found = await db.query(
    `SELECT * FROM discounts WHERE code=$1 AND is_active AND (starts_at IS NULL OR starts_at<=CURRENT_DATE) AND (ends_at IS NULL OR ends_at>=CURRENT_DATE) AND (max_uses IS NULL OR uses<max_uses)`,
    [code]
  );
  const prev = await db.query(`SELECT COUNT(*)::int AS n FROM requests WHERE customer_id=$1 AND id<>$2 AND status<>'cancelled'`, [customerId, requestId]);
  if (!found.rows.length || prev.rows[0].n + 1 < Number(found.rows[0].min_orders || 0)) {
    return { error: 'That discount code is invalid, expired, used up, or the customer does not meet its minimum-order rule.' };
  }
  const d = found.rows[0];
  const raw = d.discount_type === 'percent' ? (subtotal * Number(d.value)) / 100 : Number(d.value);
  return { discount: round2(Math.min(subtotal, Math.max(0, raw))), row: d };
}

// What stops this order from being picked up? Returns '' when it can go.
function pickupBlocker(r) {
  if (r.bill_status === 'legacy') return '';
  if (r.bill_status === 'none') return 'Weigh or count the laundry first so the customer can confirm the bill.';
  if (r.bill_status === 'needs_price') return 'A service on this order has no price yet. Ask the manager or cashier to price it.';
  if (r.bill_status === 'awaiting_confirm') return 'Waiting for the customer to confirm the bill.';
  if (r.bill_status === 'disputed') return 'The customer queried the bill. Weigh again and send a new bill.';
  const due = Math.max(0, Number(r.total_amount) - Number(r.amount_paid));
  if (due > 0 && !r.pay_later) return 'Payment has not been received yet. Record it, or ask a manager to allow pay later.';
  return '';
}

// Statuses at or after pick-up are protected by the gate.
const GATED_TARGETS = ['picked_up', 'washing', 'ready', 'delivered'];

// Everything the bill panel needs, with prices removed unless the viewer may see them.
async function loadBillData(requestId) {
  const [items, payments] = await Promise.all([
    pool.query(
      `SELECT i.id, i.category_name, i.quantity, i.unit, i.rate, i.measured_qty, i.line_total, c.unit AS cat_unit, c.price AS cat_price
         FROM request_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.request_id = $1 ORDER BY i.id`,
      [requestId]
    ),
    pool.query('SELECT id, amount, method, reference, recorded_by, reconciled, created_at FROM payments WHERE request_id = $1 ORDER BY id', [requestId]),
  ]);
  return { items: items.rows, payments: payments.rows };
}

module.exports = {
  round2,
  allowsDecimals,
  isWeight,
  measureLabel,
  MPESA_CODE,
  cleanMpesaCode,
  parseMeasurements,
  computeLines,
  discountFor,
  pickupBlocker,
  GATED_TARGETS,
  loadBillData,
};
