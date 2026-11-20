// Leader election for jobs that must run in exactly ONE copy of the app: the WhatsApp connection and the M-Pesa reconciler.
// One PostgreSQL session-level advisory lock decides. The copy that holds it is the leader; if that copy dies, PostgreSQL
// releases the lock and another copy takes over within LEADER_RETRY_MS (default 15 s). With a single copy it simply leads.
//
//   LEADER_ELIGIBLE=0   this copy never becomes leader (it only serves web pages)
const { Client } = require('pg');
const { directConfig, NODE_ID } = require('./bus');

const LOCK_KEY = 727002;
const RETRY_MS = Math.max(3000, Number(process.env.LEADER_RETRY_MS) || 15000);
const eligible = () => process.env.LEADER_ELIGIBLE !== '0';

const elected = [];
const lostFns = [];
let client = null;
let leading = false;
let stopped = false;
let timer = null;
let busy = false;

const run = (fns, label) => {
  for (const fn of fns) {
    try {
      const r = fn();
      if (r && typeof r.catch === 'function') r.catch((e) => console.error(`leader ${label} handler failed:`, e.message));
    } catch (e) {
      console.error(`leader ${label} handler failed:`, e.message);
    }
  }
};

function drop(reason) {
  const c = client;
  client = null;
  if (c) c.removeAllListeners(), c.on('error', () => {}), c.end().catch(() => {});
  if (leading) {
    leading = false;
    console.warn(`This copy (${NODE_ID}) is no longer the leader (${reason}).`);
    run(lostFns, 'lost');
  }
}

async function attempt() {
  if (stopped || busy || !eligible()) return;
  busy = true;
  try {
    if (leading && client) {
      await client.query('SELECT 1'); // heartbeat: a dead connection means the lock is gone
      return;
    }
    const c = new Client(directConfig());
    c.on('error', (e) => drop(e.message));
    c.on('end', () => drop('connection closed'));
    await c.connect();
    const { rows } = await c.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (rows[0].ok) {
      client = c;
      leading = true;
      console.log(`This copy (${NODE_ID}) is the leader: it runs WhatsApp and the M-Pesa reconciler.`);
      run(elected, 'elected');
    } else {
      c.removeAllListeners();
      c.on('error', () => {});
      await c.end().catch(() => {});
    }
  } catch (e) {
    drop(e.message);
  } finally {
    busy = false;
  }
}

function start() {
  stopped = false;
  if (timer) return;
  attempt();
  timer = setInterval(attempt, RETRY_MS);
  timer.unref();
}

async function stop() {
  stopped = true;
  clearInterval(timer);
  timer = null;
  const c = client;
  client = null;
  if (c) {
    c.removeAllListeners();
    c.on('error', () => {});
    await c.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await c.end().catch(() => {});
  }
  if (leading) {
    leading = false;
    run(lostFns, 'lost');
  }
}

module.exports = {
  start,
  stop,
  isLeader: () => leading,
  onElected: (fn) => elected.push(fn),
  onLost: (fn) => lostFns.push(fn),
};
