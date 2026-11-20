// Live updates over Server-Sent Events (SSE). No extra packages: it works with Express and the existing session cookies.
//
// Channels (rooms):
//   order:<id>  the customer who owns that order (verified with the reference code + phone, or the account that placed it)
//   staff       signed-in staff. Each person only receives orders their role may see, and riders / attendants never get prices.
// Events are sent only after a change is committed. publish() compares the order's updated_at with the last one it sent,
// so a rejected change (nothing written) is never broadcast.
const { pool } = require('../config/db');
const { can, visibleStatuses } = require('./roles');
const bus = require('./bus');

// With several copies of the app behind a load balancer, a browser's live stream is held by ONE copy while the change that
// triggers it may be handled by ANOTHER. So changes are announced on the cluster bus (lib/bus.js); every copy hears them and
// pushes to the streams it holds. Names ending in "Local" act on this copy's own streams only.

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

async function publishLocal(orderId, { force = false } = {}) {
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

function broadcastStaffLocal(event, data) {
  for (const c of clients) if (c.kind === 'staff') send(c, event, data);
}

// Cluster-wide versions (what the rest of the app calls).
const publish = (orderId, opts = {}) => bus.emit('live:order', { id: orderId, force: !!opts.force }).catch((e) => console.error('live publish failed:', e.message));
const broadcastStaff = (event, data) => bus.emit('live:staff', { event, data }).catch((e) => console.error('live broadcast failed:', e.message));
bus.on('live:order', (m) => publishLocal(m.id, { force: m.force }));
bus.on('live:staff', (m) => broadcastStaffLocal(m.event, m.data));

// ---- Public catalog channel: tells open public pages that the services (categories) changed. ----
// It carries no customer data at all, only a version number, so anyone may listen. Connections are capped so it cannot be abused.
const MAX_CATALOG = 3000;
const MAX_CATALOG_PER_IP = 6;
let catalogCount = 0;
let catalogVersion = Date.now();
// Every copy must greet a reconnecting page with the SAME version, so it is kept in the database (settings row 'catalog_v').
const loadCatalogVersion = () =>
  pool.query("SELECT value FROM settings WHERE key = 'catalog_v'").then(({ rows }) => { if (rows.length) catalogVersion = Number(rows[0].value) || catalogVersion; }).catch(() => {});
loadCatalogVersion();
bus.on('connected', loadCatalogVersion);
let catalogTimer = null;
const catalogPerIp = new Map();

function openCatalog(req, res) {
  const ip = req.ip || 'unknown';
  const mine = catalogPerIp.get(ip) || 0;
  if (catalogCount >= MAX_CATALOG || mine >= MAX_CATALOG_PER_IP) return res.status(429).end();
  const client = open(req, res, { kind: 'catalog' });
  catalogCount += 1;
  catalogPerIp.set(ip, mine + 1);
  req.on('close', () => {
    catalogCount -= 1;
    const left = (catalogPerIp.get(ip) || 1) - 1;
    if (left > 0) catalogPerIp.set(ip, left);
    else catalogPerIp.delete(ip);
  });
  send(client, 'hello', { v: catalogVersion }); // a page that reconnects compares this to know whether it missed a change
}

bus.on('live:catalog', (m) => {
  catalogVersion = m.v;
  for (const c of clients) if (c.kind === 'catalog') send(c, 'catalog', { v: catalogVersion });
});

// Called after an admin adds, edits, hides, shows, deletes or re-photographs a category. Several quick changes become one message.
function broadcastCatalog() {
  clearTimeout(catalogTimer);
  catalogTimer = setTimeout(() => {
    const v = Date.now();
    pool
      .query("INSERT INTO settings (key, value) VALUES ('catalog_v', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(v)])
      .catch(() => {})
      .then(() => bus.emit('live:catalog', { v }))
      .catch((e) => console.error('catalog broadcast failed:', e.message));
  }, 500);
  if (catalogTimer.unref) catalogTimer.unref();
}

// Express middleware: after any staff POST on /requests/:id/... (or the dispatch form) finishes, announce the order if it changed.
function liveHook(req, res, next) {
  if (req.method !== 'POST') return next();
  if (/^\/admin\/categories(?:\/|$)/.test(req.path)) res.on('finish', () => { if (res.statusCode < 400) broadcastCatalog(); });
  let id = null;
  const m = /^\/(?:admin|staff)\/requests\/(\d+)\//.exec(req.path);
  if (m) id = Number(m[1]);
  else if (/^\/admin\/operations\/dispatch$/.test(req.path)) id = parseInt(req.body && req.body.request_id, 10) || null;
  if (id) res.on('finish', () => { if (res.statusCode < 400) publish(id); });
  next();
}

// Ends every open stream so a server shutdown is not held up by browsers that keep the connection open.
function closeAll() {
  for (const c of clients) {
    try { c.res.end(); } catch (e) { /* already closed */ }
  }
  clients.clear();
}

module.exports = { closeAll, open, openCatalog, broadcastCatalog, publish, broadcastStaff, liveHook, clientCount: () => clients.size };
