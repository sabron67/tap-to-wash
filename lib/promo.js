// Promotions: a timed popup ad plus an automatic discount.
// While a promotion is running, every new request is stamped with the promotion's auto-generated code
// (requests.discount_code). The normal billing code then takes the discount off the bill, so nobody has to type a code.
const crypto = require('crypto');
const { pool } = require('../config/db');

const PROMO_PREFIX = 'PROMO-';
const isPromoCode = (code) => String(code || '').startsWith(PROMO_PREFIX);

// Short, readable code (no 0/O/1/I): PROMO-7K3QXA
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return PROMO_PREFIX + s;
}

// The promotion running right now (newest first if the admin scheduled two at once), or null.
async function livePromotion(db = pool) {
  const { rows } = await db.query(
    `SELECT id, title, message, code, discount_type, value, starts_at, ends_at
       FROM promotions WHERE starts_at <= now() AND ends_at >= now() ORDER BY created_at DESC LIMIT 1`
  );
  return rows[0] || null;
}

// Discount for a promo code on one request. Valid only if the request was made while the promotion was running.
// Returns { discount } or null when the code is not a promotion that covers this request.
async function promoDiscount(db, code, subtotal, requestId) {
  if (!isPromoCode(code)) return null;
  const { rows } = await db.query(
    `SELECT p.discount_type, p.value FROM promotions p JOIN requests r ON r.id = $2
      WHERE p.code = $1 AND r.created_at >= p.starts_at AND r.created_at <= p.ends_at`,
    [code, requestId]
  );
  if (!rows.length) return null;
  const raw = rows[0].discount_type === 'percent' ? (subtotal * Number(rows[0].value)) / 100 : Number(rows[0].value);
  return { discount: Math.round((Math.min(subtotal, Math.max(0, raw)) + Number.EPSILON) * 100) / 100 };
}

module.exports = { PROMO_PREFIX, isPromoCode, generateCode, livePromotion, promoDiscount };
