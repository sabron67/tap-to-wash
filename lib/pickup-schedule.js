const { pool } = require('../config/db');

const SLOTS = [
  { value: '09:00', label: '9:00 AM – 11:00 AM' },
  { value: '11:00', label: '11:00 AM – 1:00 PM' },
  { value: '13:00', label: '1:00 PM – 3:00 PM' },
  { value: '15:00', label: '3:00 PM – 5:00 PM' },
  { value: '17:00', label: '5:00 PM – 7:00 PM' },
];

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const maxDate = new Date(`${today}T12:00:00Z`);
  maxDate.setUTCDate(maxDate.getUTCDate() + 14);
  const max = maxDate.toISOString().slice(0, 10);
  return String(value) >= today && String(value) <= max;
}
function validSlot(value) { return SLOTS.some((s) => s.value === value); }
function slotLabel(value) { return SLOTS.find((s) => s.value === value)?.label || ''; }

async function availability(date, excludeRequestId = null) {
  if (!validDate(date)) return [];
  const riders = await pool.query("SELECT COUNT(*)::int AS n FROM admins WHERE role = 'rider' AND is_active = TRUE");
  const capacity = riders.rows[0].n;
  if (!capacity) return SLOTS.map((s) => ({ ...s, available: false, remaining: 0 }));
  const bookings = await pool.query(
    `SELECT to_char(pickup_scheduled_at AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') AS slot, COUNT(*)::int AS n
       FROM requests
      WHERE (pickup_scheduled_at AT TIME ZONE 'Africa/Nairobi')::date = ($1::date)
        AND status NOT IN ('cancelled','delivered')
        AND ($2::int IS NULL OR id <> $2)
      GROUP BY 1`,
    [date, excludeRequestId]
  );
  const used = new Map(bookings.rows.map((r) => [r.slot, r.n]));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const nowTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  return SLOTS.map((s) => {
    const remaining = Math.max(0, capacity - (used.get(s.value) || 0));
    const notPassed = date !== today || s.value > nowTime;
    return { ...s, available: remaining > 0 && notPassed, remaining: notPassed ? remaining : 0 };
  });
}

async function reserve(client, date, time, requestId = null) {
  if (!validDate(date) || !validSlot(time)) throw new Error('Choose a valid pickup date and time slot.');
  const timestamp = `${date} ${time}:00`;
  // Serialise bookings for the same pickup slot, preventing simultaneous requests from overbooking.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [timestamp]);
  const riders = await client.query("SELECT COUNT(*)::int AS n FROM admins WHERE role = 'rider' AND is_active = TRUE");
  const used = await client.query(
    `SELECT COUNT(*)::int AS n FROM requests
      WHERE pickup_scheduled_at = ($1::timestamp AT TIME ZONE 'Africa/Nairobi')
        AND status NOT IN ('cancelled','delivered')
        AND ($2::int IS NULL OR id <> $2)`,
    [timestamp, requestId]
  );
  if (!riders.rows[0].n || used.rows[0].n >= riders.rows[0].n) {
    throw new Error('That pickup slot has just become unavailable. Please choose another time.');
  }
  const updated = await client.query(
    `UPDATE requests SET pickup_scheduled_at = ($1::timestamp AT TIME ZONE 'Africa/Nairobi'),
       preferred_time = $2, updated_at = now()
     WHERE id = $3 AND status IN ('new','confirmed')`,
    [timestamp, slotLabel(time), requestId]
  );
  if (!updated.rowCount) throw new Error('This order is no longer eligible for pickup rescheduling.');
  return updated;
}

module.exports = { SLOTS, validDate, validSlot, slotLabel, availability, reserve };
