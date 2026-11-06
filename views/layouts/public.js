const { html, raw } = require('../../lib/html');
const { themeBoot } = require('../partials/theme');

function head(title, settings, description) {
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} · ` : ''}${settings.business_name}</title>
<meta name="description" content="${description || settings.tagline}">
<meta name="theme-color" content="#2e211a" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#faf1e3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#2e211a" data-dynamic>
${themeBoot}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">`;
}

const blobs = raw(
  '<div class="blobs" aria-hidden="true"><span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span><span class="blob b4"></span></div>'
);

function publicLayout(ctx, { title = '', body, scripts = '', bodyClass = '' }) {
  return html`<!doctype html>
<html lang="en">
<head>
${head(title, ctx.settings)}
</head>
<body class="${bodyClass}">
${blobs}
${body}
<script src="/js/theme.js"></script>
${scripts}
</body>
</html>`;
}

module.exports = { publicLayout, head, blobs };
