// Multi-login in one browser.
// Browsers share cookies between tabs, so two logins used to overwrite each other in one session.
// Each extra login now lives under its own address prefix, e.g. /s_ab12cd34ef/admin, with its own
// session cookie (name and Path are tied to that prefix). Tabs on different prefixes never merge.
const crypto = require('crypto');

const SLOT_RE = /^\/(s_[a-z0-9]{6,24})(?=[/?#]|$)/;
const APP_PATH = /^\/(admin|staff|account)(?=[/?#]|$)/;

function newSlotId() {
  return 's_' + crypto.randomBytes(5).toString('hex');
}

// buildSession(name, path) returns an express-session middleware.
function slotMiddleware(buildSession) {
  const cache = new Map();
  const sessionFor = (slot) => {
    let mw = cache.get(slot);
    if (!mw) {
      if (cache.size > 500) cache.clear();
      mw = slot ? buildSession('ttw.' + slot, '/' + slot) : buildSession('ttw.sid', '/');
      cache.set(slot, mw);
    }
    return mw;
  };

  return (req, res, next) => {
    let slot = '';
    const m = SLOT_RE.exec(req.url);
    if (m) {
      slot = m[1];
      let rest = req.url.slice(m[0].length);
      if (!rest || rest[0] === '?' || rest[0] === '#') rest = '/' + rest;
      req.url = rest;
    }
    req.cleanUrl = req.url; // the address without the login prefix (req.originalUrl keeps it, which the session cookie Path needs)
    req.slot = slot;
    req.base = slot ? '/' + slot : '';

    if (slot) {
      const prefix = (u) => (typeof u === 'string' && APP_PATH.test(u) ? req.base + u : u);

      const redirect = res.redirect.bind(res);
      res.redirect = (...args) => redirect(...args.map((x) => (typeof x === 'string' ? prefix(x) : x)));

      // Prefix every staff/account link and form in a page so the next click stays in this login.
      res.prefixHtml = (markup) =>
        String(markup)
          .replace(/(href|action|formaction)="(\/(?:admin|staff|account)(?:[/?#][^"]*)?)"/g, (_, attr, url) => `${attr}="${req.base}${url}"`)
          .replace(/<head>/i, `<head>\n<meta name="app-base" content="${req.base}">`);
    } else {
      res.prefixHtml = (markup) => String(markup);
    }

    sessionFor(slot)(req, res, next);
  };
}

module.exports = { slotMiddleware, newSlotId };
