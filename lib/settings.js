const { pool } = require('../config/db');

const DEFAULTS = {
  business_name: 'Tap to Wash',
  tagline: 'Laundry day? Just tap.',
  about: 'We pick up, wash, dry, fold and deliver - fresh, fast and fuss-free.',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  opening_hours: 'Mon–Sat · 7:00 AM – 7:00 PM',
  currency: 'KES',
};

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const s = { ...DEFAULTS };
  for (const r of rows) {
    if (r.key in DEFAULTS && r.value !== '') s[r.key] = r.value;
  }
  return s;
}

async function saveSettings(values) {
  for (const key of Object.keys(DEFAULTS)) {
    if (values[key] === undefined) continue;
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, String(values[key])]
    );
  }
}

module.exports = { DEFAULTS, getSettings, saveSettings };
