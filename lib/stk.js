// M-Pesa STK push (Safaricom Daraja "M-Pesa Express").
//
// Everything secret lives in the environment (.env locally, Environment on Render), nothing is stored in the database:
//   MPESA_ENV               sandbox (default) or production
//   MPESA_CONSUMER_KEY      from your app on developer.safaricom.co.ke
//   MPESA_CONSUMER_SECRET   from the same app
//   MPESA_SHORTCODE         the Paybill number, or (Buy Goods) the Head Office / store number the Till belongs to
//   MPESA_PASSKEY           the Lipa na M-Pesa Online passkey for that shortcode
//   MPESA_TRANSACTION_TYPE  CustomerPayBillOnline (Paybill, default) or CustomerBuyGoodsOnline (Till)
//   MPESA_PARTY_B           Buy Goods only: the Till number. Leave empty to use MPESA_SHORTCODE
//   MPESA_CALLBACK_SECRET   a long random text; it becomes part of the callback address so only Safaricom's calls are accepted
//   APP_URL                 your public https address, e.g. https://igumori.onrender.com  (or set MPESA_CALLBACK_URL in full)
// When these are not all set, STK push stays switched off and customers still see the manual Till/Paybill steps.
const { pool } = require('../config/db');
const live = require('./live');
const { getSettings } = require('./settings');
const { advanceIfPaid } = require('./bill');
const { notifyEvent, eventFor } = require('./notify');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const PENDING_MAX_MS = 4 * 60 * 1000; // after this a prompt nobody answered is shown as timed out
const QUERY_REF = 'STKQ-'; // placeholder payment reference for a payment confirmed by a status query (no receipt number yet)
const REUSE_MS = 75 * 1000; // a customer pressing the button again inside this time gets the same prompt, never a second charge

function config() {
  const e = process.env;
  const base = String(e.MPESA_ENV || e.MPESA_ENVIRONMENT || 'sandbox').toLowerCase() === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  const shortcode = String(e.MPESA_SHORTCODE || '').trim();
  const type = e.MPESA_TRANSACTION_TYPE === 'CustomerBuyGoodsOnline' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline';
  const appUrl = String(e.APP_URL || '').trim().replace(/\/+$/, '');
  const secret = String(e.MPESA_CALLBACK_SECRET || '').trim();
  const callback = String(e.MPESA_CALLBACK_URL || '').trim() || (appUrl && secret ? `${appUrl}/pay/callback/${secret}` : '');
  return {
    base,
    key: String(e.MPESA_CONSUMER_KEY || '').trim(),
    secret: String(e.MPESA_CONSUMER_SECRET || '').trim(),
    shortcode,
    passkey: String(e.MPESA_PASSKEY || '').trim(),
    type,
    partyB: String(e.MPESA_PARTY_B || '').trim() || shortcode,
    callbackSecret: secret,
    callback,
  };
}

// True only when everything needed to send a prompt is present.
function enabled() {
  const c = config();
  return !!(c.key && c.secret && c.shortcode && c.passkey && /^https:\/\//.test(c.callback) && c.callbackSecret);
}

// Safaricom wants 2547XXXXXXXX or 2541XXXXXXXX. Accepts 07.., 01.., 7.., +254.., 254.. Returns '' when it is not a Kenyan mobile number.
function normalizePhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(d)) d = `254${d.slice(1)}`;
  else if (/^[17]\d{8}$/.test(d)) d = `254${d}`;
  return /^254[17]\d{8}$/.test(d) ? d : '';
}

const maskPhone = (p) => (p ? `${p.slice(0, 5)}***${p.slice(-3)}` : '');

