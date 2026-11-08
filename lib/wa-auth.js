// Keeps the WhatsApp login (Baileys credentials and keys) in PostgreSQL instead of files, so it survives Render
// restarts and deploys. One small row per key in the table wa_auth (created automatically).
const { pool } = require('../config/db');

let ready = null;
const ensure = () =>
  (ready =
    ready ||
    pool.query('CREATE TABLE IF NOT EXISTS wa_auth (key TEXT PRIMARY KEY, value TEXT NOT NULL)').catch((err) => {
      ready = null;
      throw err;
    }));

async function usePgAuthState() {
  const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');
  await ensure();
  const write = async (key, value) => {
    await pool.query('INSERT INTO wa_auth (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value, BufferJSON.replacer)]);
  };

  const row = await pool.query('SELECT value FROM wa_auth WHERE key = $1', ['creds']);
  const creds = row.rows.length ? JSON.parse(row.rows[0].value, BufferJSON.reviver) : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          if (!ids.length) return out;
          const names = ids.map((id) => `${type}-${id}`);
          const { rows } = await pool.query(`SELECT key, value FROM wa_auth WHERE key IN (${names.map((_, i) => `$${i + 1}`).join(',')})`, names);
          const byKey = new Map(rows.map((r) => [r.key, r.value]));
          for (const id of ids) {
            const raw = byKey.get(`${type}-${id}`);
            if (!raw) continue;
            let value = JSON.parse(raw, BufferJSON.reviver);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[id] = value;
          }
          return out;
        },
        set: async (data) => {
          const jobs = [];
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const value = data[type][id];
              const key = `${type}-${id}`;
              jobs.push(value ? write(key, value) : pool.query('DELETE FROM wa_auth WHERE key = $1', [key]));
            }
          }
          await Promise.all(jobs);
        },
      },
    },
    saveCreds: () => write('creds', creds),
  };
}

const clearAuth = async () => {
  await ensure();
  await pool.query('DELETE FROM wa_auth');
};

module.exports = { usePgAuthState, clearAuth };
