const { pool } = require('../config/db');
const { wrap, cleanText, cleanMultiline, backwardBlocker } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { visibleStatuses, riderMayView } = require('../lib/roles');
const { operationsPage } = require('../views/admin/operations');
const { notifyEvent } = require('../lib/notify');
const { getSettings } = require('../lib/settings');
const { receiptPage } = require('../views/admin/receipt');
const { pickupBlocker, autoBill } = require('../lib/bill');
const { generateCode } = require('../lib/promo');
const { sendWorkbook } = require('../lib/xlsx-export');
const { expenseSheets, reviewsSheet, complaintsSheet } = require('../lib/export-sheets');

// Kept: dispatch, quality control, expenses, complaints and refunds, reviews, promotions, branches, receipts.
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
    const [requests, riders, dispatch, inspections, expenses, complaints, refunds, branches, reviews, counts, promotions] = await Promise.all([
      pool.query(`SELECT r.id, r.ref_code, c.name AS customer_name FROM requests r JOIN customers c ON c.id = r.customer_id ORDER BY r.created_at DESC LIMIT 250`),
      pool.query(`SELECT id, name, email, phone FROM admins WHERE is_active AND role = 'rider' ORDER BY name`),
      pool.query(`SELECT r.id, r.ref_code, r.status, r.dispatch_stage, r.pickup_scheduled_at, r.delivery_scheduled_at, c.name AS customer_name, a.name AS rider_name, b.name AS branch_name
                    FROM requests r JOIN customers c ON c.id = r.customer_id
                    LEFT JOIN admins a ON a.id = r.rider_admin_id LEFT JOIN branches b ON b.id = r.branch_id
                   WHERE r.rider_admin_id IS NOT NULL OR r.pickup_scheduled_at IS NOT NULL OR r.delivery_scheduled_at IS NOT NULL
                   ORDER BY r.updated_at DESC LIMIT 100`),
      pool.query(`SELECT qi.*, r.ref_code, a.name AS checked_by_name FROM quality_inspections qi JOIN requests r ON r.id = qi.request_id LEFT JOIN admins a ON a.id = qi.checked_by ORDER BY qi.created_at DESC LIMIT 50`),
      pool.query(`SELECT * FROM expenses ORDER BY spent_on DESC, id DESC LIMIT 100`),
      pool.query(`SELECT cc.*, r.ref_code, c.name AS customer_name FROM customer_complaints cc LEFT JOIN requests r ON r.id = cc.request_id LEFT JOIN customers c ON c.id = COALESCE(cc.customer_id, r.customer_id) ORDER BY cc.created_at DESC LIMIT 100`),
      pool.query(`SELECT rf.*, r.ref_code FROM refunds rf JOIN requests r ON r.id = rf.request_id ORDER BY rf.created_at DESC LIMIT 50`),
      branchesOn ? pool.query(`SELECT b.*, (SELECT COUNT(*)::int FROM requests r WHERE r.branch_id = b.id) AS orders FROM branches b ORDER BY b.name`) : { rows: [] },
      pool.query(`SELECT cr.*, r.ref_code, c.name AS customer_name FROM customer_reviews cr JOIN requests r ON r.id = cr.request_id JOIN customers c ON c.id = cr.customer_id ORDER BY cr.created_at DESC LIMIT 100`),
      pool.query(`SELECT
        (SELECT COUNT(*) FROM customer_complaints WHERE status IN ('open','investigating'))::int AS open_complaints,
        (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE date_trunc('month', spent_on::timestamp) = date_trunc('month', CURRENT_DATE::timestamp)) AS month_expenses,
        ((SELECT COALESCE(SUM(amount_paid), 0) FROM requests WHERE date_trunc('month', created_at) = date_trunc('month', now())) + (SELECT COALESCE(SUM(amount_paid), 0) FROM deleted_requests WHERE date_trunc('month', created_at) = date_trunc('month', now()))) AS month_revenue,
        (SELECT COUNT(*) FROM inventory_items WHERE is_active AND quantity <= reorder_level)::int AS low_stock`),
      pool.query(`SELECT p.*, to_char(p.starts_at AT TIME ZONE 'Africa/Nairobi', 'DD Mon YYYY HH24:MI') AS starts_txt, to_char(p.ends_at AT TIME ZONE 'Africa/Nairobi', 'DD Mon YYYY HH24:MI') AS ends_txt,
                         CASE WHEN now() < p.starts_at THEN 'scheduled' WHEN now() > p.ends_at THEN 'ended' ELSE 'live' END AS state,
                         (SELECT COUNT(*)::int FROM requests r WHERE r.discount_code = p.code) AS orders,
                         (SELECT COALESCE(SUM(r.discount_amount), 0) FROM requests r WHERE r.discount_code = p.code) AS given
                    FROM promotions p ORDER BY p.starts_at DESC LIMIT 50`),
    ]);
    res.view(operationsPage(ctx, {
      requests: requests.rows, riders: riders.rows, dispatch: dispatch.rows, inspections: inspections.rows, expenses: expenses.rows,
      complaints: complaints.rows, refunds: refunds.rows,
      branches: branches.rows, branchesOn, reviews: reviews.rows, counts: counts.rows[0], promotions: promotions.rows,
    }));
  }));

  router.get('/operations/export.xlsx', need('operations'), wrap(async (req, res) => {
    const day = (col) => `to_char((${col} AT TIME ZONE 'Africa/Nairobi')::date, 'YYYY-MM-DD')`;
    const type = req.query.type;
    let book, file;
    if (type === 'expenses') {
      const r = await pool.query(`SELECT to_char(spent_on, 'YYYY-MM-DD') AS day, category, description, amount FROM expenses ORDER BY spent_on DESC, id DESC`);
      book = { title: 'Expenses', sheets: expenseSheets(r.rows, (await getSettings()).currency) };
      file = 'taptowash-expenses.xlsx';
    } else if (type === 'reviews') {
      const r = await pool.query(`SELECT r.ref_code, c.name, c.phone, cr.rating, cr.comment, ${day('cr.created_at')} AS day FROM customer_reviews cr JOIN requests r ON r.id = cr.request_id JOIN customers c ON c.id = cr.customer_id ORDER BY cr.created_at DESC`);
      book = { title: 'Customer reviews', sheets: [reviewsSheet(r.rows)] };
      file = 'taptowash-reviews.xlsx';
    } else if (type === 'complaints') {
      const r = await pool.query(`SELECT cc.subject, cc.details, cc.status, cc.resolution, ${day('cc.created_at')} AS day, c.name, c.phone FROM customer_complaints cc LEFT JOIN customers c ON c.id = cc.customer_id ORDER BY cc.created_at DESC`);
      book = { title: 'Customer complaints', sheets: [complaintsSheet(r.rows)] };
      file = 'taptowash-complaints.xlsx';
    } else return res.status(400).send('Choose a valid export type.');
    await audit(req, 'operations_export', type);
    await sendWorkbook(res, file, book);
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
    if ((vis && !vis.includes(request.rows[0].status)) || !riderMayView(req.session.admin, request.rows[0])) return res.sendStatus(404);
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
    const bwd = backwardBlocker(current.rows[0].status, stage);
    if (bwd && ['picked_up', 'delivered'].includes(stage)) { flash(req, 'error', bwd); return back(res, 'dispatch'); }
    if (stage === 'picked_up' && !['rider_arrived', 'picked_up'].includes(current.rows[0].status)) { flash(req, 'error', 'The rider must arrive at the customer first. Mark “Rider arrived” on the request, then weigh, confirm and pay before pick-up.'); return back(res, 'dispatch'); }
    // Same rule as the status buttons: per-kg laundry must be weighed and confirmed by the customer, and payment received
    // (or pay later approved), before pick-up. Orders with no per-kg service are billed automatically once confirmed.
    if (stage === 'picked_up' && current.rows[0].status === 'rider_arrived') {
      await autoBill(pool, id);
      const bill = await pool.query('SELECT status, bill_status, total_amount, amount_paid, pay_later FROM requests WHERE id = $1', [id]);
      const why = pickupBlocker(bill.rows[0], (await getSettings()).pay_before_cleaning !== '0');
      if (why) { flash(req, 'error', why); return back(res, 'dispatch'); }
    }
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

  // ---------- expenses (stock and supply costs now live in routes/admin-inventory.js, owner and manager only) ----------
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

  // ---------- promotions (popup ad + automatic discount for requests made while it runs) ----------
  router.post('/operations/promotion', need('operations'), wrap(async (req, res) => {
    const title = cleanText(req.body.title, 80);
    const message = cleanMultiline(req.body.message, 300);
    const type = req.body.discount_type;
    const value = num(req.body.value, 0);
    const starts = dateOrNull(req.body.starts_at);
    const ends = dateOrNull(req.body.ends_at);
    if (title.length < 3 || !['percent', 'fixed'].includes(type) || value === null || value <= 0 || (type === 'percent' && value > 100)) {
      flash(req, 'error', 'Enter a title and a valid discount. Percentage discounts cannot exceed 100%.');
      return back(res, 'promos');
    }
    if (!starts || !ends || ends <= starts) {
      flash(req, 'error', 'Choose a start and an end time, with the end after the start.');
      return back(res, 'promos');
    }
    let code = '';
    for (let i = 0; i < 5 && !code; i++) {
      const candidate = generateCode();
      try {
        await pool.query(`INSERT INTO promotions(title, message, code, discount_type, value, starts_at, ends_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [title, message, candidate, type, value, starts, ends]);
        code = candidate;
      } catch (e) {
        if (e.code !== '23505') throw e; // code clash: generate another
      }
    }
    if (!code) { flash(req, 'error', 'Could not generate a promotion code. Please try again.'); return back(res, 'promos'); }
    await audit(req, 'promotion_created', `${title} (${code})`);
    flash(req, 'success', `Promotion created. Code ${code} is applied automatically to requests made during it.`);
    back(res, 'promos');
  }));

  // End now: the popup stops and no new request gets the discount. Requests already made keep theirs.
  router.post('/operations/promotion-end', need('operations'), wrap(async (req, res) => {
    const id = posInt(req.body.id);
    if (!id) { flash(req, 'error', 'Invalid promotion.'); return back(res, 'promos'); }
    await pool.query('UPDATE promotions SET ends_at = GREATEST(now(), starts_at + interval \'1 second\') WHERE id = $1 AND ends_at > now()', [id]);
    await audit(req, 'promotion_ended', `Promotion #${id}`);
    flash(req, 'success', 'Promotion ended.');
    back(res, 'promos');
  }));

  router.post('/operations/promotion-delete', need('operations'), wrap(async (req, res) => {
    const id = posInt(req.body.id);
    if (!id) { flash(req, 'error', 'Invalid promotion.'); return back(res, 'promos'); }
    const used = await pool.query('SELECT 1 FROM requests r JOIN promotions p ON p.code = r.discount_code WHERE p.id = $1 LIMIT 1', [id]);
    if (used.rowCount) { flash(req, 'error', 'Requests already received this discount, so it cannot be deleted. Use End now instead.'); return back(res, 'promos'); }
    await pool.query('DELETE FROM promotions WHERE id = $1', [id]);
    await audit(req, 'promotion_deleted', `Promotion #${id}`);
    flash(req, 'success', 'Promotion deleted.');
    back(res, 'promos');
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
