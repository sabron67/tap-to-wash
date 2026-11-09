const { pool } = require('../config/db');
const { wrap, cleanText, cleanMultiline } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { visibleStatuses } = require('../lib/roles');
const { operationsPage } = require('../views/admin/operations');
const { notifyEvent } = require('../lib/notify');
const { getSettings } = require('../lib/settings');
const { receiptPage } = require('../views/admin/receipt');

// Kept: dispatch, quality control, expenses, stock, complaints and refunds, reviews, discount codes, branches, receipts.
// Removed as unnecessary: garment-level tracking, machines and wash batches, customer packages (subscriptions), loyalty points.

const DISPATCH_STAGES = ['unassigned', 'scheduled', 'picked_up', 'out_for_delivery', 'delivered'];

const num = (v, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : null;
};
const dateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(`${v}:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

module.exports = function mount(router, { buildCtx, flash, need }) {
  const back = (res, hash) => res.redirect('/admin/operations' + (hash ? '#' + hash : ''));

  router.get('/operations', need('operations'), wrap(async (req, res) => {
    const ctx = await buildCtx(req);
    const branchesOn = ctx.settings.branches_enabled === '1';
    const [requests, riders, dispatch, inspections, expenses, inventory, complaints, refunds, discounts, branches, reviews, counts] = await Promise.all([
      pool.query(`SELECT r.id, r.ref_code, c.name AS customer_name FROM requests r JOIN customers c ON c.id = r.customer_id ORDER BY r.created_at DESC LIMIT 250`),
      pool.query(`SELECT id, name, email, phone FROM admins WHERE is_active AND role = 'rider' ORDER BY name`),
      pool.query(`SELECT r.id, r.ref_code, r.status, r.dispatch_stage, r.pickup_scheduled_at, r.delivery_scheduled_at, c.name AS customer_name, a.name AS rider_name, b.name AS branch_name
                    FROM requests r JOIN customers c ON c.id = r.customer_id
                    LEFT JOIN admins a ON a.id = r.rider_admin_id LEFT JOIN branches b ON b.id = r.branch_id
                   WHERE r.rider_admin_id IS NOT NULL OR r.pickup_scheduled_at IS NOT NULL OR r.delivery_scheduled_at IS NOT NULL
                   ORDER BY r.updated_at DESC LIMIT 100`),
      pool.query(`SELECT qi.*, r.ref_code, a.name AS checked_by_name FROM quality_inspections qi JOIN requests r ON r.id = qi.request_id LEFT JOIN admins a ON a.id = qi.checked_by ORDER BY qi.created_at DESC LIMIT 50`),
      pool.query(`SELECT * FROM expenses ORDER BY spent_on DESC, id DESC LIMIT 100`),
      pool.query(`SELECT * FROM inventory_items ORDER BY name`),
      pool.query(`SELECT cc.*, r.ref_code, c.name AS customer_name FROM customer_complaints cc LEFT JOIN requests r ON r.id = cc.request_id LEFT JOIN customers c ON c.id = COALESCE(cc.customer_id, r.customer_id) ORDER BY cc.created_at DESC LIMIT 100`),
      pool.query(`SELECT rf.*, r.ref_code FROM refunds rf JOIN requests r ON r.id = rf.request_id ORDER BY rf.created_at DESC LIMIT 50`),
      pool.query(`SELECT * FROM discounts ORDER BY created_at DESC LIMIT 100`),
      branchesOn ? pool.query(`SELECT b.*, (SELECT COUNT(*)::int FROM requests r WHERE r.branch_id = b.id) AS orders FROM branches b ORDER BY b.name`) : { rows: [] },
      pool.query(`SELECT cr.*, r.ref_code, c.name AS customer_name FROM customer_reviews cr JOIN requests r ON r.id = cr.request_id JOIN customers c ON c.id = cr.customer_id ORDER BY cr.created_at DESC LIMIT 100`),
      pool.query(`SELECT
        (SELECT COUNT(*) FROM customer_complaints WHERE status IN ('open','investigating'))::int AS open_complaints,
        (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE date_trunc('month', spent_on::timestamp) = date_trunc('month', CURRENT_DATE::timestamp)) AS month_expenses,
        (SELECT COALESCE(SUM(amount_paid), 0) FROM requests WHERE date_trunc('month', created_at) = date_trunc('month', now())) AS month_revenue,
        (SELECT COUNT(*) FROM inventory_items WHERE quantity <= reorder_level)::int AS low_stock`),
    ]);
    res.view(operationsPage(ctx, {
      requests: requests.rows, riders: riders.rows, dispatch: dispatch.rows, inspections: inspections.rows, expenses: expenses.rows,
      inventory: inventory.rows, complaints: complaints.rows, refunds: refunds.rows, discounts: discounts.rows,
      branches: branches.rows, branchesOn, reviews: reviews.rows, counts: counts.rows[0],
    }));
  }));

  router.get('/operations/export.csv', need('operations'), wrap(async (req, res) => {
    const exports = {
      expenses: { name: 'expenses', sql: 'SELECT spent_on, category, description, amount FROM expenses ORDER BY spent_on DESC', headers: ['Date', 'Category', 'Description', 'Amount'] },
      inventory: { name: 'inventory', sql: 'SELECT name, unit, quantity, reorder_level, unit_cost FROM inventory_items ORDER BY name', headers: ['Supply', 'Unit', 'Quantity', 'Reorder level', 'Unit cost'] },
      reviews: { name: 'reviews', sql: 'SELECT r.ref_code, c.name, c.phone, cr.rating, cr.comment, cr.created_at FROM customer_reviews cr JOIN requests r ON r.id = cr.request_id JOIN customers c ON c.id = cr.customer_id ORDER BY cr.created_at DESC', headers: ['Order', 'Customer', 'Phone', 'Rating', 'Comment', 'Date'] },
      complaints: { name: 'complaints', sql: 'SELECT cc.subject, cc.details, cc.status, cc.resolution, cc.created_at, c.name, c.phone FROM customer_complaints cc LEFT JOIN customers c ON c.id = cc.customer_id ORDER BY cc.created_at DESC', headers: ['Subject', 'Details', 'Status', 'Resolution', 'Date', 'Customer', 'Phone'] },
    };
    const spec = exports[req.query.type];
    if (!spec) return res.status(400).send('Choose a valid export type.');
    const result = await pool.query({ text: spec.sql, rowMode: 'array' });
    // Neutralise spreadsheet formulas (=, +, -, @) in text so a customer's comment cannot run in Excel.
    const csvCell = (v) => {
      let s = v instanceof Date ? v.toISOString() : String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [spec.headers, ...result.rows].map((row) => row.map(csvCell).join(','));
    await audit(req, 'operations_export', spec.name);
    res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="taptowash-${spec.name}.csv"`).send('﻿' + lines.join('\r\n'));
  }));

  router.get('/requests/:id/receipt', need('billing'), wrap(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.sendStatus(404);
    const [ctx, request, items] = await Promise.all([
      buildCtx(req),
      pool.query(`SELECT r.*, c.name AS customer_name, c.phone AS customer_phone FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1`, [id]),
      pool.query('SELECT i.category_name, i.quantity, i.measured_qty, i.rate, i.line_total, i.unit AS line_unit, c.icon, c.price, c.unit FROM request_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.request_id = $1 ORDER BY i.id', [id]),
    ]);
    if (!request.rows.length) return res.sendStatus(404);
    const vis = visibleStatuses(req.session.admin.role); // null = every status
    if (vis && !vis.includes(request.rows[0].status)) return res.sendStatus(404);
    res.view(receiptPage(ctx, { request: request.rows[0], items: items.rows, backHref: `/admin/requests/${id}`, backLabel: 'Back' }));
  }));

  // ---------- dispatch ----------
  router.post('/operations/dispatch', need('operations'), wrap(async (req, res) => {
    const id = posInt(req.body.request_id);
    const rider = req.body.rider_admin_id ? posInt(req.body.rider_admin_id) : null;
    if (!id) { flash(req, 'error', 'Select a valid request.'); return back(res, 'dispatch'); }
    const stage = cleanText(req.body.dispatch_stage, 30);
    if (!DISPATCH_STAGES.includes(stage)) { flash(req, 'error', 'Select a valid dispatch stage.'); return back(res, 'dispatch'); }
    if (req.body.rider_admin_id && !rider) { flash(req, 'error', 'Select an active rider account.'); return back(res, 'dispatch'); }
    if (rider) {
      const rr = await pool.query(`SELECT id FROM admins WHERE id = $1 AND role = 'rider' AND is_active`, [rider]);
      if (!rr.rowCount) { flash(req, 'error', 'Select an active rider account.'); return back(res, 'dispatch'); }
    }
    // A branch is only applied when multi-branch mode is on and the branch exists; otherwise the request keeps its current branch.
    const settings = await getSettings();
    let branchSql = '';
    const params = [rider, dateOrNull(req.body.pickup_scheduled_at), dateOrNull(req.body.delivery_scheduled_at), stage, id];
    if (settings.branches_enabled === '1' && req.body.branch_id !== undefined) {
      const bid = req.body.branch_id ? posInt(req.body.branch_id) : null;
      if (req.body.branch_id && !bid) { flash(req, 'error', 'Select a valid branch.'); return back(res, 'dispatch'); }
      if (bid) {
        const bb = await pool.query('SELECT id FROM branches WHERE id = $1', [bid]);
        if (!bb.rowCount) { flash(req, 'error', 'Select a valid branch.'); return back(res, 'dispatch'); }
      }
      params.push(bid);
      branchSql = `, branch_id = $${params.length}`;
    }
    const current = await pool.query('SELECT status FROM requests WHERE id = $1', [id]);
    if (!current.rowCount) { flash(req, 'error', 'Request not found.'); return back(res, 'dispatch'); }
    if (stage === 'picked_up' && !['confirmed', 'picked_up'].includes(current.rows[0].status)) { flash(req, 'error', 'A request must be confirmed before pickup.'); return back(res, 'dispatch'); }
    if (['out_for_delivery', 'delivered'].includes(stage) && !['ready', 'delivered'].includes(current.rows[0].status)) { flash(req, 'error', 'A request must pass quality control and be ready before delivery.'); return back(res, 'dispatch'); }
    await pool.query(`UPDATE requests SET rider_admin_id = $1, pickup_scheduled_at = $2, delivery_scheduled_at = $3, dispatch_stage = $4, updated_at = now()${branchSql} WHERE id = $5`, params);
    if (['picked_up', 'delivered'].includes(stage) && current.rows[0].status !== stage) {
      const upd = await pool.query('UPDATE requests SET status = $1, updated_at = now() WHERE id = $2 RETURNING id', [stage, id]);
      if (upd.rowCount) {
        await pool.query(`INSERT INTO request_events(request_id, status, note, created_by) VALUES($1,$2,$3,$4)`, [id, stage, 'Updated from dispatch management', req.session.admin.name]);
        notifyEvent(stage, id, req.session.admin.id, settings.business_name);
      }
    }
    await audit(req, 'dispatch_updated', `Dispatch updated for request #${id}`);
    flash(req, 'success', 'Dispatch details saved.');
    back(res, 'dispatch');
  }));

  // ---------- quality control ----------
  router.post('/operations/quality', need('operations'), wrap(async (req, res) => {
    const id = posInt(req.body.request_id);
    if (!id) { flash(req, 'error', 'Select a request.'); return back(res, 'quality'); }
    const exists = await pool.query('SELECT 1 FROM requests WHERE id = $1', [id]);
    if (!exists.rowCount) { flash(req, 'error', 'Request not found.'); return back(res, 'quality'); }
    const checks = [!!req.body.stain_check, !!req.body.count_check, !!req.body.damage_check, !!req.body.packaging_check];
    if (req.body.passed === '1' && !checks.every(Boolean)) { flash(req, 'error', 'A passed inspection requires all four checks to be completed.'); return back(res, 'quality'); }
    await pool.query(`INSERT INTO quality_inspections(request_id, checked_by, stain_check, count_check, damage_check, packaging_check, passed, notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, req.session.admin.id, ...checks, req.body.passed === '1', cleanMultiline(req.body.notes, 1000)]);
    await audit(req, 'quality_inspection', `Inspection recorded for request #${id}`);
    flash(req, 'success', 'Quality inspection saved.');
    back(res, 'quality');
  }));

  // ---------- expenses and stock ----------
  router.post('/operations/expense', need('operations'), wrap(async (req, res) => {
    const amount = num(req.body.amount, 0);
    const category = cleanText(req.body.category, 60);
    const description = cleanText(req.body.description, 200);
    if (amount === null || amount <= 0 || !category || !description) { flash(req, 'error', 'Enter a valid expense and amount.'); return back(res, 'finance'); }
    await pool.query(`INSERT INTO expenses(category, description, amount, spent_on, recorded_by) VALUES($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5)`, [category, description, amount, req.body.spent_on || null, req.session.admin.id]);
    await audit(req, 'expense_recorded', `${category}: ${amount}`);
    flash(req, 'success', 'Expense recorded.');
    back(res, 'finance');
  }));

  router.post('/operations/inventory', need('operations'), wrap(async (req, res) => {
    const name = cleanText(req.body.name, 100);
    const quantity = num(req.body.quantity, 0);
    const reorder = num(req.body.reorder_level, 0);
    const cost = num(req.body.unit_cost || 0, 0);
    if (!name || quantity === null || reorder === null || cost === null) { flash(req, 'error', 'Enter valid inventory details.'); return back(res, 'inventory'); }
    await pool.query(`INSERT INTO inventory_items(name, unit, quantity, reorder_level, unit_cost) VALUES($1,$2,$3,$4,$5)`, [name, cleanText(req.body.unit, 30) || 'pcs', quantity, reorder, cost]);
    await audit(req, 'inventory_item_added', name);
    flash(req, 'success', 'Supply added.');
    back(res, 'inventory');
  }));

  router.post('/operations/stock', need('operations'), wrap(async (req, res) => {
    const id = posInt(req.body.inventory_item_id);
    const delta = Number(req.body.quantity_change);
    const reason = cleanText(req.body.reason, 200);
    if (!id || !Number.isFinite(delta) || delta === 0 || !reason) { flash(req, 'error', 'Enter a valid stock adjustment and reason.'); return back(res, 'inventory'); }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const u = await client.query('UPDATE inventory_items SET quantity = quantity + $1, updated_at = now() WHERE id = $2 AND quantity + $1 >= 0 RETURNING id', [delta, id]);
      if (!u.rowCount) throw new Error('Stock adjustment would make the quantity negative or the item does not exist.');
      await client.query(`INSERT INTO inventory_movements(inventory_item_id, quantity_change, reason, recorded_by) VALUES($1,$2,$3,$4)`, [id, delta, reason, req.session.admin.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      flash(req, 'error', e.message);
      return back(res, 'inventory');
    } finally {
      client.release();
    }
    await audit(req, 'stock_adjusted', `Inventory #${id}: ${delta}`);
    flash(req, 'success', 'Stock updated.');
    back(res, 'inventory');
  }));

  // ---------- customer care ----------
  router.post('/operations/complaint', need('operations'), wrap(async (req, res) => {
    const subject = cleanText(req.body.subject, 120);
    if (!subject) { flash(req, 'error', 'Complaint subject is required.'); return back(res, 'customers'); }
    const rid = req.body.request_id ? posInt(req.body.request_id) : null;
    await pool.query(`INSERT INTO customer_complaints(request_id, customer_id, subject, details) VALUES($1, (SELECT customer_id FROM requests WHERE id = $1), $2, $3)`, [rid, subject, cleanMultiline(req.body.details, 2000)]);
    await audit(req, 'complaint_logged', subject);
    flash(req, 'success', 'Complaint logged.');
    back(res, 'customers');
  }));

  router.post('/operations/complaint-status', need('operations'), wrap(async (req, res) => {
    const id = posInt(req.body.id);
    const status = cleanText(req.body.status, 20);
    if (!id || !['open', 'investigating', 'resolved', 'closed'].includes(status)) { flash(req, 'error', 'Invalid complaint update.'); return back(res, 'customers'); }
    await pool.query('UPDATE customer_complaints SET status = $1, resolution = $2, updated_at = now() WHERE id = $3', [status, cleanMultiline(req.body.resolution, 500), id]);
    await audit(req, 'complaint_status', `Complaint #${id}: ${status}`);
    flash(req, 'success', 'Complaint updated.');
    back(res, 'customers');
  }));

  router.post('/operations/refund', need('operations'), wrap(async (req, res) => {
    const id = posInt(req.body.request_id);
    const amount = num(req.body.amount, 0);
    const reason = cleanText(req.body.reason, 250);
    if (!id || amount === null || amount <= 0 || !reason) { flash(req, 'error', 'Enter a valid refund request.'); return back(res, 'customers'); }
    const exists = await pool.query('SELECT 1 FROM requests WHERE id = $1', [id]);
    if (!exists.rowCount) { flash(req, 'error', 'Request not found.'); return back(res, 'customers'); }
    await pool.query(`INSERT INTO refunds(request_id, amount, reason, recorded_by) VALUES($1,$2,$3,$4)`, [id, amount, reason, req.session.admin.id]);
    await audit(req, 'refund_requested', `Request #${id}: ${amount}`);
    flash(req, 'success', 'Refund submitted for approval.');
    back(res, 'customers');
  }));

  router.post('/operations/refund-status', need('operations'), wrap(async (req, res) => {
    const id = posInt(req.body.id);
    const status = cleanText(req.body.status, 20);
    if (!id || !['pending', 'approved', 'rejected', 'paid'].includes(status)) { flash(req, 'error', 'Invalid refund status.'); return back(res, 'customers'); }
    await pool.query('UPDATE refunds SET status = $1 WHERE id = $2', [status, id]);
    await audit(req, 'refund_status', `Refund #${id}: ${status}`);
    flash(req, 'success', 'Refund status updated.');
    back(res, 'customers');
  }));

  // ---------- discount codes ----------
  router.post('/operations/discount', need('operations'), wrap(async (req, res) => {
    const code = cleanText(req.body.code, 40).toUpperCase();
    const value = num(req.body.value, 0);
    const type = req.body.discount_type;
    const min = Math.max(1, Math.floor(Number(req.body.min_orders)) || 1);
    if (!code || value === null || value <= 0 || !['percent', 'fixed'].includes(type) || (type === 'percent' && value > 100)) {
      flash(req, 'error', 'Enter a valid discount. Percentage discounts cannot exceed 100%.');
      return back(res, 'growth');
    }
    try {
      await pool.query(`INSERT INTO discounts(code, description, discount_type, value, min_orders, ends_at, max_uses) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [code, cleanText(req.body.description, 200), type, value, min, req.body.ends_at || null, req.body.max_uses ? Math.max(1, Math.floor(Number(req.body.max_uses)) || 1) : null]);
    } catch (e) {
      if (e.code === '23505') { flash(req, 'error', 'That discount code already exists.'); return back(res, 'growth'); }
      throw e;
    }
    await audit(req, 'discount_created', code);
    flash(req, 'success', 'Discount code created.');
    back(res, 'growth');
  }));

  router.post('/operations/discount-status', need('operations'), wrap(async (req, res) => {
    const id = posInt(req.body.id);
    if (!id) { flash(req, 'error', 'Invalid discount.'); return back(res, 'growth'); }
    const on = req.body.active === '1';
    await pool.query('UPDATE discounts SET is_active = $1 WHERE id = $2', [on, id]);
    await audit(req, 'discount_status', `Discount #${id}: ${on ? 'active' : 'inactive'}`);
    flash(req, 'success', on ? 'Discount activated.' : 'Discount switched off.');
    back(res, 'growth');
  }));

  // ---------- branches (visible only while multi-branch mode is on in Settings) ----------
  router.post('/operations/branch', need('operations'), wrap(async (req, res) => {
    const name = cleanText(req.body.name, 100);
    if (!name) { flash(req, 'error', 'Branch name is required.'); return back(res, 'branches'); }
    await pool.query('INSERT INTO branches(name, phone, address) VALUES($1,$2,$3)', [name, cleanText(req.body.phone, 30), cleanText(req.body.address, 200)]);
    await audit(req, 'branch_created', name);
    flash(req, 'success', 'Branch added.');
    back(res, 'branches');
  }));

  router.post('/operations/branch-status', need('operations'), wrap(async (req, res) => {
    const id = posInt(req.body.id);
    if (!id) { flash(req, 'error', 'Invalid branch.'); return back(res, 'branches'); }
    const on = req.body.active === '1';
    await pool.query('UPDATE branches SET is_active = $1 WHERE id = $2', [on, id]);
    await audit(req, 'branch_status', `Branch #${id}: ${on ? 'active' : 'inactive'}`);
    flash(req, 'success', on ? 'Branch activated. Customers can now choose it.' : 'Branch deactivated. Customers can no longer choose it.');
    back(res, 'branches');
  }));
};
