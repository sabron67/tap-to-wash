// Two small pictures for the payment screens.
//  - mpesaBadge(): shows the official M-Pesa logo when the file public/img/mpesa.svg (or .png / .webp) exists,
//    otherwise a plain green "M-PESA" badge drawn here. Drop the official file in and it is used everywhere, no code change.
//  - paidTick(): a circle and a tick that draw themselves once when the page opens (animation in style.css, .paid-tick).
const fs = require('fs');
const path = require('path');
const { raw } = require('./html');

const LOGO_DIR = path.join(__dirname, '..', 'public', 'img');
let logoCache = { at: 0, url: '' };
// Looks for the official logo file (checked at most every 20 seconds, so dropping the file in works without a restart).
function logoUrl() {
  const now = Date.now();
  if (now - logoCache.at < 20000) return logoCache.url;
  let url = '';
  for (const ext of ['svg', 'png', 'webp']) {
    try {
      const st = fs.statSync(path.join(LOGO_DIR, `mpesa.${ext}`));
      if (st.isFile() && st.size > 0) { url = `/img/mpesa.${ext}?v=${Math.floor(st.mtimeMs / 1000)}`; break; }
    } catch (e) { /* not there */ }
  }
  logoCache = { at: now, url };
  return url;
}

function mpesaBadge(size = '') {
  const url = logoUrl();
  if (url) return raw(`<img class="mpesa-badge logo${size ? ` ${size}` : ''}" src="${url}" alt="M-Pesa" decoding="async">`);
  return raw(
    `<svg class="mpesa-badge${size ? ` ${size}` : ''}" viewBox="0 0 72 24" role="img" aria-label="M-Pesa" focusable="false">` +
      '<rect width="72" height="24" rx="6" fill="#2B8A1F"/>' +
      '<text x="36" y="16.6" text-anchor="middle" textLength="56" lengthAdjust="spacingAndGlyphs" fill="#fff" font-family="Inter, system-ui, Arial, sans-serif" font-size="13" font-weight="800">M-PESA</text>' +
      '</svg>'
  );
}

function paidTick(size = '') {
  return raw(
    `<svg class="paid-tick${size ? ` ${size}` : ''}" viewBox="0 0 52 52" aria-hidden="true" focusable="false">` +
      '<circle class="pt-disc" cx="26" cy="26" r="23"/>' +
      '<circle class="pt-pulse" cx="26" cy="26" r="23"/>' +
      '<circle class="pt-ring" cx="26" cy="26" r="23" pathLength="1"/>' +
      '<path class="pt-check" d="M15 27.5l8 8 14.5-17" pathLength="1"/>' +
      '</svg>'
  );
}

module.exports = { mpesaBadge, paidTick };
