// Self-service password reset for staff (admins) and customer accounts.
// A 6-digit code is sent by WhatsApp to the number saved on the account, is valid for 15 minutes, allows 5 wrong tries
// and works once. If the email is not registered the person is told so (notFound), so they can fix a typo.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { passwordProblem } = require('./password');
const wa = require('./whatsapp');

const TTL_MINUTES = 15;
const MAX_TRIES = 5;
const COOLDOWN_SECONDS = 60;
const KINDS = {
  admin: { table: 'admins', session: 'admin' },
  customer: { table: 'accounts', session: 'account' },
};

let ready = null;
const ensureTable = () =>
  (ready =
    ready ||
    pool
      .query(
        `CREATE TABLE IF NOT EXISTS password_resets (
           id SERIAL PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('admin','customer')), user_id INTEGER NOT NULL, code_hash TEXT NOT NULL,
           attempts INTEGER NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
         CREATE INDEX IF NOT EXISTS password_resets_lookup_idx ON password_resets(kind, user_id, created_at DESC);`
      )
      .catch((err) => {
        ready = null;
        throw err;
      }));

const hashCode = (kind, id, code) =>
  crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev-only-secret-change-me').update(`${kind}:${id}:${code}`).digest('hex');

const same = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function findUser(kind, email) {
  const { rows } = await pool.query(`SELECT id, name, email, phone, is_active FROM ${KINDS[kind].table} WHERE email = $1`, [String(email || '').trim().toLowerCase()]);
  return rows[0] || null;
}

// Asks for a code. Returns { available, problem }.
// problem: 'notFound' (no account with that email), 'disabled', 'noPhone' or 'wait' (a code was sent under a minute ago).
// available is false when no automatic WhatsApp sender is linked.
async function requestCode(kind, email, business) {
  const u = await findUser(kind, email);
  if (!u) return { available: true, problem: 'notFound' };
  if (!wa.canSend()) return { available: false };
  await ensureTable();
  if (!u.is_active) return { available: true, problem: 'disabled' };
  if (!wa.validWaNumber(u.phone)) return { available: true, problem: 'noPhone' };
  const recent = await pool.query(`SELECT 1 FROM password_resets WHERE kind = $1 AND user_id = $2 AND created_at > now() - ($3::text || ' seconds')::interval`, [kind, u.id, String(COOLDOWN_SECONDS)]);
  if (recent.rows.length) return { available: true, problem: 'wait' };
  const code = String(crypto.randomInt(100000, 1000000));
  await pool.query('UPDATE password_resets SET used_at = now() WHERE kind = $1 AND user_id = $2 AND used_at IS NULL', [kind, u.id]);
  const ins = await pool.query(`INSERT INTO password_resets (kind, user_id, code_hash, expires_at) VALUES ($1,$2,$3, now() + ($4::text || ' minutes')::interval) RETURNING id`, [
    kind,
    u.id,
    hashCode(kind, u.id, code),
    String(TTL_MINUTES),
  ]);
  const sent = await wa.send(u.phone, `${business}: your password reset code is ${code}. It works for ${TTL_MINUTES} minutes. If you did not ask for it, ignore this message and do not share the code.`);
  if (!sent.ok) {
    await pool.query('DELETE FROM password_resets WHERE id = $1', [ins.rows[0].id]);
    console.error('Reset code could not be sent:', sent.error);
  }
  return { available: true, user: u };
}

// Checks the code and sets the new password. Returns { ok, error, user }.
async function completeReset(kind, email, code, password, confirm) {
  await ensureTable();
  const bad = { ok: false, error: 'That code is not correct or has expired. Ask for a new one.' };
  const u = await findUser(kind, email);
  const cleanCode = String(code || '').replace(/\D/g, '');
  if (!u || !u.is_active || cleanCode.length !== 6) return bad;
  const { rows } = await pool.query(
    `SELECT id, code_hash, attempts FROM password_resets WHERE kind = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`,
    [kind, u.id]
  );
  const r = rows[0];
  if (!r || r.attempts >= MAX_TRIES) return bad;
  if (!same(r.code_hash, hashCode(kind, u.id, cleanCode))) {
    await pool.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [r.id]);
    return bad;
  }
  const problem = passwordProblem(password, { email: u.email, name: u.name });
  if (problem) return { ok: false, error: problem, codeOk: true };
  if (password !== confirm) return { ok: false, error: 'The passwords do not match.', codeOk: true };

  const hash = await bcrypt.hash(String(password), 12);
  await pool.query(`UPDATE ${KINDS[kind].table} SET password_hash = $1, must_change_password = FALSE, failed_attempts = 0, locked_until = NULL WHERE id = $2`, [hash, u.id]);
  await pool.query('UPDATE password_resets SET used_at = now() WHERE kind = $1 AND user_id = $2 AND used_at IS NULL', [kind, u.id]);
  // Sign the person out everywhere (anyone using the old password loses access).
  try {
    await pool.query(`DELETE FROM session WHERE (sess::jsonb -> $1::text ->> 'id') = $2::text`, [KINDS[kind].session, String(u.id)]);
  } catch (err) {
    console.error('Could not clear old sessions:', err.message);
  }
  return { ok: true, user: u };
}

// Plain-language message for a problem returned by requestCode ('' when there is none).
function problemMessage(problem, kind) {
  const staff = kind === 'admin';
  switch (problem) {
    case 'notFound':
      return staff ? 'Email not found. No staff account uses that email. Check the spelling and try again.' : 'Email not found. There is no account with that email. Check the spelling, or create an account.';
    case 'disabled':
      return staff ? 'This staff account is switched off. Please ask the owner.' : 'This account is switched off. Please contact us for help.';
    case 'noPhone':
      return staff ? 'This account has no valid WhatsApp number saved, so a code cannot be sent. Ask the owner to reset your password under Staff.' : 'This account has no valid WhatsApp number saved, so a code cannot be sent. Please contact us and we will reset your password for you.';
    case 'wait':
      return 'A code was sent a moment ago. Please wait a minute before asking for another.';
    default:
      return '';
  }
}

module.exports = { requestCode, completeReset, problemMessage, TTL_MINUTES };
