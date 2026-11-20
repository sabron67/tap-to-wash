const crypto = require('crypto');

const STATUSES = [
  { key: 'new', label: 'New', icon: 'bell', color: '#D97706' },
  { key: 'confirmed', label: 'Confirmed', icon: 'circle-check', color: '#2563EB' },
  { key: 'rider_arrived', label: 'Rider arrived', icon: 'map-pin', color: '#7C3AED' },
  { key: 'picked_up', label: 'Picked up', icon: 'truck', color: '#C2307A' },
  { key: 'washing', label: 'Washing', icon: 'droplets', color: '#0A8FA6' },
  { key: 'ready', label: 'Ready', icon: 'shopping-basket', color: '#B7791F' },
  { key: 'delivered', label: 'Delivered', icon: 'package-check', color: '#00A63E' },
  { key: 'cancelled', label: 'Cancelled', icon: 'circle-x', color: '#C8323B' },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
const FLOW = ['new', 'confirmed', 'rider_arrived', 'picked_up', 'washing', 'ready', 'delivered'];

// Forward-only rule: an order never moves backward through FLOW. Delivered and cancelled are final.
// Returns '' when the move is allowed, otherwise a plain-language reason.
const backwardBlocker = (from, to) => {
  if (!from || from === to) return '';
  if (from === 'cancelled') return `Order status cannot move backward: a cancelled order cannot be re-opened (cancelled -> ${to}).`;
  if (from === 'delivered') return `Order status cannot move backward: a delivered order is final (delivered -> ${to}).`;
  if (to === 'cancelled') return '';
  const a = FLOW.indexOf(from);
  const b = FLOW.indexOf(to);
  if (a >= 0 && b >= 0 && b < a) return `Order status cannot move backward (${from} -> ${to}). Statuses only move forward.`;
  return '';
};

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
  for (const b of crypto.randomBytes(10)) s += alphabet[b % alphabet.length]; // 31^10, about 50 bits
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

// True for requests sent by the site's own scripts (public/js/ajax-delete.js): they get JSON back instead of a redirect.
const wantsJson = (req) => req.get('x-requested-with') === 'ttw-fetch';
// Where the app is mounted for this login (each login has its own /s_xxxx prefix, see lib/slots.js). JSON links need it added by hand.
const withBase = (req, path) => (req.base || '') + path;

// Express 4 does not catch rejected promises, so wrap async handlers.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const cleanText = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const cleanMultiline = (v, max) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, max);

// "Areas we serve": one place per line (commas also work). Trims, removes empty and repeated names, keeps at most 30 places of 60 characters.
function parseAreas(text) {
  const seen = new Set();
  const out = [];
  for (const part of String(text || '').split(/[\n\r,;]+/)) {
    const name = part.replace(/\s+/g, ' ').trim().slice(0, 60);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 30) break;
  }
  return out;
}

module.exports = {
  wantsJson,
  withBase,
  parseAreas,
  STATUSES,
  STATUS_MAP,
  FLOW,
  backwardBlocker,
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
