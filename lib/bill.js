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
// Only services charged per kilogram (clothes per kg) are weighed and need the customer to confirm the bill.
// Everything else (per item, per pair ...) is billed from the order itself: once the order is confirmed the
// bill is created automatically and payment can be collected.
const needsWeighing = (unit) => isWeight(unit);
const measureLabel = (unit) => (isWeight(unit) ? `Weight (${String(unit).trim() || 'kg'})` : `Count (${String(unit || 'item').trim() || 'item'})`);

// Safaricom M-Pesa confirmation codes: 10 letters/digits, e.g. QGH7ABC123.
const MPESA_CODE = /^[A-Z0-9]{10}$/;
const cleanMpesaCode = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();

const MAX_QTY = 100000;

// Parse what the rider typed for each line. Returns { values: Map(itemId -> qty), error }.
function parseMeasurements(items, body) {
  const values = new Map();
  let anyWeight = false;
  let hasWeightLine = false;
  for (const it of items) {
    const unit = it.cat_unit || it.unit;
    if (!needsWeighing(unit)) {
      // Not weighed: the bill uses the number of items the customer ordered.
      values.set(it.id, round2(Number(it.quantity) || 0));
      continue;
    }
    hasWeightLine = true;
    const raw = String(body[`qty_${it.id}`] ?? '').trim().replace(',', '.');
    if (raw === '') return { error: `Enter the weight for ${it.category_name}.` };
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: `“${raw}” is not a valid weight for ${it.category_name}.` };
    const n = Number(raw);
    if (n > MAX_QTY) return { error: `That amount is too large for ${it.category_name}.` };
    if (n > 0) anyWeight = true;
    values.set(it.id, round2(n));
  }
  if (!hasWeightLine) return { error: 'This order has no per-kg service, so there is nothing to weigh.' };
  if (!anyWeight) return { error: 'Enter at least one weight above zero.' };
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


// Orders with no per-kg service need no weighing and no customer bill confirmation: when the order is confirmed
// the bill is created from the ordered quantities and is immediately ready for payment. Safe to call repeatedly.
// `db` is the pool or a transaction client. Returns { status } when it billed, or null when nothing was done.
async function autoBill(db, requestId, by = 'Order confirmation') {
  if (!Number.isInteger(requestId)) return null;
  const head = await db.query('SELECT status, bill_status FROM requests WHERE id = $1', [requestId]);
  if (!head.rows.length || head.rows[0].status !== 'confirmed' || head.rows[0].bill_status !== 'none') return null;

  const own = typeof db.release === 'function' ? null : await db.connect();
  const client = own || db;
  try {
    if (own) await client.query('BEGIN');
    const { rows: r } = await client.query('SELECT id, status, bill_status FROM requests WHERE id = $1 FOR UPDATE', [requestId]);
    if (!r.length || r[0].status !== 'confirmed' || r[0].bill_status !== 'none') {
      if (own) await client.query('COMMIT');
      return null;
    }
    const { rows: items } = await client.query(
      `SELECT i.id, i.quantity, i.rate, c.unit AS cat_unit, i.unit AS line_unit, c.price AS cat_price
         FROM request_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.request_id = $1 ORDER BY i.id`,
      [requestId]
    );
    if (!items.length || items.some((i) => needsWeighing(i.cat_unit || i.line_unit))) {
      if (own) await client.query('COMMIT');
      return null; // has a per-kg line: the rider weighs it and the customer confirms
    }
    const lines = items.map((i) => ({
      id: i.id,
      measured_qty: Number(i.quantity),
      rate: i.cat_price === null || i.cat_price === undefined ? i.rate : i.cat_price,
      unit: i.cat_unit || i.line_unit || 'item',
    }));
    const calc = computeLines(lines);
    for (const l of calc.lines) {
      await client.query('UPDATE request_items SET measured_qty = $1, unit = $2, rate = $3, line_total = $4 WHERE id = $5', [l.measured_qty, l.unit, l.rate, l.line_total, l.id]);
    }
    const status = calc.missing ? 'needs_price' : 'confirmed';
    const subtotal = calc.missing ? 0 : calc.subtotal;
    await client.query(
      `UPDATE requests SET subtotal_amount=$1, discount_code='', discount_amount=0, total_amount=$1, bill_status=$2,
              bill_version=bill_version+1, bill_confirmed_at=${status === 'confirmed' ? 'now()' : 'NULL'}, bill_confirmed_by=$3,
              weighed_by='', pay_later=FALSE, pay_later_by='', updated_at=now()
        WHERE id=$4`,
      [subtotal, status, status === 'confirmed' ? by : '', requestId]
    );
    await client.query('INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [
      requestId,
      'confirmed',
      status === 'confirmed' ? 'Order confirmed. Your bill is ready and payment can be made.' : 'Order confirmed. We are finalising your price.',
      'system',
    ]);
    if (own) await client.query('COMMIT');
    return { status, total: subtotal };
  } catch (err) {
    if (own) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (own) client.release();
  }
}

