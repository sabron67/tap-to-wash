// Cluster message bus over PostgreSQL LISTEN / NOTIFY, so several copies of the app behave like one.
// No extra service (Redis etc.) is needed: every copy listens on one channel and every message reaches ALL copies,
// including the sender. Used for live updates (SSE), settings reloads and the WhatsApp owner.
//
//   bus.on('type', (data, meta) => ...)   listen for a message type
//   bus.emit('type', data)                send it to every copy (delivered locally at once if the bus is not connected yet)
//   bus.on('connected', fn)               runs each time the listener (re)connects: re-read anything that may have been missed
//
// Set DATABASE_DIRECT_URL when DATABASE_URL points at PgBouncer in transaction mode (LISTEN and advisory locks need a
// direct or session-mode connection). Without it, DATABASE_URL is used.
const os = require('os');
const { Client } = require('pg');
const { pool, buildConfig } = require('../config/db');

const CHANNEL = 'ttw_bus';
const MAX_PAYLOAD = 7500; // PostgreSQL limits a NOTIFY payload to 8000 bytes
const NODE_ID = process.env.INSTANCE_ID || `${os.hostname()}-${process.pid}`;

const directConfig = () => buildConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL });

const handlers = new Map();
let client = null;
let connected = false;
let stopped = false;
let retryMs = 1000;
let retryTimer = null;

function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
}

function dispatch(type, data, meta) {
  for (const fn of handlers.get(type) || []) {
    try {
      const r = fn(data, meta);
      if (r && typeof r.catch === 'function') r.catch((e) => console.error(`bus handler "${type}" failed:`, e.message));
    } catch (e) {
      console.error(`bus handler "${type}" failed:`, e.message);
    }
  }
}

async function emit(type, data = {}) {
  const text = JSON.stringify({ t: type, d: data, from: NODE_ID });
  if (Buffer.byteLength(text) > MAX_PAYLOAD) throw new Error('Bus message too large');
  if (!connected) return dispatch(type, data, { from: NODE_ID, local: true }); // alone (or still starting): nobody else could hear it anyway
  try {
    await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, text]);
  } catch (e) {
    console.error('bus emit failed:', e.message);
    dispatch(type, data, { from: NODE_ID, local: true });
  }
}

function scheduleReconnect() {
  if (stopped || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, retryMs);
  retryTimer.unref();
  retryMs = Math.min(retryMs * 2, 15000);
}

function lost(err) {
  if (err) console.error('Bus connection lost:', err.message);
  connected = false;
  const c = client;
  client = null;
  if (c) c.removeAllListeners(), c.on('error', () => {}), c.end().catch(() => {});
  scheduleReconnect();
}

async function connect() {
  if (stopped || client) return;
  const c = new Client(directConfig());
  client = c;
  c.on('error', (e) => lost(e));
  c.on('end', () => lost());
  c.on('notification', (msg) => {
    try {
      const m = JSON.parse(msg.payload);
      dispatch(m.t, m.d, { from: m.from, local: m.from === NODE_ID });
    } catch (e) {
      /* not ours */
    }
  });
  try {
    await c.connect();
    await c.query(`LISTEN ${CHANNEL}`);
    connected = true;
    retryMs = 1000;
    dispatch('connected', {}, { from: NODE_ID, local: true });
  } catch (e) {
    lost(e);
  }
}

const start = () => {
  stopped = false;
  return connect();
};

async function stop() {
  stopped = true;
  clearTimeout(retryTimer);
  retryTimer = null;
  connected = false;
  const c = client;
  client = null;
  if (c) {
    c.removeAllListeners();
    c.on('error', () => {});
    await c.end().catch(() => {});
  }
}

module.exports = { NODE_ID, on, emit, start, stop, directConfig, isConnected: () => connected };
