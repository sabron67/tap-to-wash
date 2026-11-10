// Creates the tables and seeds a first admin, default settings and starter categories.
// Run with:  npm run db:init
process.env.DB_STATEMENT_TIMEOUT_MS = '0'; // set-up and backup scripts may run long queries
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { DEFAULTS } = require('../lib/settings');
const { categoryIconName } = require('../lib/icons');
const { passwordProblem } = require('../lib/password');

const STARTER_CATEGORIES = [
  ['Everyday Clothes', 'T-shirts, trousers, dresses and daily wear.', 'shirt', '#c2663a', 150, 'kg', 1],
  ['Bedding & Duvets', 'Sheets, blankets, duvets and pillow cases.', 'bed-double', '#d99a4e', 400, 'item', 2],
  ['Suits & Formal Wear', 'Suits, coats, uniforms and dress shirts.', 'briefcase-business', '#a8707f', 500, 'item', 3],
  ['Curtains', 'Curtains and drapes, washed and pressed.', 'blinds', '#b8935a', 350, 'item', 4],
  ['Shoes & Sneakers', 'Deep clean for sneakers and casual shoes.', 'footprints', '#8c6a52', 300, 'pair', 5],
  ['Carpets & Rugs', 'Deep wash and dry for carpets and rugs.', 'layers', '#c98b6b', 250, 'sq m', 6],
];

// Older versions used green/blue starter colours and emoji icons. Move those to the current look.
const OLD_COLOURS = { '#10b981': '#c2663a', '#14b8a6': '#b8935a', '#84cc16': '#d99a4e', '#22d3ee': '#c2663a', '#38bdf8': '#c98b6b', '#34d399': '#d6b48a' };

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and edit it first.');
    process.exit(1);
  }

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[ok] Tables are ready');

  // Fast "contains" search for the admin search boxes (ILIKE '%text%'). Needs the pg_trgm extension; skipped if the host does not allow it.
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS requests_ref_trgm      ON requests  USING gin (ref_code gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS requests_loc_trgm      ON requests  USING gin (location_description gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS customers_name_trgm    ON customers USING gin (name gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS customers_phone_trgm   ON customers USING gin (phone gin_trgm_ops);`);
    console.log('[ok] Search indexes (pg_trgm) are ready');
  } catch (err) {
    console.log(`[--] Search indexes skipped (${err.message}). Searching still works, just without the speed-up.`);
  }

  const admins = await pool.query('SELECT COUNT(*)::int AS n FROM admins');
  if (admins.rows[0].n === 0) {
    const name = process.env.ADMIN_NAME || 'Administrator';
    const email = (process.env.ADMIN_EMAIL || 'admin@taptowash.local').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    const hash = await bcrypt.hash(password, 12);
    const weak = passwordProblem(password, { email, name }) !== '';
    await pool.query('INSERT INTO admins (name, email, password_hash, must_change_password) VALUES ($1, $2, $3, $4)', [name, email, hash, weak]);
    console.log(`[ok] Admin created: ${email}${weak ? '  (you will be asked to choose a new password at first login)' : ''}`);
  } else {
    console.log('[--] Admin already exists - skipped');
    // An admin still using the well-known default password must change it.
    const all = await pool.query('SELECT id, password_hash FROM admins WHERE NOT must_change_password');
    for (const a of all.rows) {
      if (await bcrypt.compare('ChangeMe123!', a.password_hash)) {
        await pool.query('UPDATE admins SET must_change_password = TRUE WHERE id = $1', [a.id]);
        console.log('[ok] An admin still has the default password - a change will be required at next login');
      }
    }
  }

  for (const [key, value] of Object.entries(DEFAULTS)) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
  console.log('[ok] Default settings in place');

  const cats = await pool.query('SELECT COUNT(*)::int AS n FROM categories');
  if (cats.rows[0].n === 0) {
    for (const c of STARTER_CATEGORIES) {
      await pool.query(
        'INSERT INTO categories (name, description, icon, color, price, unit, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        c
      );
    }
    console.log('[ok] Starter categories added (edit or delete them in Admin > Categories)');
  } else {
    console.log('[--] Categories already exist - skipped');
  }
  // Move old emoji icons / green-blue colours on existing categories to the current icon set and palette.
  const existing = await pool.query('SELECT id, icon, color FROM categories');
  let migrated = 0;
  for (const c of existing.rows) {
    const icon = categoryIconName(c.icon);
    const color = OLD_COLOURS[String(c.color).toLowerCase()] || c.color;
    if (icon !== c.icon || color !== c.color) {
      await pool.query('UPDATE categories SET icon = $1, color = $2 WHERE id = $3', [icon, color, c.id]);
      migrated += 1;
    }
  }
  if (migrated) console.log(`[ok] Updated icons/colours on ${migrated} existing categor${migrated === 1 ? 'y' : 'ies'}`);
}

main()
  .catch((err) => {
    console.error('Database setup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
