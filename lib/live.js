// Live updates over Server-Sent Events (SSE). No extra packages: it works with Express and the existing session cookies.
//
// Channels (rooms):
//   order:<id>  the customer who owns that order (verified with the reference code + phone, or the account that placed it)
//   staff       signed-in staff. Each person only receives orders their role may see, and riders / attendants never get prices.
// Events are sent only after a change is committed. publish() compares the order's updated_at with the last one it sent,
// so a rejected change (nothing written) is never broadcast.
const { pool } = require('../config/db');
const { can, visibleStatuses } = require('./roles');

const clients = new Set();
const lastSent = new Map(); // order id -> { stamp, status }
const MAX_TRACKED = 5000;

function open(req, res, meta) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', // no-transform keeps compression from buffering the stream
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  if (res.flush) res.flush();
  const client = { res, ...meta };
  clients.add(client);
  req.on('close', () => clients.delete(client));
  return client;
}

function send(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (client.res.flush) client.res.flush();
  } catch (e) {
    clients.delete(client);
  }
}

setInterval(() => {
  for (const c of clients) {
    try {
      c.res.write(': ping\n\n');
      if (c.res.flush) c.res.flush();
    } catch (e) {
      clients.delete(c);
    }
  }
}, 25000).unref();

const KG = /^(kg|kgs|g)$/i;

async function snapshot(orderId) {
  const [o, items] = await Promise.all([
    pool.query('SELECT id, ref_code, status, bill_status, bill_version, total_amount, amount_paid, pay_later, rider_admin_id, updated_at FROM requests WHERE id = $1', [orderId]),
    pool.query('SELECT COALESCE(i.unit, c.unit) AS unit, i.measured_qty FROM request_items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.request_id = $1', [orderId]),
  ]);
  if (!o.rows.length) return null;
  const r = o.rows[0];
  const kgLines = items.rows.filter((i) => KG.test(String(i.unit || '').trim()));
  const pricing = !items.rows.length ? 'per_item' : kgLines.length === 0 ? 'per_item' : kgLines.length === items.rows.length ? 'per_kg' : 'mixed';
  const weighed = kgLines.filter((i) => i.measured_qty !== null);
  const total = Number(r.total_amount);
  const paid = Number(r.amount_paid);
  const billReady = ['confirmed', 'legacy'].includes(r.bill_status) && total > 0;
  let payment = 'awaiting_bill';
  if (billReady) payment = paid >= total ? 'paid' : paid > 0 ? 'part_paid' : r.pay_later ? 'pay_later' : 'pending_payment';
  return {
    r,
    payload: {
      order_id: r.id,
      ref: r.ref_code,
      order_status: r.status,
      bill_status: r.bill_status,
      payment_status: payment,
      pricing_type: pricing,
      dynamic_weight: weighed.length ? Number(weighed.reduce((s, i) => s + Number(i.measured_qty), 0).toFixed(2)) : null,
      total_price: ['awaiting_confirm', 'confirmed', 'disputed', 'legacy'].includes(r.bill_status) ? total : null,
      amount_paid: paid,
      seq: new Date(r.updated_at).getTime(),
    },
  };
}

async function publish(orderId, { force = false } = {}) {
  try {
    const snap = await snapshot(orderId);
    if (!snap) return;
    const stamp = new Date(snap.r.updated_at).getTime();
    const prev = lastSent.get(orderId);
    if (!force) {
      if (prev && prev.stamp === stamp) return; // nothing changed since the last broadcast
      if (!prev && Date.now() - stamp > 15000) return; // first sight after a restart and not freshly changed
    }
    if (lastSent.size > MAX_TRACKED) lastSent.clear();
    lastSent.set(orderId, { stamp, status: snap.r.status });
    const { payload } = snap;
    for (const c of clients) {
      if (c.kind === 'order' && c.orderId === orderId) send(c, 'order', payload);
      if (c.kind === 'staff') {
        const vis = visibleStatuses(c.role);
        if (vis && !vis.includes(snap.r.status) && !(prev && vis.includes(prev.status))) continue;
        if (c.role === 'rider' && snap.r.rider_admin_id !== null && snap.r.rider_admin_id !== undefined && Number(snap.r.rider_admin_id) !== Number(c.adminId)) continue; // another rider's job
        const copy = { ...payload };
        if (!can(c.role, 'billing')) {
          copy.total_price = null; // riders and attendants never see prices
          copy.amount_paid = undefined;
        }
        send(c, 'order', copy);
      }
    }
  } catch (e) {
    console.error('live publish failed:', e.message);
  }
}

function broadcastStaff(event, data) {
  for (const c of clients) if (c.kind === 'staff') send(c, event, data);
}

// Express middleware: after any staff POST on /requests/:id/... (or the dispatch form) finishes, announce the order if it changed.
function liveHook(req, res, next) {
  if (req.method !== 'POST') return next();
  let id = null;
  const m = /^\/(?:admin|staff)\/requests\/(\d+)\//.exec(req.path);
  if (m) id = Number(m[1]);
  else if (/^\/admin\/operations\/dispatch$/.test(req.path)) id = parseInt(req.body && req.body.request_id, 10) || null;
  if (id) res.on('finish', () => { if (res.statusCode < 400) publish(id); });
  next();
}

module.exports = { open, publish, broadcastStaff, liveHook, clientCount: () => clients.size };
