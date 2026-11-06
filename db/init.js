// Creates the tables and seeds a first admin, default settings and starter categories.
// Run with:  npm run db:init
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { DEFAULTS } = require('../lib/settings');

const STARTER_CATEGORIES = [
  ['Everyday Clothes', 'T-shirts, trousers, dresses and daily wear.', '👕', '#10b981', 150, 'kg', 1],
  ['Bedding & Duvets', 'Sheets, blankets, duvets and pillow cases.', '🛏️', '#f59e0b', 400, 'item', 2],
  ['Suits & Formal Wear', 'Suits, coats, uniforms and dress shirts.', '👔', '#fb7185', 500, 'item', 3],
  ['Curtains', 'Curtains and drapes, washed and pressed.', '🪟', '#14b8a6', 350, 'item', 4],
  ['Shoes & Sneakers', 'Deep clean for sneakers and casual shoes.', '👟', '#84cc16', 300, 'pair', 5],
  ['Carpets & Rugs', 'Deep wash and dry for carpets and rugs.', '🧶', '#fb7185', 250, 'sq m', 6],
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and edit it first.');
    process.exit(1);
  }

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('✔ Tables are ready');

  const admins = await pool.query('SELECT COUNT(*)::int AS n FROM admins');
  if (admins.rows[0].n === 0) {
    const name = process.env.ADMIN_NAME || 'Administrator';
    const email = (process.env.ADMIN_EMAIL || 'admin@taptowash.local').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3)', [name, email, hash]);
    console.log(`✔ Admin created: ${email}  (change the password after first login)`);
  } else {
    console.log('• Admin already exists - skipped');
  }

  for (const [key, value] of Object.entries(DEFAULTS)) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
  console.log('✔ Default settings in place');

  const cats = await pool.query('SELECT COUNT(*)::int AS n FROM categories');
  if (cats.rows[0].n === 0) {
    for (const c of STARTER_CATEGORIES) {
      await pool.query(
        'INSERT INTO categories (name, description, icon, color, price, unit, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        c
      );
    }
    console.log('✔ Starter categories added (edit or delete them in Admin → Categories)');
  } else {
    console.log('• Categories already exist - skipped');
  }
}

main()
  .catch((err) => {
    console.error('Database setup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
