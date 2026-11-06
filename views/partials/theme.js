const { html, raw } = require('../../lib/html');

// Runs in <head> before the page paints, so a saved Light/Dark choice never flashes the wrong theme.
// "System" = no data-theme attribute, so the CSS follows the device's prefers-color-scheme.
const themeBoot = raw(
  `<script>(function(){try{var t=localStorage.getItem('ttw-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>`
);

// Three-way switch: System (follow device) / Light / Dark. public/js/theme.js makes it work.
function themeSwitch() {
  const btn = (mode, icon, label) =>
    html`<button type="button" data-theme-set="${mode}" aria-pressed="false" title="${label}" aria-label="${label} theme"><span class="ts-ico" aria-hidden="true">${icon}</span><span class="ts-txt">${label}</span></button>`;
  return html`<div class="theme-switch" role="group" aria-label="Colour theme">${btn('system', '💻', 'System')}${btn('light', '☀️', 'Light')}${btn('dark', '🌙', 'Dark')}</div>`;
}

module.exports = { themeBoot, themeSwitch };
