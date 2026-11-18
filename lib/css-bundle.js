// Merges and minifies the stylesheets, so a page makes ONE css request instead of 7-8 (a big win on slow phones).
//   site  = the public pages' css (8 files), with every rule that only admin pages use LEFT OUT
//   admin = all the files, untouched, plus admin-hub.css (admin pages)
// The address contains a hash of the content (/css/bundle-site.<hash>.css), so browsers may keep it for a year and a changed
// stylesheet is fetched at once. Files stay in public/css and keep their order, so the cascade is exactly what it was.
// Built in memory at startup (no build step to run); in development it rebuilds when a css file changes.
//
// How admin-only rules are found (automatic, nothing to maintain by hand):
//   1. every class / id name that appears in a public view, helper or script is "public vocabulary";
//   2. a selector that needs a class or id that is NOT in that vocabulary cannot match anything on a public page, so it is dropped
//      from the site bundle (the rule goes when all its selectors go). The admin bundle keeps everything, so admin pages are unchanged.
//   Class names built from pieces in public code (e.g. "pay-" + status) are listed in DYNAMIC_PREFIXES below.
//   Set CSS_SPLIT=0 in the environment to switch the filtering off (site bundle then = all the files merged).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csso = require('csso');
const csstree = require('css-tree');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'public', 'css');
const SITE = ['style.css', 'customer-premium.css', 'receipt.css', 'promo.css', 'loading.css', 'how-it-works.css', 'file-input.css', 'install.css'];
const BUNDLES = { site: SITE, admin: [...SITE, 'admin-hub.css'] };
const isProd = process.env.NODE_ENV === 'production';
const SPLIT = process.env.CSS_SPLIT !== '0';

// Where class names are looked for, and the files that belong to admin only (their names do not count as public).
const SCAN = ['views', 'lib', 'routes', 'public/js', 'server.js'];
const ADMIN_ONLY = ['views/admin', 'views/layouts/admin.js', 'views/partials/biz-hub.js', 'public/js/admin.js', 'public/js/receipt.js', 'public/js/recovery.js'];
const DYNAMIC_PREFIXES = ['pay-']; // views/partials/ui.js builds class="badge pay-<status>"

const built = {}; // name -> { css, hash, stamp }

const stampOf = (files) => files.map((f) => fs.statSync(path.join(DIR, f)).mtimeMs).join(',');

function sourceFiles(rel, out = []) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return out;
  if (ADMIN_ONLY.includes(rel.replace(/\\/g, '/'))) return out;
  if (fs.statSync(full).isDirectory()) {
    for (const n of fs.readdirSync(full)) if (n !== 'node_modules') sourceFiles(path.join(rel, n), out);
  } else if (/\.js$/.test(rel)) out.push(full);
  return out;
}

function publicVocabulary() {
  const vocab = new Set();
  for (const root of SCAN) {
    for (const file of sourceFiles(root)) {
      const words = fs.readFileSync(file, 'utf8').match(/[A-Za-z_][A-Za-z0-9_-]*/g) || [];
      for (const w of words) vocab.add(w);
    }
  }
  return vocab;
}

// Drops the selectors (and then the rules, and empty @media blocks) that no public page can match.
function dropAdminOnly(source, vocab) {
  const ast = csstree.parse(source);
  const known = (name) => vocab.has(name) || DYNAMIC_PREFIXES.some((p) => name.startsWith(p));
  // Only class / id names written directly on the selector count; ones inside :not(...) / :is(...) are left alone (kept to be safe).
  const adminOnlySelector = (sel) => {
    let drop = false;
    sel.children.forEach((n) => {
      if ((n.type === 'ClassSelector' || n.type === 'IdSelector') && !known(n.name)) drop = true;
    });
    return drop;
  };
  csstree.walk(ast, {
    visit: 'Rule',
    enter(rule, item, list) {
      if (rule.prelude.type !== 'SelectorList') return;
      rule.prelude.children.forEach((sel, selItem, selList) => {
        if (adminOnlySelector(sel)) selList.remove(selItem);
      });
      if (rule.prelude.children.isEmpty) list.remove(item);
    },
  });
  csstree.walk(ast, {
    visit: 'Atrule',
    enter(at, item, list) {
      if (at.block && at.block.children && at.block.children.isEmpty && /^(media|supports|layer)$/i.test(at.name)) list.remove(item);
    },
  });
  return csstree.generate(ast);
}

function build(name) {
  const files = BUNDLES[name];
  const stamp = isProd && built[name] ? built[name].stamp : stampOf(files);
  if (built[name] && built[name].stamp === stamp) return built[name];
  let source = files.map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  const before = source.length;
  if (name === 'site' && SPLIT) {
    try {
      source = dropAdminOnly(source, publicVocabulary());
    } catch (err) {
      console.error('CSS split failed, serving every rule to public pages:', err.message);
    }
  }
  let css;
  try {
    css = csso.minify(source, { comments: false, restructure: false }).css;
  } catch (err) {
    console.error('CSS minify failed, serving the files merged but not minified:', err.message);
    css = source;
  }
  const hash = crypto.createHash('sha1').update(css).digest('hex').slice(0, 10);
  built[name] = { css, hash, stamp };
  if (name === 'site' && SPLIT && !built.logged) {
    built.logged = true;
    console.log(`CSS: public bundle ${Math.round(css.length / 1024)} KB (admin-only rules left out: ${Math.round((before - source.length) / 1024)} KB before minifying)`);
  }
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