// Does any line of this order need weighing and customer confirmation?
const orderNeedsWeighing = (items) => items.some((i) => needsWeighing(i.cat_unit || i.unit));

// What stops this order from being picked up? Returns '' when it can go.
function pickupBlocker(r, payBefore = true) {
  if (r.bill_status === 'legacy') return '';
  if (r.bill_status === 'none') return ['confirmed', 'rider_arrived'].includes(r.status) ? 'Weigh the per-kg clothes first so the customer can confirm the bill.' : 'Confirm the order first so the bill can be created.';
  if (r.bill_status === 'needs_price') return 'A service on this order has no price yet. Ask the manager or cashier to price it.';
  if (r.bill_status === 'awaiting_confirm') return 'Waiting for the customer to confirm the bill.';
  if (r.bill_status === 'disputed') return 'The customer queried the bill. Weigh again and send a new bill.';
  if (!payBefore) return ''; // pay on delivery: the bill must be confirmed, but money is settled at hand-over
  const due = Math.max(0, Number(r.total_amount) - Number(r.amount_paid));
  if (due > 0 && !r.pay_later) return 'Payment has not been received yet. Record it, or ask a manager to allow pay later.';
  return '';
}

// Statuses at or after pick-up are protected by the gate.
const GATED_TARGETS = ['picked_up', 'washing', 'ready', 'delivered'];

// Pay Before Cleaning: the order waits at Rider arrived and moves to Picked up by itself once the bill is confirmed and fully paid.
// Payments are recorded by hand, so a recorded payment counts as paid at once. Returns true when the order was advanced.
async function advanceIfPaid(db, requestId) {
  const r = await db.query('SELECT status, bill_status, total_amount, amount_paid FROM requests WHERE id = $1', [requestId]);
  if (!r.rows.length) return false;
  const x = r.rows[0];
  if (x.status !== 'rider_arrived' || x.bill_status !== 'confirmed' || Number(x.total_amount) <= 0 || Number(x.amount_paid) < Number(x.total_amount)) return false;
  const adv = await db.query("UPDATE requests SET status = 'picked_up', dispatch_stage = 'picked_up', updated_at = now() WHERE id = $1 AND status = 'rider_arrived' RETURNING id", [requestId]);
  if (!adv.rows.length) return false;
  await db.query('INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [requestId, 'picked_up', 'Payment received, so pick-up started automatically.', 'system']);
  return true;
}

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
  needsWeighing,
  orderNeedsWeighing,
  autoBill,
  measureLabel,
  MPESA_CODE,
  cleanMpesaCode,
  parseMeasurements,
  computeLines,
  discountFor,
  pickupBlocker,
  GATED_TARGETS,
  advanceIfPaid,
  loadBillData,
};
