// Inventory, supply costs and profit. Owner and manager only: every route here needs the 'inventory' permission,
// which lib/roles.js gives to the owner (everything) and the manager, and to nobody else.
const { pool } = require('../config/db');
const { wrap, cleanText } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { inventoryPage } = require('../views/admin/inventory');
const { getSettings } = require('../lib/settings');
const { sendWorkbook } = require('../lib/xlsx-export');
const { stockSheet, movementsSheet, profitSheet } = require('../lib/export-sheets');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const validYmd = (s) => YMD.test(s || '') && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const num = (v, min = 0) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : null;
};
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const round2 = (n) => Math.round(n * 100) / 100;

// Same Nairobi-day range the Reports page uses, so profit here matches the rest of the system.
const REQ_RANGE = `created_at >= ($1::date)::timestamp AT TIME ZONE 'Africa/Nairobi' AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')`;

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

module.exports = function mount(router, { buildCtx, flash, need }) {
  const back = (res, hash, qs = '') => res.redirect('/admin/inventory' + qs + (hash ? '#' + hash : ''));
  const keepRange = (req) => {
    const f = req.body.from, t = req.body.to;
    return validYmd(f) && validYmd(t) ? `?from=${f}&to=${t}` : '';
  };

  router.get('/inventory', need('inventory'), wrap(async (req, res) => {
    const { from, to, today } = await resolveRange(req.query);
    const ctx = await buildCtx(req);
    const [items, moves, byItem, profit] = await Promise.all([
      pool.query(`SELECT *, (quantity * unit_cost) AS value FROM inventory_items ORDER BY is_active DESC, name`),
      pool.query(
        `SELECT m.*, i.name AS item_name, i.unit, a.name AS by_name
           FROM inventory_movements m JOIN inventory_items i ON i.id = m.inventory_item_id LEFT JOIN admins a ON a.id = m.recorded_by
          WHERE m.occurred_on BETWEEN $1::date AND $2::date ORDER BY m.occurred_on DESC, m.id DESC LIMIT 300`,
        [from, to]
      ),
      pool.query(
        `SELECT i.name, i.unit,
                COALESCE(SUM(-m.quantity_change) FILTER (WHERE m.kind IN ('usage','waste')), 0) AS qty_out,
                COALESCE(SUM(-m.quantity_change * m.unit_cost) FILTER (WHERE m.kind IN ('usage','waste','adjustment')), 0) AS cost
           FROM inventory_items i JOIN inventory_movements m ON m.inventory_item_id = i.id
          WHERE m.occurred_on BETWEEN $1::date AND $2::date AND m.kind IN ('usage','waste','adjustment')
          GROUP BY i.id HAVING SUM(-m.quantity_change * m.unit_cost) <> 0 ORDER BY cost DESC`,
        [from, to]
      ),
      profitFor(from, to),
    ]);
    const stockValue = items.rows.filter((x) => x.is_active).reduce((a, x) => a + Number(x.value), 0);
    const low = items.rows.filter((x) => x.is_active && Number(x.quantity) <= Number(x.reorder_level));
    res.view(inventoryPage(ctx, { from, to, today, presets: presets(today), items: items.rows, moves: moves.rows, byItem: byItem.rows, profit, stockValue, low }));
  }));

  // ---------- items ----------
  router.post('/inventory/item', need('inventory'), wrap(async (req, res) => {
    const name = cleanText(req.body.name, 100);
    const unit = cleanText(req.body.unit, 30) || 'pcs';
    const category = cleanText(req.body.category, 60) || 'General';
    const supplier = cleanText(req.body.supplier, 100);
    const qty = num(req.body.quantity, 0) ?? 0;
    const reorder = num(req.body.reorder_level, 0) ?? 0;
    const cost = num(req.body.unit_cost, 0) ?? 0;
    if (!name) { flash(req, 'error', 'Enter the supply name.'); return back(res, 'items', keepRange(req)); }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const dup = await client.query('SELECT 1 FROM inventory_items WHERE lower(name) = lower($1)', [name]);
      if (dup.rowCount) throw new Error('A supply with that name already exists.');
      const ins = await client.query(
        `INSERT INTO inventory_items(name, unit, quantity, reorder_level, unit_cost, category, supplier) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [name, unit, qty, reorder, cost, category, supplier]
      );
      if (qty > 0) {
        await client.query(
          `INSERT INTO inventory_movements(inventory_item_id, quantity_change, reason, kind, unit_cost, supplier, recorded_by, occurred_on)
           VALUES($1,$2,'Opening stock','opening',$3,$4,$5,(now() AT TIME ZONE 'Africa/Nairobi')::date)`,
          [ins.rows[0].id, qty, cost, supplier, req.session.admin.id]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      flash(req, 'error', e.message);
      return back(res, 'items', keepRange(req));
    } finally {
      client.release();
    }
    await audit(req, 'inventory_item_added', name);
    flash(req, 'success', 'Supply added.');
    back(res, 'items', keepRange(req));
  }));

  router.post('/inventory/item/update', need('inventory'), wrap(async (req, res) => {
    const id = posInt(req.body.id);
    const name = cleanText(req.body.name, 100);
    const reorder = num(req.body.reorder_level, 0);
    const cost = num(req.body.unit_cost, 0);
    if (!id || !name || reorder === null || cost === null) { flash(req, 'error', 'Enter valid supply details.'); return back(res, 'items', keepRange(req)); }
    try {
      const u = await pool.query(
        `UPDATE inventory_items SET name=$1, unit=$2, category=$3, supplier=$4, reorder_level=$5, unit_cost=$6, is_active=$7, updated_at=now() WHERE id=$8 RETURNING id`,
        [name, cleanText(req.body.unit, 30) || 'pcs', cleanText(req.body.category, 60) || 'General', cleanText(req.body.supplier, 100), reorder, cost, req.body.is_active === '1', id]
      );
      if (!u.rowCount) { flash(req, 'error', 'That supply no longer exists.'); return back(res, 'items', keepRange(req)); }
    } catch (e) {
      flash(req, 'error', 'Could not save the supply.');
      return back(res, 'items', keepRange(req));
    }
    await audit(req, 'inventory_item_edited', `#${id} ${name} (cost ${cost}, ${req.body.is_active === '1' ? 'active' : 'inactive'})`);
    flash(req, 'success', 'Supply updated.');
    back(res, 'items', keepRange(req));
  }));

  // ---------- stock movements (one transaction each, row locked so two people cannot oversell the same stock) ----------
  async function move(req, res, hash, work) {
    const client = await pool.connect();
    let note = '';
    try {
      await client.query('BEGIN');
      note = await work(client);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      flash(req, 'error', e.userMessage || 'Could not save that. Nothing was changed.');
      return back(res, hash, keepRange(req));
    } finally {
      client.release();
    }
    flash(req, 'success', note);
    back(res, hash, keepRange(req));
  }
  const fail = (msg) => Object.assign(new Error(msg), { userMessage: msg });
  const lockItem = async (client, id) => {
    const r = await client.query('SELECT * FROM inventory_items WHERE id = $1 AND is_active FOR UPDATE', [id]);
    if (!r.rowCount) throw fail('Choose an active supply.');
    return r.rows[0];
  };
  const dateOf = (v) => (validYmd(v) ? v : null);

  // Stock bought. Cost is the TOTAL paid, so the system works out the unit cost and updates the average cost.
  router.post('/inventory/purchase', need('inventory'), wrap(async (req, res) => {
    const id = posInt(req.body.inventory_item_id);
    const qty = num(req.body.quantity, 0);
    const total = num(req.body.total_cost, 0);
    if (!id || !qty || qty <= 0 || total === null) { flash(req, 'error', 'Choose a supply, then enter the quantity and the total cost paid.'); return back(res, 'receive', keepRange(req)); }
    await move(req, res, 'receive', async (client) => {
      const it = await lockItem(client, id);
      const unitCost = total / qty;
      const newQty = Number(it.quantity) + qty;
      const avg = newQty > 0 ? (Number(it.quantity) * Number(it.unit_cost) + total) / newQty : unitCost;
      await client.query('UPDATE inventory_items SET quantity = $1, unit_cost = $2, updated_at = now() WHERE id = $3', [newQty, avg.toFixed(4), id]);
      await client.query(
        `INSERT INTO inventory_movements(inventory_item_id, quantity_change, reason, kind, unit_cost, supplier, reference, recorded_by, occurred_on)
         VALUES($1,$2,$3,'purchase',$4,$5,$6,$7,COALESCE($8::date,(now() AT TIME ZONE 'Africa/Nairobi')::date))`,
        [id, qty, cleanText(req.body.reason, 200) || 'Stock purchased', unitCost.toFixed(4), cleanText(req.body.supplier, 100) || it.supplier, cleanText(req.body.reference, 80), req.session.admin.id, dateOf(req.body.occurred_on)]
      );
      await audit(req, 'stock_purchased', `${it.name}: +${qty} for ${round2(total)}`);
      return `Stock received: ${it.name} +${qty} ${it.unit}.`;
    });
  }));

  // Stock used up or thrown away. Valued at the current average cost, and counted as a cost in the profit figures.
  router.post('/inventory/use', need('inventory'), wrap(async (req, res) => {
    const id = posInt(req.body.inventory_item_id);
    const qty = num(req.body.quantity, 0);
    const kind = req.body.kind === 'waste' ? 'waste' : 'usage';
    if (!id || !qty || qty <= 0) { flash(req, 'error', 'Choose a supply and enter the quantity used.'); return back(res, 'use', keepRange(req)); }
    await move(req, res, 'use', async (client) => {
      const it = await lockItem(client, id);
      if (Number(it.quantity) < qty) throw fail(`Only ${it.quantity} ${it.unit} of ${it.name} in stock.`);
      await client.query('UPDATE inventory_items SET quantity = quantity - $1, updated_at = now() WHERE id = $2', [qty, id]);
      await client.query(
        `INSERT INTO inventory_movements(inventory_item_id, quantity_change, reason, kind, unit_cost, recorded_by, occurred_on)
         VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::date,(now() AT TIME ZONE 'Africa/Nairobi')::date))`,
        [id, -qty, cleanText(req.body.reason, 200) || (kind === 'waste' ? 'Damaged / lost' : 'Used in washing'), kind, it.unit_cost, req.session.admin.id, dateOf(req.body.occurred_on)]
      );
      await audit(req, kind === 'waste' ? 'stock_wasted' : 'stock_used', `${it.name}: -${qty}`);
      return `Recorded: ${it.name} -${qty} ${it.unit}.`;
    });
  }));

  // Stock count: type what is really on the shelf; the difference is booked as an adjustment.
  router.post('/inventory/count', need('inventory'), wrap(async (req, res) => {
    const id = posInt(req.body.inventory_item_id);
    const counted = num(req.body.counted, 0);
    const reason = cleanText(req.body.reason, 200);
    if (!id || counted === null || !reason) { flash(req, 'error', 'Choose a supply, enter the counted quantity and a reason.'); return back(res, 'use', keepRange(req)); }
    await move(req, res, 'use', async (client) => {
      const it = await lockItem(client, id);
      const diff = round2(counted - Number(it.quantity));
      if (diff === 0) throw fail('The counted quantity matches the system, so nothing was changed.');
      await client.query('UPDATE inventory_items SET quantity = $1, updated_at = now() WHERE id = $2', [counted, id]);
      await client.query(
        `INSERT INTO inventory_movements(inventory_item_id, quantity_change, reason, kind, unit_cost, recorded_by, occurred_on)
         VALUES($1,$2,$3,'adjustment',$4,$5,(now() AT TIME ZONE 'Africa/Nairobi')::date)`,
        [id, diff, `Stock count: ${reason}`, it.unit_cost, req.session.admin.id]
      );
      await audit(req, 'stock_counted', `${it.name}: ${Number(it.quantity)} -> ${counted}`);
      return `Stock count saved: ${it.name} is now ${counted} ${it.unit}.`;
    });
  }));

  // ---------- Excel exports (also owner and manager only) ----------
  const movementRows = async (from, to) =>
    (await pool.query(
      `SELECT to_char(m.occurred_on, 'YYYY-MM-DD') AS day, i.name AS item_name, m.kind, m.quantity_change, i.unit, m.unit_cost, m.supplier, m.reference, m.reason, a.name AS by_name
         FROM inventory_movements m JOIN inventory_items i ON i.id = m.inventory_item_id LEFT JOIN admins a ON a.id = m.recorded_by
        WHERE m.occurred_on BETWEEN $1::date AND $2::date ORDER BY m.occurred_on, m.id`,
      [from, to]
    )).rows;
  const stockRows = async () => (await pool.query('SELECT name, category, unit, quantity, reorder_level, unit_cost, supplier, is_active FROM inventory_items ORDER BY name')).rows;

  router.get('/inventory/export.xlsx', need('inventory'), wrap(async (req, res) => {
    const { from, to } = await resolveRange(req.query);
    const type = req.query.type;
    if (!['stock', 'movements', 'profit'].includes(type)) return res.status(400).send('Choose a valid export type.');
    const cur = (await getSettings()).currency;
    let book, file;
    if (type === 'stock') {
      book = { title: 'Stock list', sheets: [stockSheet(await stockRows(), cur)] };
      file = 'taptowash-stock-list.xlsx';
    } else if (type === 'movements') {
      book = { title: 'Stock movements', sheets: [movementsSheet(await movementRows(from, to), from, to, cur)] };
      file = `taptowash-stock-movements-${from}-to-${to}.xlsx`;
    } else {
      const [p, moves, stock] = await Promise.all([profitFor(from, to), movementRows(from, to), stockRows()]);
      book = {
        title: 'Profit summary',
        sheets: [profitSheet(p, { from, to, cur, nMoves: moves.length, nStock: stock.length }), movementsSheet(moves, from, to, cur), stockSheet(stock, cur)],
      };
      file = `taptowash-profit-${from}-to-${to}.xlsx`;
    }
    await audit(req, 'inventory_export', `${type} ${from} to ${to}`);
    await sendWorkbook(res, file, book);
  }));
};