let tokenCache = { value: '', until: 0 };
async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.until) return tokenCache.value;
  const c = config();
  const res = await fetch(`${c.base}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${c.key}:${c.secret}`).toString('base64')}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Daraja sign-in failed (${res.status}). Check MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET and MPESA_ENV.`);
  const j = await res.json();
  tokenCache = { value: j.access_token, until: Date.now() + Math.max(60, Number(j.expires_in || 3599) - 60) * 1000 };
  return tokenCache.value;
}

// Daraja time stamp, Nairobi time: YYYYMMDDHHmmss
function stamp() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
const passwordFor = (c, ts) => Buffer.from(`${c.shortcode}${c.passkey}${ts}`).toString('base64');

async function daraja(path, body, retried = false) {
  const token = await accessToken();
  const res = await fetch(`${config().base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  let json = {};
  try { json = await res.json(); } catch (e) { /* not JSON */ }
  // Daraja answers a bad or expired token with HTTP 404 (errorCode 404.001.03 "Invalid Access Token"), not 401.
  // Forget the cached token and retry once with a fresh one, otherwise the same dead token is reused until it "expires".
  const badToken = res.status === 401 || (json && /^404\.001\.0[13]$/.test(String(json.errorCode || '')));
  if (badToken) {
    tokenCache = { value: '', until: 0 };
    if (!retried) return daraja(path, body, true);
  }
  return { ok: res.ok, status: res.status, json };
}

// What the customer owes on this order, in whole shillings (M-Pesa cannot charge cents).
const balanceOf = (r) => Math.max(0, round2(Number(r.total_amount) - Number(r.amount_paid)));

// Can this order be paid by STK push right now? Returns '' when yes, otherwise the reason.
function cannotPay(r) {
  if (!enabled()) return 'Pay by M-Pesa prompt is not available yet.';
  if (r.status === 'cancelled') return 'This order was cancelled.';
  if (r.bill_status !== 'confirmed') return 'Your bill must be confirmed before it can be paid.';
  if (balanceOf(r) <= 0) return 'This order is already fully paid.';
  return '';
}

