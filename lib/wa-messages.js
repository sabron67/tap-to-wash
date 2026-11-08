// Remembers the messages the server has sent so WhatsApp can ask for them again.
//
// Why this exists: when a phone cannot decrypt a message it asks the sender to send it again. Baileys can only answer
// that request if it can look the original message up (the getMessage option). Without it the phone shows
// "Waiting for this message. This may take a while." forever. Messages are kept in memory and in PostgreSQL
// (table wa_messages, created automatically) so a retry still works after a restart or deploy. Old rows are removed.
const { pool } = require('../config/db');

const KEEP_DAYS = 3;
const MEM_MAX = 500;
const mem = new Map();

let ready = null;
let lastPrune = 0;

const ensure = () =>
  (ready =
    ready ||
    pool
      .query('CREATE TABLE IF NOT EXISTS wa_messages (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())')
      .catch((err) => {
        ready = null;
        throw err;
      }));

async function prune() {
  lastPrune = Date.now();
  await pool.query(`DELETE FROM wa_messages WHERE created_at < now() - interval '${KEEP_DAYS} days'`);
}

// Stores the content of a message (the proto.Message object, e.g. { conversation: 'Hello' }) under its WhatsApp id.
async function remember(id, message) {
  if (!id || !message) return;
  mem.set(id, message);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
  try {
    const { BufferJSON } = require('@whiskeysockets/baileys');
    await ensure();
    await pool.query('INSERT INTO wa_messages (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [id, JSON.stringify(message, BufferJSON.replacer)]);
    if (Date.now() - lastPrune > 6 * 60 * 60 * 1000) await prune();
  } catch (err) {
    console.error('WhatsApp message could not be saved for retries:', err.message);
  }
}

// Used as Baileys' getMessage: returns the stored message or undefined.
async function recall(id) {
  if (!id) return undefined;
  if (mem.has(id)) return mem.get(id);
  try {
    const { BufferJSON, proto } = require('@whiskeysockets/baileys');
    await ensure();
    const { rows } = await pool.query('SELECT data FROM wa_messages WHERE id = $1', [id]);
    if (!rows.length) return undefined;
    return proto.Message.fromObject(JSON.parse(rows[0].data, BufferJSON.reviver));
  } catch (err) {
    return undefined;
  }
}

const clearMessages = async () => {
  mem.clear();
  await ensure();
  await pool.query('DELETE FROM wa_messages');
};

module.exports = { remember, recall, clearMessages };
