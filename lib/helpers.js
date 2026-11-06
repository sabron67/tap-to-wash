const crypto = require('crypto');

const STATUSES = [
  { key: 'new', label: 'New', icon: '✨', color: '#f59e0b' },
  { key: 'confirmed', label: 'Confirmed', icon: '✅', color: '#3b82f6' },
  { key: 'picked_up', label: 'Picked up', icon: '🚚', color: '#8b5cf6' },
  { key: 'washing', label: 'Washing', icon: '🫧', color: '#06b6d4' },
  { key: 'ready', label: 'Ready', icon: '🧺', color: '#10b981' },
  { key: 'delivered', label: 'Delivered', icon: '🎉', color: '#22c55e' },
  { key: 'cancelled', label: 'Cancelled', icon: '✖️', color: '#ef4444' },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
const FLOW = ['new', 'confirmed', 'picked_up', 'washing', 'ready', 'delivered'];

const nextStatus = (current) => {
  const i = FLOW.indexOf(current);
  return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1] : null;
};

// Last 9 digits - lets 0712 345 678 and +254 712 345 678 match as the same customer.
const phoneKey = (phone) => String(phone || '').replace(/\D/g, '').slice(-9);
const validPhone = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 9 && d.length <= 15;
};

function genRef() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(6)) s += alphabet[b % alphabet.length];
  return `TTW-${s}`;
}

const money = (n, currency = 'KES') =>
  `${currency} ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const fmtDate = (d) =>
  d
    ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(d))
    : '';

const mapsLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

const paymentState = (total, paid) => {
  total = Number(total || 0);
  paid = Number(paid || 0);
  if (total <= 0) return { key: 'unpriced', label: 'Not priced' };
  if (paid >= total) return { key: 'paid', label: 'Paid' };
  if (paid > 0) return { key: 'partial', label: 'Part paid' };
  return { key: 'unpaid', label: 'Unpaid' };
};

// Express 4 does not catch rejected promises, so wrap async handlers.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const cleanText = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const cleanMultiline = (v, max) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, max);

module.exports = {
  STATUSES,
  STATUS_MAP,
  FLOW,
  nextStatus,
  phoneKey,
  validPhone,
  genRef,
  money,
  fmtDate,
  mapsLink,
  paymentState,
  wrap,
  cleanText,
  cleanMultiline,
};
