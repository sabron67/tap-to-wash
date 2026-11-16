// Merges and minifies the stylesheets, so a page makes ONE css request instead of 7-8 (a big win on slow phones).
//   site  = the public pages' css (7 files)
//   admin = site + admin-hub.css (admin pages)
// The address contains a hash of the content (/css/bundle-site.<hash>.css), so browsers may keep it for a year and a changed
// stylesheet is fetched at once. Files stay in public/css and keep their order, so the cascade is exactly what it was.
// Built in memory at startup (no build step to run); in development it rebuilds when a css file changes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csso = require('csso');

const DIR = path.join(__dirname, '..', 'public', 'css');
const SITE = ['style.css', 'customer-premium.css', 'receipt.css', 'promo.css', 'loading.css', 'how-it-works.css', 'file-input.css'];
const BUNDLES = { site: SITE, admin: [...SITE, 'admin-hub.css'] };
const isProd = process.env.NODE_ENV === 'production';

const built = {}; // name -> { css, hash, stamp }

const stampOf = (files) => files.map((f) => fs.statSync(path.join(DIR, f)).mtimeMs).join(',');

function build(name) {
  const files = BUNDLES[name];
  const stamp = isProd && built[name] ? built[name].stamp : stampOf(files);
  if (built[name] && built[name].stamp === stamp) return built[name];
  const source = files.map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  let css;
  try {
    css = csso.minify(source, { comments: false, restructure: false }).css;
  } catch (err) {
    console.error('CSS minify failed, serving the files merged but not minified:', err.message);
    css = source;
  }
  const hash = crypto.createHash('sha1').update(css).digest('hex').slice(0, 10);
  built[name] = { css, hash, stamp };
  return built[name];
}

const href = (name = 'site') => `/css/bundle-${name}.${build(name).hash}.css`;

// Express middleware: serves /css/bundle-<name>.<hash>.css. Mount it before express.static.
function middleware(req, res, next) {
  const m = /^\/css\/bundle-(site|admin)\.([0-9a-f]{10})\.css$/.exec(req.path);
  if (!m || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
  const b = build(m[1]);
  res.type('text/css');
  // A hash that no longer matches (an old page asking for an old build) still gets the current css, but is not cached for long.
  res.set('Cache-Control', m[2] === b.hash && isProd ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.send(b.css);
}

module.exports = { href, middleware, SITE };
