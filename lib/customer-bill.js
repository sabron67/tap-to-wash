// The customer confirms the bill the rider's weighing produced, or queries it. Used by the tracking page and the
// customer account, so both do exactly the same thing. Returns 'confirmed', 'queried' or 'stale'.
const { pool } = require('../config/db');
const live = require('./live');
const { notifyEvent } = require('./notify');
const { cleanText } = require('./helpers');

async function respondToBill(r, { action, version, comment, business }) {
  if (r.bill_status !== 'awaiting_confirm' || Number(version) !== r.bill_version) return 'stale';
  if (action === 'confirm') {
    const upd = await pool.query(
      "UPDATE requests SET bill_status='confirmed', bill_confirmed_at=now(), bill_confirmed_by='Customer', updated_at=now() WHERE id=$1 AND bill_status='awaiting_confirm' AND bill_version=$2 RETURNING id",
      [r.id, r.bill_version]
    );
    if (!upd.rows.length) return 'stale';
    await pool.query('INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [r.id, r.status, 'Bill confirmed by the customer.', 'Customer']);
    notifyEvent('bill_confirmed', r.id, null, business);
    live.publish(r.id);
    return 'confirmed';
  }
  const text = cleanText(comment, 300);
  const upd = await pool.query("UPDATE requests SET bill_status='disputed', updated_at=now() WHERE id=$1 AND bill_status='awaiting_confirm' AND bill_version=$2 RETURNING id", [r.id, r.bill_version]);
  if (!upd.rows.length) return 'stale';
  await pool.query('INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [r.id, r.status, text ? `Customer queried the bill: ${text}` : 'Customer queried the bill.', 'Customer']);
  notifyEvent('bill_disputed', r.id, null, business);
  live.publish(r.id);
  return 'queried';
}

module.exports = { respondToBill };
