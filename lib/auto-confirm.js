// Auto-confirm: the moment a customer sends a request it is confirmed without waiting for staff.
//
//   1. The order moves New -> Confirmed (a normal, forward-only move; the owner/manager still get the "New request" alert).
//   2. Orders with no per-kg service are billed straight away, so the customer can pay at once.
//      Per-kg orders are billed after the rider weighs at the door (unchanged).
//   3. A rider is assigned (fewest open jobs) and alerted ("confirmed" event).
//   4. The customer is told live (Server-Sent Events) and in the response to the booking itself.
//
// Switch it off with Admin -> Settings -> Auto-confirm new requests; staff then confirm by hand as before.
// Safe to call twice: only an order that is still "new" is moved, and nothing happens a second time.
const { pool } = require('../config/db');
const { getSettings } = require('./settings');
const { autoBill } = require('./bill');
const { autoAssignRider } = require('./dispatch');
const { notifyEvent } = require('./notify');
const live = require('./live');

// What the customer needs to know right after confirmation.
function summarise(r) {
  const total = Number(r.total_amount);
  const paid = Number(r.amount_paid);
  const billed = r.bill_status === 'confirmed' && total > 0;
  let payment = 'awaiting_bill'; // per-kg: the bill comes after weighing; needs_price: we are finalising the price
  if (billed) payment = paid >= total ? 'paid' : paid > 0 ? 'part_paid' : 'pending_payment';
  return {
    status: r.status,
    bill_status: r.bill_status,
    payment_status: payment,
    total: billed ? total : null,
    due: billed ? Math.max(0, total - paid) : null,
  };
}

async function autoConfirm(requestId, business = 'Tap to Wash') {
  try {
    const settings = await getSettings();
    if (settings.auto_confirm === '0') return { confirmed: false, reason: 'off' };

    const upd = await pool.query("UPDATE requests SET status = 'confirmed', updated_at = now() WHERE id = $1 AND status = 'new' RETURNING id", [requestId]);
    if (!upd.rows.length) return { confirmed: false, reason: 'not_new' };

    await pool.query('INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [
      requestId,
      'confirmed',
      'Your request is confirmed automatically.',
      'system',
    ]);

    // Per-item orders get their bill now (the customer can pay at once). A missing price alerts the manager.
    const bill = await autoBill(pool, requestId).catch((e) => {
      console.error('auto-confirm bill failed:', e.message);
      return null;
    });
    if (bill && bill.status === 'needs_price') notifyEvent('bill_needs_price', requestId, null, business);

    // Rider first, so the "confirmed" alert goes to the rider who was assigned.
    const rider = await autoAssignRider(pool, requestId, 'system').catch((e) => {
      console.error('auto-confirm rider assignment failed:', e.message);
      return null;
    });
    notifyEvent(rider ? 'confirmed' : 'no_rider', requestId, null, business); // no active rider: the owner and manager are asked to assign one

    const { rows } = await pool.query('SELECT status, bill_status, total_amount, amount_paid FROM requests WHERE id = $1', [requestId]);
    live.publish(requestId, { force: true }); // customer, staff and rider screens update without a refresh
    return { confirmed: true, rider: rider ? rider.name : null, ...summarise(rows[0]) };
  } catch (err) {
    // Auto-confirm must never break the booking itself: the request is saved and staff can confirm it by hand.
    console.error('autoConfirm failed:', err.message);
    return { confirmed: false, reason: 'error' };
  }
}

module.exports = { autoConfirm, summarise };
