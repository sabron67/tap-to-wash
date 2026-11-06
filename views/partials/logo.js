const { html } = require('../../lib/html');

// The Tap to Wash logo: a finger tapping a washing machine.
// `prefix` keeps gradient ids unique when the logo appears more than once on a page.
function logo({ prefix = 'l', animated = true, className = '' } = {}) {
  const id = (n) => `${prefix}-${n}`;
  return html`<svg class="ttw-logo ${animated ? '' : 'static'} ${className}" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tap to Wash logo: a finger tapping a washing machine">
  <defs>
    <linearGradient id="${id('body')}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e8bd94"/><stop offset="0.55" stop-color="#c2663a"/><stop offset="1" stop-color="#8f4a28"/>
    </linearGradient>
    <linearGradient id="${id('glass')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6e8"/><stop offset="1" stop-color="#c9a27c"/>
    </linearGradient>
    <linearGradient id="${id('skin')}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe3c8"/><stop offset="1" stop-color="#f0a070"/>
    </linearGradient>
    <clipPath id="${id('clip')}"><circle cx="70" cy="100" r="28"/></clipPath>
  </defs>

  <ellipse cx="70" cy="153" rx="46" ry="5.5" fill="#0f172a" opacity=".25"/>

  <g class="ttw-machine">
    <rect x="22" y="30" width="96" height="116" rx="18" fill="url(#${id('body')})"/>
    <rect x="22" y="30" width="96" height="116" rx="18" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2"/>
    <rect x="30" y="38" width="80" height="22" rx="9" fill="#fff" fill-opacity=".22"/>
    <circle cx="44" cy="49" r="7" fill="#fff"/>
    <path d="M44 49 V43.6" stroke="#c2663a" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="78" cy="49" r="3.6" fill="#fde047"/>
    <circle cx="90" cy="49" r="3.6" fill="#fb7185"/>
    <circle cx="102" cy="49" r="3.6" fill="#f5e6d0"/>

    <circle cx="70" cy="100" r="34" fill="#fff" fill-opacity=".95"/>
    <circle cx="70" cy="100" r="30" fill="#f5e6d0"/>
    <circle cx="70" cy="100" r="28" fill="url(#${id('glass')})"/>
    <g clip-path="url(#${id('clip')})">
      <g class="ttw-drum">
        <ellipse cx="58" cy="108" rx="11" ry="7" fill="#fb7185" transform="rotate(-20 58 108)"/>
        <ellipse cx="84" cy="96" rx="9" ry="6" fill="#fbbf24" transform="rotate(25 84 96)"/>
        <ellipse cx="70" cy="118" rx="8" ry="5" fill="#fff" fill-opacity=".9"/>
      </g>
      <path class="ttw-wave" d="M10 104 q10 -8 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V140 H10Z" fill="#fff" fill-opacity=".35"/>
      <circle class="ttw-bubble b1" cx="56" cy="118" r="3" fill="#fff" fill-opacity=".85"/>
      <circle class="ttw-bubble b2" cx="78" cy="122" r="2.2" fill="#fff" fill-opacity=".85"/>
      <circle class="ttw-bubble b3" cx="68" cy="114" r="1.8" fill="#fff" fill-opacity=".85"/>
    </g>
    <path d="M52 84 a24 24 0 0 1 22 -9" stroke="#fff" stroke-opacity=".85" stroke-width="3" stroke-linecap="round" fill="none"/>
  </g>

  <circle class="ttw-ripple" cx="90" cy="80" r="14" fill="none" stroke="#fff" stroke-width="3"/>

  <g transform="translate(113 40) rotate(30)">
    <g class="ttw-finger">
      <rect x="-9" y="-6" width="18" height="52" rx="9" fill="url(#${id('skin')})"/>
      <path d="M-5 14 H5" stroke="#c9774a" stroke-opacity=".45" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="-21" y="-44" width="42" height="42" rx="16" fill="url(#${id('skin')})"/>
      <path d="M-12 -14 q4 4 8 0 M-2 -14 q4 4 8 0" stroke="#c9774a" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round" fill="none"/>
      <rect x="-23" y="-54" width="46" height="14" rx="6" fill="#fb7185"/>
    </g>
  </g>
</svg>`;
}

module.exports = { logo };
