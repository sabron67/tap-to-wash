const { html } = require('../../lib/html');
const { head, blobs } = require('../layouts/public');
const { logo } = require('../partials/logo');
const { csrfField } = require('../partials/ui');
const { themeSwitch } = require('../partials/theme');
const { icon } = require('../../lib/icons');

function loginPage(ctx, { error = '', email = '' } = {}) {
  const s = ctx.settings;
  return html`<!doctype html>
<html lang="en">
<head>${head('Admin login', s)}<meta name="robots" content="noindex,nofollow"></head>
<body class="admin login-page">
${blobs}
<div class="theme-float">${themeSwitch()}</div>
<main class="login-wrap">
  <form class="login-card glass-strong" method="post" action="/admin/login">
    ${csrfField(ctx)}
    <div class="login-logo">${logo({ prefix: 'login', animated: true })}</div>
    <h1>${s.business_name}</h1>
    <p class="muted">Admin sign in</p>
    ${error ? html`<div class="flash error">${error}</div>` : ''}
    <label class="field"><span>Email</span><input type="email" name="email" value="${email}" required autocomplete="username" autofocus></label>
    <label class="field"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn btn-primary btn-block btn-lg" type="submit">Sign in</button>
    <a class="back-link" href="/">${icon('arrow-left')} Back to website</a>
  </form>
</main>
<script src="/js/theme.js"></script>
</body>
</html>`;
}

module.exports = { loginPage };
