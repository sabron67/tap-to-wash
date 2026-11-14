// Daily takings: money received each Nairobi day, split by M-Pesa and cash, next to what is still unpaid.
//  * "Received" comes from the payments ledger (what actually came in that day, whichever day the order was made).
//  * "Unpaid" is the balance still owing on orders MADE that day (cancelled orders are not counted).
const { pool } = require('../config/db');

const range = (alias) =>
  `${alias}.created_at >= ($1::date)::timestamp AT TIME ZONE 'Africa/Nairobi' AND ${alias}.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')`;
const DAY = (alias) => `to_char((${alias}.created_at AT TIME ZONE 'Africa/Nairobi')::date, 'YYYY-MM-DD')`;
const num = (v) => Number(v) || 0;

async function getTakings(from, to) {
  const [paid, unpaid, pays, owing] = await Promise.all([
    pool.query(
      `SELECT ${DAY('p')} AS day,
              COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'mpesa'), 0) AS mpesa,
              COUNT(*) FILTER (WHERE p.method = 'mpesa')::int AS mpesa_n,
              COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'cash'), 0)  AS cash,
              COUNT(*) FILTER (WHERE p.method = 'cash')::int AS cash_n
         FROM payments p WHERE ${range('p')} GROUP BY 1`,
      [from, to]
    ),
    pool.query(
      `SELECT ${DAY('r')} AS day, COUNT(*)::int AS orders,
              COALESCE(SUM(GREATEST(r.total_amount - r.amount_paid, 0)), 0) AS unpaid,
              COUNT(*) FILTER (WHERE r.total_amount - r.amount_paid > 0)::int AS unpaid_n
         FROM requests r WHERE ${range('r')} AND r.status <> 'cancelled' GROUP BY 1`,
      [from, to]
    ),
    pool.query(
      `SELECT to_char(p.created_at AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD HH24:MI') AS at, p.method, p.amount, p.reference, p.recorded_by,
              COALESCE(r.ref_code, NULLIF(p.request_ref, ''), '') AS ref_code, COALESCE(c.name, '') AS customer
         FROM payments p
         LEFT JOIN requests r ON r.id = p.request_id
         LEFT JOIN customers c ON c.id = r.customer_id
        WHERE ${range('p')} ORDER BY p.created_at DESC LIMIT 1001`,
      [from, to]
    ),
    pool.query(
      `SELECT r.ref_code, ${DAY('r')} AS day, r.status, r.total_amount, r.amount_paid, c.name AS customer, c.phone
         FROM requests r JOIN customers c ON c.id = r.customer_id
        WHERE ${range('r')} AND r.status <> 'cancelled' AND r.total_amount - r.amount_paid > 0
        ORDER BY r.created_at DESC LIMIT 501`,
      [from, to]
    ),
  ]);

  const byDay = new Map();
  const slot = (d) => {
    if (!byDay.has(d)) byDay.set(d, { day: d, mpesa: 0, mpesa_n: 0, cash: 0, cash_n: 0, orders: 0, unpaid: 0, unpaid_n: 0 });
    return byDay.get(d);
  };
  paid.rows.forEach((r) => Object.assign(slot(r.day), { mpesa: num(r.mpesa), mpesa_n: r.mpesa_n, cash: num(r.cash), cash_n: r.cash_n }));
  unpaid.rows.forEach((r) => Object.assign(slot(r.day), { orders: r.orders, unpaid: num(r.unpaid), unpaid_n: r.unpaid_n }));
  const days = [...byDay.values()].map((d) => ({ ...d, received: d.mpesa + d.cash })).sort((a, b) => (a.day < b.day ? 1 : -1));

  const sum = (k) => days.reduce((t, d) => t + d[k], 0);
  const totals = { mpesa: sum('mpesa'), mpesa_n: sum('mpesa_n'), cash: sum('cash'), cash_n: sum('cash_n'), received: sum('received'), unpaid: sum('unpaid'), unpaid_n: sum('unpaid_n'), orders: sum('orders') };
  return {
    days,
    totals,
    payments: pays.rows.slice(0, 1000),
    paymentsTruncated: pays.rows.length > 1000,
    unpaidOrders: owing.rows.slice(0, 500).map((r) => ({ ...r, balance: Math.max(0, num(r.total_amount) - num(r.amount_paid)) })),
    unpaidTruncated: owing.rows.length > 500,
  };
}

module.exports = { getTakings };
