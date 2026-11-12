// Weigh -> bill -> customer confirms -> payment (stage 1). Mounted from routes/admin.js, so every route here is
// already behind the sign-in check. Each handler also applies its own permission and, for rider/attendant roles,
// the "only your stages" rule.
const { pool } = require('../config/db');
const { wrap, cleanText, cleanMultiline, money } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { can, visibleStatuses } = require('../lib/roles');
const { getSettings } = require('../lib/settings');
const { notifyEvent, eventFor } = require('../lib/notify');
const { round2, parseMeasurements, computeLines, discountFor, MPESA_CODE, cleanMpesaCode, loadBillData, needsWeighing, autoBill, advanceIfPaid } = require('../lib/bill');

const OPEN_BILL = ['none', 'needs_price', 'awaiting_confirm', 'disputed']; // can still be weighed / repriced
const POST_CONFIRM_STATUSES = ['confirmed', 'rider_arrived', 'picked_up', 'washing', 'ready']; // managers may re-weigh in these

module.exports = function mountBilling(router, { flash, need }) {
  const back = (res, id) => res.redirect(`/admin/requests/${id}`);

  // The request, if this person is allowed to touch it (stage rule for rider / attendant).
  async function mine(req, id, db = pool, lock = false) {
    if (!Number.isInteger(id)) return null;
    const { rows } = await db.query(
      `SELECT r.*, c.name AS customer_name FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1 ${lock ? 'FOR UPDATE OF r' : ''}`,
      [id]
    );
    if (!rows.length) return null;
    const vis = visibleStatuses(req.session.admin.role);
    if (vis && !vis.includes(rows[0].status)) return null;
    return rows[0];
  }

  const denied = async (req, res, id, what) => {
    await audit(req, 'access_denied', `${what} on request #${id}`.slice(0, 200));
    flash(req, 'error', 'That request is not one of your jobs.');
    return res.redirect('/admin/requests');
  };

  const addEvent = (db, r, note, by) =>
    db.query('INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [r.id, r.status, note, by]);

  const tx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  // Re-price missing rates, work out the totals and save the bill. Caller holds the row lock.
  async function applyBill(client, r, code) {
    const { rows: items } = await client.query(
      'SELECT i.id, i.measured_qty, i.rate, COALESCE(c.unit, i.unit) AS unit FROM request_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.request_id = $1 ORDER BY i.id',
      [r.id]
    );
    // Orders with no per-kg service never wait for the customer: the bill is confirmed as soon as it is priced.
    const customerConfirms = items.some((i) => needsWeighing(i.unit));
    const calc = computeLines(items);
    for (const l of calc.lines) await client.query('UPDATE request_items SET rate = $1, line_total = $2 WHERE id = $3', [l.rate, l.line_total, l.id]);
    let status = customerConfirms ? 'awaiting_confirm' : 'confirmed';
    let subtotal = calc.subtotal;
    let discount = 0;
    let useCode = code;
    if (calc.missing) {
      status = 'needs_price';
      subtotal = 0;
      useCode = '';
    } else {
      const d = await discountFor(client, code, calc.subtotal, r.id, r.customer_id);
      if (d.error) return { error: d.error };
      discount = d.discount;
      if (d.row && r.discount_code !== code) await client.query('UPDATE discounts SET uses = uses + 1 WHERE id = $1', [d.row.id]);
    }
    const total = round2(Math.max(0, subtotal - discount));
    await client.query(
      `UPDATE requests SET subtotal_amount=$1, discount_code=$2, discount_amount=$3, total_amount=$4, bill_status=$5,
              bill_version=bill_version+1, bill_confirmed_at=${status === 'confirmed' ? 'now()' : 'NULL'}, bill_confirmed_by=$7, pay_later=FALSE, pay_later_by='', updated_at=now()
        WHERE id=$6`,
      [subtotal, useCode, discount, total, status, r.id, status === 'confirmed' ? 'Order confirmation' : '']
    );
    return { status, subtotal, discount, total };
  }

  // ---------- rider / manager: record the weight or count ----------
  router.post(
    '/requests/:id/weigh',
    need('weigh'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const by = req.session.admin.name;
      const outcome = await tx(async (client) => {
        const r = await mine(req, id, client, true);
        if (!r) return { denied: true };
        const privileged = can(req.session.admin.role, 'billadmin');
        const okStatus = privileged ? POST_CONFIRM_STATUSES.includes(r.status) : r.status === 'rider_arrived';
        if (!okStatus) return { error: privileged ? 'This order can only be weighed once it is confirmed and before it is delivered.' : 'Mark “Rider arrived” first, then weigh the clothes at the customer’s door.' };
        if (!OPEN_BILL.includes(r.bill_status)) {
          const kg = await client.query('SELECT 1 FROM request_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.request_id = $1 AND lower(trim(COALESCE(c.unit, i.unit, \'\'))) IN (\'kg\',\'kgs\',\'g\') LIMIT 1', [id]);
          return { error: kg.rows.length ? 'The customer has already confirmed this bill. Ask a manager to re-open it before weighing again.' : 'Only clothes charged per kg are weighed. This order is billed from what the customer ordered, so there is nothing to weigh.' };
        }
        const { rows: items } = await client.query(
          `SELECT i.id, i.category_name, i.quantity, i.unit, i.rate, c.unit AS cat_unit, c.price AS cat_price
             FROM request_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.request_id = $1 ORDER BY i.id`,
          [id]
        );
        if (!items.length) return { error: 'This order has no items to weigh.' };
        if (!items.some((i) => needsWeighing(i.cat_unit || i.unit))) {
          // Nothing is charged per kg: no weighing, no customer confirmation. Bill it from the order and let payment proceed.
          await autoBill(client, id);
          return { error: 'Only clothes charged per kg are weighed. This order is billed from what the customer ordered, so payment can be collected.' };
        }
        const parsed = parseMeasurements(items, req.body);
        if (parsed.error) return { error: parsed.error };
        for (const it of items) {
          const price = it.cat_price === null || it.cat_price === undefined ? it.rate : it.cat_price;
          await client.query('UPDATE request_items SET measured_qty = $1, unit = $2, rate = $3 WHERE id = $4', [parsed.values.get(it.id), it.cat_unit || it.unit || 'item', price, it.id]);
        }
        const bill = await applyBill(client, r, r.discount_code);
        let result = bill;
        if (bill.error) {
          // The saved discount code stopped being valid: drop it rather than block the rider.
          await client.query("UPDATE requests SET discount_code = '' WHERE id = $1", [id]);
          result = await applyBill(client, { ...r, discount_code: '' }, '');
        }
        await client.query('UPDATE requests SET weighed_by = $1, weighed_at = now() WHERE id = $2', [by, id]);
        await addEvent(client, r, result.status === 'needs_price' ? 'Laundry weighed. We are finalising your price.' : 'Laundry weighed. Your bill is ready to review and confirm.', by);
        return { result, r };
      });
      if (outcome.denied) return denied(req, res, id, 'Weigh');
      if (outcome.error) {
        flash(req, 'error', outcome.error);
        return back(res, id);
      }
      await audit(req, 'request_weighed', `Request #${id} weighed, bill ${outcome.result.status}`);
      if (outcome.result.status === 'needs_price') {
        notifyEvent('bill_needs_price', id, req.session.admin.id, (await getSettings()).business_name);
        flash(req, 'success', 'Saved. One service has no price yet, so a manager has been told to price it.');
      } else {
        flash(req, 'success', 'Saved. Now send the customer the bill link so they can confirm it.');
      }
      back(res, id);
    })
  );

  // ---------- cashier / manager: re-price missing rates and apply a discount code ----------
  router.post(
    '/requests/:id/bill/recalc',
    need('billing'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const code = cleanText(req.body.discount_code, 40).toUpperCase();
      const outcome = await tx(async (client) => {
        const r = await mine(req, id, client, true);
        if (!r) return { denied: true };
        const autoConfirmed = r.bill_status === 'confirmed' && r.bill_confirmed_by === 'Order confirmation' && Number(r.amount_paid) === 0;
        if (!['needs_price', 'awaiting_confirm', 'disputed'].includes(r.bill_status) && !autoConfirmed) return { error: 'This bill cannot be changed now.' };
        const { rows: items } = await client.query(
          `SELECT i.id, i.measured_qty, i.rate, c.price AS cat_price FROM request_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.request_id = $1`,
          [id]
        );
        if (items.some((i) => i.measured_qty === null)) return { error: 'Weigh or count the laundry first.' };
        for (const i of items) if ((i.rate === null || i.rate === undefined) && i.cat_price !== null) await client.query('UPDATE request_items SET rate = $1 WHERE id = $2', [i.cat_price, i.id]);
        const bill = await applyBill(client, r, code);
        if (bill.error) return { error: bill.error };
        await addEvent(client, r, 'Your bill was updated. Please review and confirm it.', req.session.admin.name);
        return { bill };
      });
      if (outcome.denied) return denied(req, res, id, 'Recalculate bill');
      if (outcome.error) flash(req, 'error', outcome.error);
      else {
        await audit(req, 'bill_recalc', `Request #${id}: ${outcome.bill.status}, code ${code || '-'}`);
        flash(req, 'success', outcome.bill.status === 'needs_price' ? 'A service still has no price. Set it under Categories, then recalculate.' : outcome.bill.status === 'confirmed' ? 'Bill recalculated. Payment can be collected.' : 'Bill recalculated. The customer must confirm it again.');
      }
      back(res, id);
    })
  );

  // ---------- staff confirms on the customer's behalf (phone call, in person) ----------
  router.post(
    '/requests/:id/bill/confirm',
    need('billing'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const how = cleanText(req.body.how, 100);
      if (how.length < 3) {
        flash(req, 'error', 'Say how the customer agreed (for example: confirmed by phone).');
        return back(res, id);
      }
      const by = `${req.session.admin.name} on behalf (${how})`;
      const done = await tx(async (client) => {
        const r = await mine(req, id, client, true);
        if (!r) return { denied: true };
        if (r.bill_status !== 'awaiting_confirm') return { error: 'There is no bill waiting for confirmation.' };
        if (Number(req.body.version) !== r.bill_version) return { error: 'The bill changed. Review it again before confirming.' };
        await client.query("UPDATE requests SET bill_status='confirmed', bill_confirmed_at=now(), bill_confirmed_by=$1, updated_at=now() WHERE id=$2", [by, id]);
        await addEvent(client, r, 'Bill confirmed.', req.session.admin.name);
        return { ok: true };
      });
      if (done.denied) return denied(req, res, id, 'Confirm bill');
      if (done.error) flash(req, 'error', done.error);
      else {
        await audit(req, 'bill_confirmed_staff', `Request #${id}: ${by}`);
        notifyEvent('bill_confirmed', id, req.session.admin.id, (await getSettings()).business_name);
        flash(req, 'success', 'Bill confirmed. Payment can now be collected.');
      }
      back(res, id);
    })
  );

  // ---------- manager / owner: re-open a bill so it can be weighed again ----------
  router.post(
    '/requests/:id/bill/reopen',
    need('billadmin'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const reason = cleanText(req.body.reason, 150);
      if (reason.length < 3) {
        flash(req, 'error', 'Give a short reason for re-opening the bill.');
        return back(res, id);
      }
      const done = await tx(async (client) => {
        const r = await mine(req, id, client, true);
        if (!r) return { denied: true };
        if (!['awaiting_confirm', 'confirmed'].includes(r.bill_status)) return { error: 'This bill is not waiting or confirmed, so there is nothing to re-open.' };
        const w = await client.query('SELECT 1 FROM request_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.request_id = $1 AND lower(trim(COALESCE(c.unit, i.unit, \'\'))) IN (\'kg\',\'kgs\',\'g\') LIMIT 1', [id]);
        if (!w.rows.length) return { error: 'This order has no per-kg service. Use Recalculate to change its bill.' };
        await client.query("UPDATE requests SET bill_status='disputed', bill_confirmed_at=NULL, bill_confirmed_by='', pay_later=FALSE, pay_later_by='', updated_at=now() WHERE id=$1", [id]);
        await addEvent(client, r, 'Your bill is being checked again.', req.session.admin.name);
        return { ok: true };
      });
      if (done.denied) return denied(req, res, id, 'Re-open bill');
      if (done.error) flash(req, 'error', done.error);
      else {
        await audit(req, 'bill_reopened', `Request #${id}: ${reason}`);
        flash(req, 'success', 'Bill re-opened. Weigh again to send a new bill. Any payment already recorded stays on the order.');
      }
      back(res, id);
    })
  );

  // ---------- manager / owner: allow pick-up before payment ----------
  router.post(
    '/requests/:id/pay-later',
    need('billadmin'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const on = req.body.on === '1';
      const done = await tx(async (client) => {
        const r = await mine(req, id, client, true);
        if (!r) return { denied: true };
        if (r.bill_status !== 'confirmed') return { error: 'The customer must confirm the bill first.' };
        await client.query('UPDATE requests SET pay_later=$1, pay_later_by=$2, updated_at=now() WHERE id=$3', [on, on ? req.session.admin.name : '', id]);
        await addEvent(client, r, on ? 'Payment on delivery arranged.' : 'Payment on delivery cancelled.', req.session.admin.name);
        return { ok: true };
      });
      if (done.denied) return denied(req, res, id, 'Pay later');
      if (done.error) flash(req, 'error', done.error);
      else {
        await audit(req, on ? 'pay_later_on' : 'pay_later_off', `Request #${id}`);
        flash(req, 'success', on ? 'Pick-up allowed before payment. The balance stays on the order.' : 'Pay later switched off.');
      }
      back(res, id);
    })
  );

  // ---------- record a cash or M-Pesa payment ----------
  router.post(
    '/requests/:id/payments',
    need('collect'),
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const method = req.body.method === 'mpesa' ? 'mpesa' : req.body.method === 'cash' ? 'cash' : '';
      const amount = round2(String(req.body.amount || '').replace(/,/g, ''));
      const reference = method === 'mpesa' ? cleanMpesaCode(req.body.reference) : '';
      const seesPrices = can(req.session.admin.role, 'billing');
      const fail = (msg) => {
        flash(req, 'error', msg);
        return back(res, id);
      };
      if (!method) return fail('Choose cash or M-Pesa.');
      if (!(amount > 0)) return fail('Enter the amount received.');
      if (method === 'mpesa' && !MPESA_CODE.test(reference)) return fail('Enter the 10-character M-Pesa confirmation code from the customer’s SMS (for example QGH7ABC123).');

      let outcome;
      try {
        outcome = await tx(async (client) => {
          let r = await mine(req, id, client, true);
          if (!r) return { denied: true };
          if (r.bill_status === 'none' && ['confirmed', 'rider_arrived'].includes(r.status) && (await autoBill(client, id))) r = await mine(req, id, client, true);
          // Riders only collect on a bill the customer has confirmed. Cashier / manager can also settle older orders.
          const okBill = r.bill_status === 'confirmed' || (seesPrices && r.bill_status === 'legacy');
          if (!okBill || r.status === 'cancelled') return { error: 'Payment can be recorded once the bill is confirmed (per-kg laundry is confirmed by the customer after weighing; other orders once the order is confirmed).' };
          const balance = round2(Number(r.total_amount) - Number(r.amount_paid));
          if (balance <= 0) return { error: 'This order is already fully paid.' };
          if (amount > balance + 0.001) return { error: `That is more than the balance due (${money(balance, (await getSettings()).currency)}).` };
          await client.query(
            'INSERT INTO payments (request_id, amount, method, reference, recorded_by, reconciled) VALUES ($1,$2,$3,$4,$5,$6)',
            [id, amount, method, reference, req.session.admin.name, method === 'cash' && seesPrices]
          );
          await client.query('UPDATE requests SET amount_paid = amount_paid + $1, updated_at = now() WHERE id = $2', [amount, id]);
          const left = round2(balance - amount);
          await addEvent(client, r, left <= 0 ? 'Payment received. Thank you!' : 'Part payment received. Thank you!', req.session.admin.name);
          // Payments are recorded by hand, so a recorded payment counts as paid straight away. With Pay Before Cleaning on,
          // full payment on a confirmed bill moves the order to Picked up automatically.
          const advanced = left <= 0 && (await getSettings()).pay_before_cleaning !== '0' ? await advanceIfPaid(client, id) : false;
          return { left, advanced };
        });
      } catch (err) {
        if (err.code === '23505') return fail('That M-Pesa code has already been recorded on an order.');
        throw err;
      }
      if (outcome.denied) return denied(req, res, id, 'Record payment');
      if (outcome.error) return fail(outcome.error);
      await audit(req, 'payment_recorded', `Request #${id}: ${method} ${amount}${reference ? ` ${reference}` : ''}`);
      if (outcome.left <= 0) notifyEvent('paid', id, req.session.admin.id, (await getSettings()).business_name); // tells the assigned rider (never the person who recorded it)
      if (outcome.advanced) {
        await audit(req, 'request_status', `Request #${id} → picked_up (automatic, fully paid)`);
        notifyEvent(eventFor('picked_up', 0, 0), id, req.session.admin.id, (await getSettings()).business_name);
      }
      flash(req, 'success', outcome.left <= 0 ? 'Payment recorded. The order is fully paid.' : 'Payment recorded. A balance remains.');
      back(res, id);
    })
  );

  // ---------- cashier / manager: confirm the money really arrived ----------
  router.post(
    '/payments/:pid/reconcile',
    need('billing'),
    wrap(async (req, res) => {
      const pid = parseInt(req.params.pid, 10);
      const upd = Number.isInteger(pid)
        ? await pool.query('UPDATE payments SET reconciled = TRUE WHERE id = $1 AND NOT reconciled RETURNING request_id, method, amount', [pid])
        : { rows: [] };
      if (!upd.rows.length) {
        flash(req, 'error', 'Payment not found or already reconciled.');
        return res.redirect('/admin/requests');
      }
      await audit(req, 'payment_reconciled', `Payment #${pid} (${upd.rows[0].method} ${upd.rows[0].amount}) on request #${upd.rows[0].request_id}`);
      flash(req, 'success', 'Marked as received.');
      back(res, upd.rows[0].request_id);
    })
  );
};

module.exports.loadBillData = loadBillData;
