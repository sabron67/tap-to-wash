// Keeps the WhatsApp login (Baileys credentials and keys) in PostgreSQL instead of files, so it survives Render
// restarts and deploys. One small row per key in the table wa_auth (created automatically).
const { pool } = require('../config/db');
const { seal, open, isSealed } = require('./secretbox');

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
    await pool.query('INSERT INTO wa_auth (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, seal(JSON.stringify(value, BufferJSON.replacer))]);
  };

  // One-time upgrade: encrypt any rows saved by an older version.
  const plain = await pool.query("SELECT key, value FROM wa_auth WHERE value NOT LIKE 'enc1:%'");
  for (const p of plain.rows) await pool.query('UPDATE wa_auth SET value = $1 WHERE key = $2', [seal(p.value), p.key]);

  const row = await pool.query('SELECT value FROM wa_auth WHERE key = $1', ['creds']);
  let creds;
  try {
    creds = row.rows.length ? JSON.parse(open(row.rows[0].value), BufferJSON.reviver) : initAuthCreds();
  } catch (e) {
    // The encryption key changed (WA_AUTH_KEY / SESSION_SECRET): the saved login cannot be read. Start fresh; a new QR scan is needed.
    console.error('WhatsApp login could not be decrypted (key changed?). Starting a new login:', e.message);
    await pool.query('DELETE FROM wa_auth');
    creds = initAuthCreds();
  }

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
            let value;
            try { value = JSON.parse(open(raw), BufferJSON.reviver); } catch (_) { continue; }
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

// Forgets the encryption sessions with other phones (but keeps the link to the business phone, so no new QR code is needed).
// WhatsApp then builds fresh sessions on the next message. This is the cure when recipients see "Waiting for this message".
const clearSessions = async () => {
  await ensure();
  await pool.query(`DELETE FROM wa_auth WHERE key LIKE 'session-%' OR key LIKE 'sender-key-%' OR key LIKE 'sender-key-memory-%'`);
};

module.exports = { usePgAuthState, clearAuth, clearSessions };
