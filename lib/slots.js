// Multi-login in one browser. Every login tab gets a unique URL prefix and a
// session cookie scoped to that prefix. Browsers share cookies across tabs, so
// a shared cookie name/path would otherwise make the last login replace the first.
const crypto = require('crypto');

const SLOT_RE = /^\/(s_[a-z0-9]{5,24})(?=[/?#]|$)/;
// Each login door is isolated, including two owner logins or two staff logins.
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

    // A bare login URL is an entry point, not a shared session. Give every
    // newly opened login page its own namespace before CSRF state is created.
    if (!slot && req.method === 'GET') {
      const barePath = req.url.split('?')[0].replace(/\/$/, '') || '/';
      if (barePath === '/admin/login' || barePath === '/staff' || barePath === '/staff/login') {
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, '/' + newSlotId() + req.url);
      }
    }

    req.cleanUrl = req.url;
    req.slot = slot;
    req.base = slot ? '/' + slot : '';
    req.isStaffSpace = false;

    if (slot) {
      const prefix = (u) => (typeof u === 'string' && APP_PATH.test(u) ? req.base + u : u);
      const redirect = res.redirect.bind(res);
      res.redirect = (...args) => redirect(...args.map((x) => (typeof x === 'string' ? prefix(x) : x)));
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
