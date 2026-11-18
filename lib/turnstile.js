// "I am not a robot" check using Cloudflare Turnstile (free). Switched on and keyed in Admin > Settings > Robot check.
//   - A small widget is added to the sign-in, sign-up and forgot/reset-password forms and to the booking form on the home page.
//   - The server checks the answer with Cloudflare before the form is processed (guard below). It is not needed anywhere else.
//   - Emergency switch: TURNSTILE_DISABLE=1 in the environment turns the check off (for example if the keys were typed wrongly and
//     nobody can sign in). If Cloudflare itself cannot be reached, people are let through (and a warning is logged) rather than locked out.
const settings = require('./backup-settings');

const VERIFY_URL = process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const HOST = 'https://challenges.cloudflare.com';

const enabled = () => {
  if (process.env.TURNSTILE_DISABLE === '1') return false;
  const c = settings.get();
  return c.captcha_on === '1' && !!c.captcha_site && !!settings.captchaSecret();
};

// Form posts that are checked (the path is the one without the per-login "/s_xxxx" prefix), and the booking API call.
const FORM_PATH = /^\/(?:(?:admin|staff|account)\/(?:login|signup|forgot|reset)|staff)\/?$/;
const API_PATH = /^\/api\/requests\/?$/;
const stripPrefix = (p) => String(p || '').replace(/^\/s_[a-z0-9]{6,24}(?=\/|$)/, '').split(/[?#]/)[0] || '/';

async function verify(token, ip) {
  if (!token || typeof token !== 'string' || token.length > 4096) return { ok: false };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: settings.captchaSecret(), response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`Cloudflare answered ${res.status}`);
    const out = await res.json();
    return { ok: !!out.success, codes: out['error-codes'] || [] };
  } catch (e) {
    console.warn('Robot check: Cloudflare could not be reached, letting the request through:', e.message);
    return { ok: true, unreachable: true };
  }
}

// Express middleware: refuses a protected POST that has no valid Turnstile answer.
async function guard(req, res, next) {
  try {
    if (req.method !== 'POST' || !enabled()) return next();
    const path = stripPrefix(req.cleanUrl || req.originalUrl);
    const isApi = API_PATH.test(path);
    if (!isApi && !FORM_PATH.test(path)) return next();
    const body = req.body || {};
    const token = body['cf-turnstile-response'] || req.get('x-turnstile-token') || '';
    const r = await verify(token, req.ip);
    if (r.ok) return next();
    const msg = token ? 'We could not confirm that you are not a robot. Please try again.' : 'Please tick the "I am not a robot" box and try again.';
    if (isApi) return res.status(400).json({ ok: false, error: msg, captcha: true });
    const { getSettings } = require('./settings');
    const { messagePage } = require('../views/public/track');
    const s = await getSettings().catch(() => ({ business_name: 'Tap to Wash', tagline: '' }));
    return res.status(400).view(messagePage({ settings: s }, { title: 'Please confirm you are human', message: `${msg} Go back to the previous page, complete the check and send the form again.`, code: '400' }));
  } catch (e) {
    next(e);
  }
}

const widget = (key) => `<div class="cf-turnstile ttw-captcha" data-sitekey="${String(key).replace(/"/g, '&quot;')}" data-theme="auto" data-language="auto" data-appearance="always"></div>`;

// Adds the widget to the protected forms of a page that is about to be sent (see res.view in server.js).
function decorate(markup) {
  if (!enabled()) return markup;
  const key = settings.get().captcha_site;
  let added = 0;
  let out = String(markup).replace(/<form\b[^>]*\baction="([^"]*)"[^>]*>[\s\S]*?<\/form>/g, (form, action) => {
    if (!FORM_PATH.test(stripPrefix(action)) || form.includes('cf-turnstile')) return form;
    added++;
    const at = form.lastIndexOf('<button');
    const spot = at > 0 && form.indexOf('type="submit"', at) > -1 ? at : form.lastIndexOf('</form>');
    return form.slice(0, spot) + widget(key) + form.slice(spot);
  });
  if (out.includes('id="fTerms"') && !out.includes('cf-turnstile')) {
    out = out.replace(/(id="fTerms"[\s\S]*?<\/label>)/, `$1${widget(key)}`);
    added++;
  }
  if (!added) return markup;
  return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `<script src="${SCRIPT_URL}" async defer></script>\n</body>`) : out + `<script src="${SCRIPT_URL}" async defer></script>`;
}

module.exports = { enabled, verify, guard, decorate, HOST };
