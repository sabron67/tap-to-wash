// Encrypts secrets that are kept in the database (WhatsApp login, push key), so a copy of the database alone is not enough
// to take over the business WhatsApp number. AES-256-GCM. Key: WA_AUTH_KEY if set, otherwise SESSION_SECRET.
// Values are stored as "enc1:<base64>". Plain (older) values are still read and are encrypted the next time they are saved.
const crypto = require('crypto');

const PREFIX = 'enc1:';
const keyMaterial = () => process.env.WA_AUTH_KEY || process.env.SESSION_SECRET || 'dev-only-secret-change-me';
const key = () => crypto.createHash('sha256').update('taptowash-secretbox|' + keyMaterial()).digest();

const isSealed = (v) => typeof v === 'string' && v.startsWith(PREFIX);

function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function open(value) {
  if (!isSealed(value)) return value; // older, unencrypted value
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

module.exports = { seal, open, isSealed };
