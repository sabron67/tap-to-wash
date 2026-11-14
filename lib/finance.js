// Shared by Reports and Inventory so both pages show the same numbers for the same period.
const { pool } = require('../config/db');

// Same Nairobi-day range the Reports page uses, so profit here matches the rest of the system.
const REQ_RANGE = `created_at >= ($1::date)::timestamp AT TIME ZONE 'Africa/Nairobi' AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')`;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const validYmd = (s) => YMD.test(s || '') && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function todayNairobi() {
  const { rows } = await pool.query(`SELECT to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS d`);
  return rows[0].d;
}

function presets(today) {
  const m = today.slice(0, 7);
  const firstThis = `${m}-01`;
  const lastPrev = addDays(firstThis, -1);
  return [
    ['This month', firstThis, today],
    ['Last month', `${lastPrev.slice(0, 7)}-01`, lastPrev],
    ['Last 30 days', addDays(today, -29), today],
    ['This year', `${today.slice(0, 4)}-01-01`, today],
  ];
}

async function resolveRange(query) {
  const today = await todayNairobi();
  let from = validYmd(query.from) ? query.from : `${today.slice(0, 7)}-01`;
  let to = validYmd(query.to) ? query.to : today;
  if (from > to) [from, to] = [to, from];
  return { from, to, today };
}

// Profit for a period. Supplies are counted when they are USED (not when bought), so buying stock never looks like a loss.
async function profitFor(from, to) {
  const [rev, del, refunds, exp, moves] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(amount_paid), 0) AS v FROM requests WHERE ${REQ_RANGE}`, [from, to]),
    pool.query(`SELECT COALESCE(SUM(amount_paid), 0) AS v FROM deleted_requests WHERE ${REQ_RANGE}`, [from, to]),
    pool.query(`SELECT COALESCE(SUM(amount), 0) AS v FROM refunds WHERE status = 'paid' AND ${REQ_RANGE}`, [from, to]),
    pool.query(`SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE spent_on BETWEEN $1::date AND $2::date`, [from, to]),
    pool.query(
      `SELECT
         COALESCE(SUM(-quantity_change * unit_cost) FILTER (WHERE kind = 'usage'), 0)      AS used,
         COALESCE(SUM(-quantity_change * unit_cost) FILTER (WHERE kind = 'waste'), 0)      AS waste,
         COALESCE(SUM(-quantity_change * unit_cost) FILTER (WHERE kind = 'adjustment'), 0) AS adjust,
         COALESCE(SUM(quantity_change * unit_cost)  FILTER (WHERE kind = 'purchase'), 0)   AS purchases
       FROM inventory_movements WHERE occurred_on BETWEEN $1::date AND $2::date`,
      [from, to]
    ),
  ]);
  const revenue = Number(rev.rows[0].v) + Number(del.rows[0].v);
  const m = moves.rows[0];
  const used = Number(m.used), waste = Number(m.waste), adjust = Number(m.adjust), purchases = Number(m.purchases);
  const refundsPaid = Number(refunds.rows[0].v);
  const expenses = Number(exp.rows[0].v);
  const suppliesCost = used + waste + adjust;
  const gross = revenue - refundsPaid - suppliesCost;
  const net = gross - expenses;
  return {
    revenue, refundsPaid, used, waste, adjust, suppliesCost, gross, expenses, net, purchases,
    margin: revenue > 0 ? (net / revenue) * 100 : null,
  };
}


// One-line business snapshot for the linked Reports / Inventory header (billed and outstanding come from Reports, stock from Inventory).
async function snapshot(from, to) {
  const [profit, stock, bill] = await Promise.all([
    profitFor(from, to),
    pool.query(`SELECT COALESCE(SUM(quantity * unit_cost) FILTER (WHERE is_active), 0) AS value,
                       COUNT(*) FILTER (WHERE is_active AND quantity <= reorder_level)::int AS low
                  FROM inventory_items`),
    pool.query(`SELECT COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)) FILTER (WHERE status <> 'cancelled'), 0) AS outstanding
                  FROM requests WHERE ${REQ_RANGE}`, [from, to]),
  ]);
  return { ...profit, stockValue: Number(stock.rows[0].value), lowCount: stock.rows[0].low, outstanding: Number(bill.rows[0].outstanding) };
}

module.exports = { REQ_RANGE, todayNairobi, presets, resolveRange, profitFor, snapshot, validYmd, addDays };