// Sends the prompt to the customer's phone. `r` is the request row (id, ref_code, status, bill_status, total_amount, amount_paid).
// Returns { ok: true, stk } or { ok: false, error }.
async function startPush(r, phoneInput) {
  const why = cannotPay(r);
  if (why) return { ok: false, error: why };
  const phone = normalizePhone(phoneInput);
  if (!phone) return { ok: false, error: 'Enter a Safaricom number like 0712 345 678.' };

  // Same order, a prompt is still waiting: show that one instead of charging twice.
  const open = await pool.query(
    "SELECT * FROM mpesa_stk WHERE request_id = $1 AND status = 'pending' AND created_at > now() - ($2 || ' milliseconds')::interval ORDER BY id DESC LIMIT 1",
    [r.id, String(REUSE_MS)]
  );
  if (open.rows.length) return { ok: true, stk: open.rows[0], reused: true };

  // At most 5 prompts per order per hour, so the pay button cannot be used to spam a phone.
  const recent = await pool.query("SELECT COUNT(*)::int AS n FROM mpesa_stk WHERE request_id = $1 AND created_at > now() - interval '1 hour'", [r.id]);
  if (recent.rows[0].n >= 5) return { ok: false, error: 'Too many payment prompts were sent for this order. Please wait a while, or pay using the steps below.' };

  const amount = Math.ceil(balanceOf(r));
  const c = config();
  const ts = stamp();
  let out;
  try {
    out = await daraja('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: c.shortcode,
      Password: passwordFor(c, ts),
      Timestamp: ts,
      TransactionType: c.type,
      Amount: amount,
      PartyA: phone,
      PartyB: c.partyB,
      PhoneNumber: phone,
      CallBackURL: c.callback,
      AccountReference: String(r.ref_code).slice(0, 12),
      TransactionDesc: String(process.env.MPESA_TRANSACTION_DESC || 'Laundry bill').slice(0, 13),
    });
  } catch (e) {
    console.error('STK push request failed:', e.message);
    return { ok: false, error: 'We could not reach M-Pesa. Please try again in a moment.' };
  }
  const j = out.json || {};
  if (!out.ok || String(j.ResponseCode) !== '0' || !j.CheckoutRequestID) {
    console.error('STK push refused:', out.status, JSON.stringify(j));
    return { ok: false, error: 'M-Pesa did not accept the request. Check the number and try again, or pay using the steps below.' };
  }
  const ins = await pool.query(
    `INSERT INTO mpesa_stk (request_id, request_ref, phone, amount, merchant_request_id, checkout_request_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [r.id, r.ref_code, phone, amount, String(j.MerchantRequestID || ''), String(j.CheckoutRequestID)]
  );
  return { ok: true, stk: ins.rows[0] };
}

const FAIL_STATUS = (code) => (Number(code) === 1032 ? 'cancelled' : Number(code) === 1037 ? 'timeout' : 'failed');

// Plain-language text for a settled (or still waiting) prompt.
function describe(stk) {
  switch (stk.status) {
    case 'success': return 'Payment received. Thank you!';
    case 'cancelled': return 'The payment was cancelled on your phone. You can try again.';
    case 'timeout': return 'We did not get an answer from your phone. If money was taken, show the M-Pesa message to the rider or cashier. Otherwise, try again.';
    case 'failed': {
      const code = Number(stk.result_code);
      if (code === 1) return 'Your M-Pesa balance is too low for this payment.';
      if (code === 2001) return 'The M-Pesa PIN was wrong. Please try again.';
      if (code === 1019 || code === 1025 || code === 9999) return 'M-Pesa could not send the prompt. Please try again.';
      return 'The payment did not go through. You can try again.';
    }
    default: return 'Check your phone and enter your M-Pesa PIN.';
  }
}

// Settles one prompt from Safaricom's callback body (the only thing that can credit money).
// Safe to call twice with the same callback: a prompt is settled once.
async function handleCallback(body) {
  const cb = body && body.Body && body.Body.stkCallback;
  if (!cb || !cb.CheckoutRequestID) return { ignored: true };
  const items = {};
  for (const it of (cb.CallbackMetadata && cb.CallbackMetadata.Item) || []) items[it.Name] = it.Value;
  return settle({ checkoutId: String(cb.CheckoutRequestID), code: Number(cb.ResultCode), desc: String(cb.ResultDesc || ''), receipt: items.MpesaReceiptNumber ? String(items.MpesaReceiptNumber).toUpperCase() : '', amount: Number(items.Amount) });
}

async function settle({ checkoutId, code, desc, receipt, amount, viaQuery = false }) {
  const client = await pool.connect();
  let after = null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM mpesa_stk WHERE checkout_request_id = $1 FOR UPDATE', [checkoutId]);
    const stk = rows[0];
    // Settled prompts are never settled twice. The one exception: a prompt we only marked "timeout" ourselves (no answer
    // arrived in time) can still be credited if Safaricom's success callback turns up late, so real money is never lost.
    if (!stk || (stk.status !== 'pending' && !(stk.status === 'timeout' && code === 0))) {
      // A prompt credited from a status query carries a placeholder reference (QUERY_REF). When the real callback finally
      // arrives with the M-Pesa receipt, swap the placeholder for it so the payment matches the statement.
      if (stk && stk.status === 'success' && code === 0 && /^[A-Z0-9]{10}$/.test(receipt) && String(stk.receipt).startsWith(QUERY_REF)) {
        const taken = await client.query("SELECT 1 FROM payments WHERE method = 'mpesa' AND reference = $1", [receipt]);
        if (!taken.rows.length) {
          const same = !(amount > 0) || Math.abs(round2(amount) - round2(Number(stk.amount))) <= 0.009;
          await client.query("UPDATE payments SET reference = $1, reconciled = $2 WHERE method = 'mpesa' AND reference = $3", [receipt, same, stk.receipt]);
          await client.query('UPDATE mpesa_stk SET receipt = $1 WHERE id = $2', [receipt, stk.id]);
        }
      }
      await client.query('COMMIT');
      return { ignored: true };
    }

    if (code !== 0) {
      await client.query("UPDATE mpesa_stk SET status = $1, result_code = $2, result_desc = $3, completed_at = now() WHERE id = $4", [FAIL_STATUS(code), code, desc.slice(0, 300), stk.id]);
      await client.query('COMMIT');
      return { status: FAIL_STATUS(code) };
    }

    // Success. A callback success without a receipt number cannot be matched to a statement, so it is never credited
    // automatically. A success learned from Safaricom's own status query has no receipt either (the query does not return
    // one): it is credited under a placeholder reference and left UNRECONCILED for a manager to check against the statement.
    if (!/^[A-Z0-9]{10}$/.test(receipt) && viaQuery) receipt = `${QUERY_REF}${checkoutId}`;
    if (!/^[A-Z0-9]{10}$/.test(receipt) && !receipt.startsWith(QUERY_REF)) {
      await client.query("UPDATE mpesa_stk SET status = 'failed', result_code = $1, result_desc = $2, completed_at = now() WHERE id = $3", [code, 'Success without a receipt number; check the M-Pesa statement.', stk.id]);
      await client.query('COMMIT');
      console.error('STK success without receipt for', checkoutId);
      return { status: 'failed' };
    }

    const received = round2(amount > 0 ? amount : stk.amount);
    // The amount Safaricom reports must equal the amount we asked for. If not, the money is still recorded (it was paid),
    // but it is left UNRECONCILED so a manager checks it against the M-Pesa statement.
    const amountMismatch = amount > 0 && Math.abs(received - round2(Number(stk.amount))) > 0.009;
    if (amountMismatch) console.warn(`STK amount mismatch for ${checkoutId}: asked ${stk.amount}, received ${received}`);
    const mismatch = amountMismatch || viaQuery; // confirmed by a status query only: no receipt number yet, so it waits for a manager too
    const rq = stk.request_id ? await client.query('SELECT id, ref_code, status, total_amount, amount_paid FROM requests WHERE id = $1 FOR UPDATE', [stk.request_id]) : { rows: [] };
    const dupe = await client.query("SELECT 1 FROM payments WHERE method = 'mpesa' AND reference = $1", [receipt]);

    if (!dupe.rows.length) {
      await client.query(
        'INSERT INTO payments (request_id, request_ref, amount, method, reference, recorded_by, reconciled) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [stk.request_id, stk.request_ref, received, 'mpesa', receipt, 'M-Pesa prompt', !mismatch] // confirmed by Safaricom and the amount matches, so it is reconciled; a mismatch waits for a manager
      );
      if (rq.rows.length) {
        const r = rq.rows[0];
        const balance = round2(Number(r.total_amount) - Number(r.amount_paid));
        await client.query('UPDATE requests SET amount_paid = amount_paid + $1, updated_at = now() WHERE id = $2', [received, r.id]);
        const left = round2(balance - received);
        const extra = round2(received - Math.max(0, balance));
        const note = left > 0 ? 'Part payment received by M-Pesa. Thank you!' : extra >= 1 ? `Payment received by M-Pesa. It was KES ${extra} more than the balance, so our team will contact you.` : 'Payment received by M-Pesa. Thank you!';
        await client.query('INSERT INTO request_events (request_id, status, note, created_by) VALUES ($1,$2,$3,$4)', [r.id, r.status, note, 'M-Pesa']);
        const settings = await getSettings();
        const advanced = left <= 0 && settings.pay_before_cleaning !== '0' ? await advanceIfPaid(client, r.id) : false;
        after = { requestId: r.id, advanced, paidInFull: left <= 0, business: settings.business_name };
      }
    }
    await client.query("UPDATE mpesa_stk SET status = 'success', result_code = 0, result_desc = $1, receipt = $2, paid_amount = $3, completed_at = now() WHERE id = $4", [desc.slice(0, 300), receipt, received, stk.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (after) {
    live.publish(after.requestId);
    if (after.paidInFull) notifyEvent('paid', after.requestId, null, after.business); // the assigned rider is told the bill is paid
    if (after.advanced) notifyEvent(eventFor('picked_up', 0, 0), after.requestId, null, after.business);
  }
  return { status: 'success' };
}

// Asks Safaricom what happened to one prompt (STK Push Query). Returns { code, desc } once Safaricom has an answer
// (0 = paid, anything else = it failed or was cancelled), or null while the prompt is still being processed or Safaricom cannot be reached.
async function queryResult(checkoutId) {
  const c = config();
  const ts = stamp();
  const q = await daraja('/mpesa/stkpushquery/v1/query', { BusinessShortCode: c.shortcode, Password: passwordFor(c, ts), Timestamp: ts, CheckoutRequestID: checkoutId });
  const j = q.json || {};
  if (!q.ok || j.errorCode || j.ResultCode === undefined || j.ResultCode === null || j.ResultCode === '') return null; // e.g. 500.001.1001 "being processed"
  return { code: Number(j.ResultCode), desc: String(j.ResultDesc || '') };
}

// Queries one pending (or recently timed-out) prompt and settles it when Safaricom has an answer.
// A paid prompt is credited even though its callback was lost; a failed one is closed. Returns true if it was settled.
async function queryAndSettle(stk) {
  await pool.query('UPDATE mpesa_stk SET last_query_at = now() WHERE id = $1', [stk.id]);
  const r = await queryResult(stk.checkout_request_id);
  if (!r || Number.isNaN(r.code)) return false;
  if (r.code === 0) return !(await settle({ checkoutId: stk.checkout_request_id, code: 0, desc: r.desc || 'Confirmed by status query', receipt: '', amount: Number(stk.amount), viaQuery: true })).ignored;
  if (stk.status !== 'pending') return false; // a timed-out prompt only matters if it turns out to have been paid
  return !(await settle({ checkoutId: stk.checkout_request_id, code: r.code, desc: r.desc })).ignored;
}

// Used by the page that waits for the answer. Returns the prompt row as it now stands.
// When the callback is slow it asks Safaricom directly, so the customer sees the result without waiting for the callback.
async function refresh(stkId) {
  let { rows } = await pool.query('SELECT * FROM mpesa_stk WHERE id = $1', [stkId]);
  let stk = rows[0];
  if (!stk || stk.status !== 'pending') return stk;

  const age = Date.now() - new Date(stk.created_at).getTime();
  const lastQ = stk.last_query_at ? Date.now() - new Date(stk.last_query_at).getTime() : Infinity;
  if (enabled() && age > 20000 && lastQ > 10000) {
    try { await queryAndSettle(stk); } catch (e) { /* still waiting; the callback or the background job will settle it */ }
    ({ rows } = await pool.query('SELECT * FROM mpesa_stk WHERE id = $1', [stkId]));
    stk = rows[0];
  }
  if (stk.status === 'pending' && age > PENDING_MAX_MS) {
    await settle({ checkoutId: stk.checkout_request_id, code: 1037, desc: 'No answer received' }); // the background job keeps checking timed-out prompts
    ({ rows } = await pool.query('SELECT * FROM mpesa_stk WHERE id = $1', [stkId]));
  }
  return rows[0];
}

// ---------- Background reconciliation: a lost callback must never leave a paid prompt "pending" ----------
// Every RECONCILE_EVERY_MS it asks Safaricom about:
//   * prompts still pending after 60 seconds (the callback is late or lost), and
//   * prompts we closed as "timeout" in the last 3 hours (the customer may have paid after all).
// Paid -> credited (unreconciled, placeholder reference, a manager matches it to the statement); failed/cancelled -> closed.
// A pending prompt older than PENDING_MAX_MS that Safaricom still has no answer for is closed as a timeout.
const RECONCILE_EVERY_MS = 60 * 1000;
let reconciling = false;

async function reconcilePending() {
  if (reconciling || !enabled()) return { checked: 0, settled: 0 };
  reconciling = true;
  let checked = 0;
  let settled = 0;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mpesa_stk
        WHERE (status = 'pending' AND created_at < now() - interval '60 seconds' AND (last_query_at IS NULL OR last_query_at < now() - interval '45 seconds'))
           OR (status = 'timeout' AND receipt = '' AND created_at > now() - interval '3 hours' AND (last_query_at IS NULL OR last_query_at < now() - interval '10 minutes'))
        ORDER BY id LIMIT 25`
    );
    for (const stk of rows) {
      checked += 1;
      try {
        if (await queryAndSettle(stk)) settled += 1;
        else if (stk.status === 'pending' && Date.now() - new Date(stk.created_at).getTime() > PENDING_MAX_MS) {
          await settle({ checkoutId: stk.checkout_request_id, code: 1037, desc: 'No answer received' });
        }
      } catch (e) {
        console.error('STK reconcile failed for', stk.checkout_request_id, '-', e.message);
      }
    }
    if (settled) console.log(`M-Pesa reconcile: settled ${settled} of ${checked} prompt(s) from Safaricom's status query.`);
  } catch (e) {
    console.error('M-Pesa reconcile failed:', e.message);
  } finally {
    reconciling = false;
  }
  return { checked, settled };
}

let reconcileTimer = null;
function startReconciler() {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(reconcilePending, RECONCILE_EVERY_MS);
  reconcileTimer.unref();
  setTimeout(reconcilePending, 15000).unref(); // also catch anything left pending by a restart
}
function stopReconciler() {
  clearInterval(reconcileTimer);
  reconcileTimer = null;
}

module.exports = { enabled, config, normalizePhone, maskPhone, balanceOf, cannotPay, startPush, handleCallback, refresh, describe, reconcilePending, startReconciler, stopReconciler };
