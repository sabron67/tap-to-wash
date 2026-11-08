// Keeps the WhatsApp Web login (whatsapp-web.js RemoteAuth) in PostgreSQL instead of files,
// so it survives Render restarts and deploys. The session is a small zip stored in one row.
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

class PgStore {
  constructor(dataPath) {
    this.dataPath = path.resolve(dataPath);
    this.ready = null;
  }

  ensure() {
    this.ready =
      this.ready ||
      pool
        .query(`CREATE TABLE IF NOT EXISTS wa_sessions (session TEXT PRIMARY KEY, data BYTEA NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
        .catch((err) => {
          this.ready = null;
          throw err;
        });
    return this.ready;
  }

  async sessionExists({ session }) {
    await this.ensure();
    const { rows } = await pool.query('SELECT 1 FROM wa_sessions WHERE session = $1', [session]);
    return rows.length > 0;
  }

  // RemoteAuth has just written <dataPath>/<session>.zip - store it.
  async save({ session }) {
    await this.ensure();
    const file = path.join(this.dataPath, `${session}.zip`);
    const data = await fs.promises.readFile(file);
    await pool.query(
      `INSERT INTO wa_sessions (session, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (session) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [session, data]
    );
  }

  // Writes the stored zip to `path` so RemoteAuth can unpack it before the browser starts.
  async extract({ session, path: outPath }) {
    await this.ensure();
    const { rows } = await pool.query('SELECT data FROM wa_sessions WHERE session = $1', [session]);
    if (!rows.length) throw new Error('No saved WhatsApp session');
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, rows[0].data);
  }

  async delete({ session }) {
    await this.ensure();
    await pool.query('DELETE FROM wa_sessions WHERE session = $1', [session]);
  }
}

module.exports = { PgStore };
