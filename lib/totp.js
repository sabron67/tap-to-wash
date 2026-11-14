// Time-based one-time passwords (RFC 6238: HMAC-SHA1, 6 digits, 30-second steps) for admin and staff sign-in.
// Compatible with Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;
const DIGITS = 6;

function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  let bits = 0, val = 0; const out = [];
  for (const ch of String(s).toUpperCase().replace(/=+$/, '')) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newSecret = () => base32(crypto.randomBytes(20)); // 160-bit secret

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP);

// Returns the matching time step (a number) or null. Allows one step either side for clock drift.
function verify(secret, code, ms = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = stepAt(ms);
  let hit = null;
  for (const s of [now - 1, now, now + 1]) {
    const exp = hotp(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(c))) hit = s; // no early exit: constant work
  }
  return hit;
}

const otpauthUri = (secret, account, issuer) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;

// Recovery codes: shown once, stored only as SHA-256 hashes, each usable one time.
const normRecovery = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashRecovery = (c) => crypto.createHash('sha256').update('ttw-recovery|' + normRecovery(c)).digest('hex');
function newRecoveryCodes(n = 8) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const codes = [];
  for (let i = 0; i < n; i++) {
    let s = '';
    for (const b of crypto.randomBytes(10)) s += alphabet[b % alphabet.length];
    codes.push(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return codes;
}

// The authenticator secret is encrypted in the database (AES-256-GCM). Key: TOTP_KEY, else SESSION_SECRET.
const sealKey = () => crypto.createHash('sha256').update('ttw-totp|' + (process.env.TOTP_KEY || process.env.SESSION_SECRET || '')).digest();
function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'tot1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function open(v) {
  const raw = Buffer.from(String(v).replace(/^tot1:/, ''), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

module.exports = { newSecret, verify, stepAt, otpauthUri, newRecoveryCodes, hashRecovery, normRecovery, seal, open, hotp };
