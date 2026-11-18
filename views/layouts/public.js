const { html, raw } = require('../../lib/html');
const { abs } = require('../../lib/seo');
const { href: cssHref } = require('../../lib/css-bundle');

// css: 'site' (public pages) or 'admin' (site + admin styles): one merged, minified file instead of 7-8 requests.
function head(title, settings, description, seo = {}, css = 'site') {
  const cssUrl = cssHref(css);
  const fullTitle = seo.fullTitle ? seo.title : `${title ? `${title} · ` : ''}${settings.business_name}`;
  const canonical = seo.canonical || '';
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${seo.description || description || settings.tagline}">
${seo.keywords ? html`<meta name="keywords" content="${seo.keywords}">` : ''}
${seo.noindex ? html`<meta name="robots" content="noindex,nofollow">` : html`<meta name="robots" content="index,follow,max-image-preview:large">`}
${canonical ? html`<link rel="canonical" href="${canonical}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${settings.business_name}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${seo.description || description || settings.tagline}">
${canonical ? html`<meta property="og:url" content="${canonical}"><meta property="og:image" content="${abs('/img/hero.svg')}">` : ''}
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${fullTitle}">
<meta name="twitter:description" content="${seo.description || description || settings.tagline}">
${seo.jsonLd ? raw(`<script type="application/ld+json">${JSON.stringify(seo.jsonLd).replace(/</g, '\\u003c')}</script>`) : ''}
<meta name="theme-color" content="#EBEBE4" media="(prefers-color-scheme: light)" data-light="#EBEBE4">
<meta name="theme-color" content="#121211" media="(prefers-color-scheme: dark)" data-dark="#121211">
<link rel="preload" href="${cssUrl}" as="style">
<link rel="preload" href="/fonts/plus-jakarta-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<script src="/js/boot.js"></script>
<link rel="icon" href="/site-icon${settings.icon_v ? `?v=${settings.icon_v}` : ''}">
${settings.icon_v ? html`<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${settings.icon_v}">` : html`<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`}
<link rel="manifest" href="/manifest.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${settings.business_name}">
<link rel="stylesheet" href="${cssUrl}">
<script src="/js/loading.js" defer></script>
<script src="/js/toast.js" defer></script>
<script src="/js/dialog.js" defer></script>
<script src="/js/promo.js" defer></script>`;
}

function publicLayout(ctx, { title = '', body, scripts = '', bodyClass = '', seo = {} }) {
  return html`<!doctype html>
<html lang="en">
<head>
${head(title, ctx.settings, '', seo)}
</head>
<body class="${bodyClass}">
<div id="progress" aria-hidden="true"></div>
${body}
<script src="/js/theme.js"></script>
<script src="/js/password.js"></script>
<script src="/js/install.js" defer></script>
${scripts}
</body>
</html>`;
}

module.exports = { publicLayout, head };
