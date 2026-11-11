const { pool } = require('../config/db');

// Background pictures on the public page. Each has a drawn default (public/img/<slot>.svg) that the admin can replace with a real photo.
const SLOTS = {
  hero: { label: 'Top of the home page', hint: 'Wide photo of washing machines or a laundry room. Shown behind the headline.' },
  services: { label: 'Services section', hint: 'Folded clothes, baskets or shelves. Shown softly behind the service cards.' },
  cta: { label: 'Call-to-action band', hint: 'Machines or a stack of folded laundry.' },
};

async function mediaVersions() {
  try {
    const { rows } = await pool.query('SELECT slot, EXTRACT(EPOCH FROM updated_at)::bigint AS v FROM media');
    return Object.fromEntries(rows.map((r) => [r.slot, String(r.v)]));
  } catch (err) {
    return {};
  }
}

// The site icon (favicon) the admin uploaded in Settings. Stored in the same table under the slot 'favicon' as a square PNG.
// Returns a cache-busting version string, or '' when no icon was uploaded (the built-in public/favicon.svg is used then).
async function faviconVersion() {
  try {
    const { rows } = await pool.query(`SELECT EXTRACT(EPOCH FROM updated_at)::bigint AS v FROM media WHERE slot = 'favicon'`);
    return rows.length ? String(rows[0].v) : '';
  } catch (err) {
    return '';
  }
}

const mediaUrl = (slot, versions = {}) => `/media/${slot}${versions[slot] ? `?v=${versions[slot]}` : ''}`;

// Local, bundled photography is the fallback; uploaded category photos take precedence.
function defaultCategoryImage(name) {
  const n = String(name || '').toLowerCase();
  if (/dry|suit|formal|coat|shirt|garment/.test(n)) return 'dry-cleaning';
  if (/iron|press/.test(n)) return 'ironing';
  if (/shoe|sneaker|boot/.test(n)) return 'shoes';
  if (/bed|duvet|linen|blanket|sheet|pillow/.test(n)) return 'bedding';
  if (/carpet|rug|mat/.test(n)) return 'carpets';
  return 'laundry';
}
function categoryImageUrl(category, versions = {}) {
  const slot = `category-${category.id}`;
  return versions[slot] ? mediaUrl(slot, versions) : `/img/categories/${defaultCategoryImage(category.name)}.webp`;
}

module.exports = { SLOTS, mediaVersions, mediaUrl, faviconVersion, defaultCategoryImage, categoryImageUrl };
