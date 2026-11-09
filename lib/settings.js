const { pool } = require('../config/db');
const { faviconVersion } = require('./media');
const { DEFAULT_TERMS } = require('./terms');
const { DEFAULT_PRIVACY } = require('./privacy');

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
  terms_text: DEFAULT_TERMS,
  terms_version: '1',
  privacy_text: DEFAULT_PRIVACY,
  privacy_version: '1',
  branches_enabled: '0', // '1' = multi-branch mode (branch picker, assignment and branch tools)
};

async function getSettings() {
  const [{ rows }, iconV] = await Promise.all([pool.query('SELECT key, value FROM settings'), faviconVersion()]);
  const s = { ...DEFAULTS };
  for (const r of rows) {
    if (r.key in DEFAULTS && r.value !== '') s[r.key] = r.value;
  }
  s.icon_v = iconV; // version of the uploaded favicon ('' = none uploaded); used to build the <link rel="icon"> tag
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
