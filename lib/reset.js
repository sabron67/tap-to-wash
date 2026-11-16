// Self-service password reset for staff (admins) and customer accounts.
// A 6-digit code is sent by WhatsApp to the number saved on the account, is valid for 15 minutes, allows 5 wrong tries
// and works once. The pages never reveal whether an email has an account: callers show the same message for every problem.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { passwordProblem } = require('./password');
const wa = require('./whatsapp');
const mailer = require('./mailer');

const TTL_MINUTES = 15;

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The reset email: inline styles and tables only (what email apps support), green brand colour, light layout that stays readable in dark mode.
function resetEmailHtml(business, name, code) {
  const first = esc(String(name || '').split(' ')[0] || 'there');
  const digits = String(code).split('').map((d) => `<td style="width:42px;height:54px;background:#F3F7F4;border:1px solid #CFE3D6;border-radius:8px;text-align:center;font:700 28px/54px 'Courier New',monospace;color:#085F30">${d}</td>`).join('<td style="width:6px"></td>');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#EBEBE4">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your ${esc(business)} password reset code is ${code}. It works for ${TTL_MINUTES} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBEBE4"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FBFBF8;border-radius:14px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1B1B1A">
<tr><td style="background:#0B7A3E;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.2px">${esc(business)}</td></tr>
<tr><td style="padding:28px 28px 8px">
<h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;color:#1B1B1A">Reset your password</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3A3A37">Hello ${first}, use this code to choose a new password:</p>
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 18px"><tr>${digits}</tr></table>
<p style="margin:0 0 6px;text-align:center;font-size:14px;color:#3A3A37">It works for <strong>${TTL_MINUTES} minutes</strong> and can be used once.</p>
</td></tr>
<tr><td style="padding:12px 28px 28px">
<div style="border-top:1px solid #E2E2DA;padding-top:16px;font-size:13px;line-height:1.55;color:#6B6B66">Did not ask for this? Ignore this email: your password stays the same. Never share this code with anyone, including ${esc(business)} staff.</div>
</td></tr></table>
<p style="margin:14px 0 0;font:12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6B6B66">Sent by ${esc(business)}. Please do not reply to this email.</p>
</td></tr></table></body></html>`;
}
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
// available is false when neither WhatsApp nor email can send a code right now.
// The code goes to WhatsApp when it is linked and the account has a number; otherwise (or if WhatsApp fails) to the account's own email.
async function requestCode(kind, email, business) {
  if (!wa.canSend() && !mailer.enabled()) return { available: false }; // checked first, so the answer is the same for every email
  const u = await findUser(kind, email);
  if (!u) return { available: true, problem: 'notFound' };
  await ensureTable();
  if (!u.is_active) return { available: true, problem: 'disabled' };
  const canWa = wa.canSend() && wa.validWaNumber(u.phone);
  const canMail = mailer.enabled() && mailer.validEmail(u.email);
  if (!canWa && !canMail) return { available: true, problem: 'noPhone' };
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
  const text = `${business}: your password reset code is ${code}. It works for ${TTL_MINUTES} minutes. If you did not ask for it, ignore this message and do not share the code.`;
  let sent = { ok: false, error: 'No sender available' };
  if (canWa) sent = await wa.send(u.phone, text);
  if (!sent.ok && canMail) {
    if (canWa) console.warn('Reset code: WhatsApp failed (' + sent.error + '), sending by email instead.');
    sent = await mailer.send(u.email, `${code} is your ${business} password reset code`, `${text}`, resetEmailHtml(business, u.name, code));
  }
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
      return staff ? 'This account has no WhatsApp number or email that a code can be sent to. Ask the owner to reset your password under Staff.' : 'This account has no WhatsApp number or email that a code can be sent to. Please contact us and we will reset your password for you.';
    case 'wait':
      return 'A code was sent a moment ago. Please wait a minute before asking for another.';
    default:
      return '';
  }
}

module.exports = { requestCode, completeReset, problemMessage, TTL_MINUTES };
