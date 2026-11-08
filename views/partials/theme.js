const { html } = require('../../lib/html');
const { icon } = require('../../lib/icons');

// Three-way switch: System (follow device) / Light / Dark. public/js/theme.js makes it work.
function themeSwitch() {
  const btn = (mode, iconName, label) =>
    html`<button type="button" data-theme-set="${mode}" aria-pressed="false" title="${label}" aria-label="${label} theme"><span class="ts-ico" aria-hidden="true">${icon(iconName)}</span><span class="ts-txt">${label}</span></button>`;
  return html`<div class="theme-switch" role="group" aria-label="Colour theme">${btn('system', 'monitor', 'System')}${btn('light', 'sun', 'Light')}${btn('dark', 'moon', 'Dark')}</div>`;
}

module.exports = { themeSwitch };
