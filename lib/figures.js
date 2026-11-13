// Business figures (capacity, costs, prices) used by the Excel report's Inputs sheet.
// Stored in the business_figures table (db/schema.sql seeds one row per figure). Anything not set still shows the sample value in the report.
const { pool } = require('../config/db');

// kind: int | dec | money | pct (typed as a percentage, e.g. 16, and stored as a fraction, e.g. 0.16)
const SECTIONS = ['Pricing', 'Capacity', 'Variable costs', 'Fixed costs per month', 'Equipment'];
const FIGURES = [
  { key: 'price_kg', section: 'Pricing', label: 'Average selling price per kg ({cur})', kind: 'money', def: null, min: 0, note: 'Leave blank to use the average of your services priced per kg.' },
  { key: 'vat', section: 'Pricing', label: 'VAT rate (%)', kind: 'pct', def: 0.16, min: 0, max: 100, note: 'Kenya standard rate is 16%. Use 0 if you are not VAT-registered.' },
  { key: 'discount', section: 'Pricing', label: 'Standard discount on quotes (%)', kind: 'pct', def: 0, min: 0, max: 100 },
  { key: 'delivery_fee', section: 'Pricing', label: 'Delivery fee charged per order ({cur})', kind: 'money', def: 100, min: 0 },
  { key: 'target', section: 'Pricing', label: 'Target profit margin (%)', kind: 'pct', def: 0.3, min: 0, max: 95 },
  { key: 'machines', section: 'Capacity', label: 'Number of washing machines', kind: 'int', def: 2, min: 1 },
  { key: 'cap_kg', section: 'Capacity', label: 'Capacity of one load (kg)', kind: 'dec', def: 10, min: 0.1 },
  { key: 'loads_day', section: 'Capacity', label: 'Loads per machine per day', kind: 'dec', def: 6, min: 0.1 },
  { key: 'days', section: 'Capacity', label: 'Working days per month', kind: 'int', def: 26, min: 1, max: 31 },
  { key: 'util', section: 'Capacity', label: 'Expected utilisation of capacity (%)', kind: 'pct', def: 0.7, min: 1, max: 100 },
  { key: 'exp_kg', section: 'Capacity', label: 'Expected kilograms washed per month', kind: 'dec', def: 1500, min: 0 },
  { key: 'kg_order', section: 'Capacity', label: 'Average kg per order', kind: 'dec', def: 6, min: 0.1 },
  { key: 'water_l_load', section: 'Variable costs', label: 'Water used per load (litres)', kind: 'dec', def: 60, min: 0 },
  { key: 'water_m3', section: 'Variable costs', label: 'Water price ({cur} per cubic metre)', kind: 'money', def: 150, min: 0 },
  { key: 'kwh_load', section: 'Variable costs', label: 'Electricity per load (kWh)', kind: 'dec', def: 2.5, min: 0 },
  { key: 'kwh_price', section: 'Variable costs', label: 'Electricity price ({cur} per kWh)', kind: 'money', def: 28, min: 0 },
  { key: 'det_load', section: 'Variable costs', label: 'Detergent and softener per load ({cur})', kind: 'money', def: 25, min: 0 },
  { key: 'pack_kg', section: 'Variable costs', label: 'Packaging per kg ({cur})', kind: 'money', def: 5, min: 0 },
  { key: 'del_order', section: 'Variable costs', label: 'Delivery cost per order ({cur})', kind: 'money', def: 150, min: 0 },
  { key: 'fee_pct', section: 'Variable costs', label: 'Payment fees (% of sales)', kind: 'pct', def: 0.01, min: 0, max: 100 },
  { key: 'rent', section: 'Fixed costs per month', label: 'Rent ({cur})', kind: 'money', def: 20000, min: 0 },
  { key: 'wages', section: 'Fixed costs per month', label: 'Wages and salaries ({cur})', kind: 'money', def: 30000, min: 0 },
  { key: 'util_fixed', section: 'Fixed costs per month', label: 'Fixed utilities and internet ({cur})', kind: 'money', def: 3000, min: 0 },
  { key: 'marketing', section: 'Fixed costs per month', label: 'Marketing ({cur})', kind: 'money', def: 2000, min: 0 },
  { key: 'maint', section: 'Fixed costs per month', label: 'Machine repairs and servicing ({cur})', kind: 'money', def: 2000, min: 0 },
  { key: 'other_fixed', section: 'Fixed costs per month', label: 'Other fixed costs ({cur})', kind: 'money', def: 2000, min: 0 },
  { key: 'machine_cost', section: 'Equipment', label: 'Cost of one machine ({cur})', kind: 'money', def: 150000, min: 0 },
  { key: 'life', section: 'Equipment', label: 'Useful life of a machine (months)', kind: 'int', def: 60, min: 1 },
];
const BY_KEY = Object.fromEntries(FIGURES.map((f) => [f.key, f]));

// -> { key: { value, saved } } where value is in report units (percentages as fractions). Reads the business_figures table.
async function getFigures() {
  const { rows } = await pool.query('SELECT key, value, is_set FROM business_figures WHERE is_set AND value IS NOT NULL');
  const out = {};
  for (const r of rows) if (BY_KEY[r.key]) out[r.key] = { value: Number(r.value), saved: true };
  return out;
}

const cleanLabel = (f) => f.label.replace(' ({cur})', '').replace(/\{cur\}/g, '').replace(/ \(\)/g, '');
const SORT = Object.fromEntries(FIGURES.map((f, i) => [f.key, i + 1]));

// Blank = go back to the sample figure. Returns { problems: [] } and saves nothing when anything is invalid.
async function saveFigures(body, adminId = null) {
  const set = [], clear = [], problems = [];
  for (const f of FIGURES) {
    const raw = String(body[f.key] ?? '').trim().replace(/,/g, '');
    if (raw === '') { clear.push(f); continue; }
    let n = Number(raw);
    const name = f.label.replace(' ({cur})', '').replace(/ \(.*\)$/, '');
    if (!Number.isFinite(n)) { problems.push(`${name}: enter a number.`); continue; }
    if (f.min !== undefined && n < f.min) { problems.push(`${name}: must be at least ${f.min}.`); continue; }
    if (f.max !== undefined && n > f.max) { problems.push(`${name}: must be at most ${f.max}.`); continue; }
    if (f.kind === 'int' && !Number.isInteger(n)) { problems.push(`${name}: use a whole number.`); continue; }
    if (f.kind === 'pct') n = Math.round(n * 100) / 10000; // 16 -> 0.16
    set.push([f, n]);
  }
  if (problems.length) return { problems };
  // Upsert, so a row that was deleted by hand is simply created again.
  const sql = `INSERT INTO business_figures (key, section, label, kind, value, sample, is_set, sort_order, updated_at, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_set = EXCLUDED.is_set, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [f, n] of set) await client.query(sql, [f.key, f.section, cleanLabel(f), f.kind, n, f.def, true, SORT[f.key], adminId]);
    for (const f of clear) await client.query(sql, [f.key, f.section, cleanLabel(f), f.kind, f.def, f.def, false, SORT[f.key], adminId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { problems: [], saved: set.length };
}

module.exports = { FIGURES, SECTIONS, getFigures, saveFigures };
