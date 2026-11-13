const { html, raw } = require('../../lib/html');

function head(title, settings, description) {
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} · ` : ''}${settings.business_name}</title>
<meta name="description" content="${description || settings.tagline}">
<meta name="theme-color" content="#F3FAF6" media="(prefers-color-scheme: light)" data-light="#F3FAF6">
<meta name="theme-color" content="#0C1511" media="(prefers-color-scheme: dark)" data-dark="#0C1511">
<script src="/js/boot.js"></script>
<link rel="icon" href="/site-icon${settings.icon_v ? `?v=${settings.icon_v}` : ''}">
${settings.icon_v ? html`<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${settings.icon_v}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/customer-premium.css">
<link rel="stylesheet" href="/css/receipt.css">
<script src="/js/toast.js" defer></script>
<script src="/js/dialog.js" defer></script>`;
}

function publicLayout(ctx, { title = '', body, scripts = '', bodyClass = '' }) {
  return html`<!doctype html>
<html lang="en">
<head>
${head(title, ctx.settings)}
</head>
<body class="${bodyClass}">
<div id="progress" aria-hidden="true"></div>
${body}
<script src="/js/theme.js"></script>
<script src="/js/password.js"></script>
${scripts}
</body>
</html>`;
}

module.exports = { publicLayout, head };
