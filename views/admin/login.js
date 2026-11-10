const { html } = require('../../lib/html');
const { head } = require('../layouts/public');
const { csrfField } = require('../partials/ui');
const { themeSwitch } = require('../partials/theme');
const { icon } = require('../../lib/icons');

const COPY = {
  admin: { title: 'Owner sign in', sub: 'Owner sign in', action: '/admin/login', other: '/staff', otherText: 'Staff member? Sign in here' },
  staff: { title: 'Staff sign in', sub: 'Staff sign in', action: '/staff/login', other: '/admin/login', otherText: 'Owner? Sign in here' },
};

function loginPage(ctx, { error = '', email = '', portal = 'admin' } = {}) {
  const s = ctx.settings;
  const c = COPY[portal] || COPY.admin;
  return html`<!doctype html>
<html lang="en">
<head>${head(c.title, s)}<meta name="robots" content="noindex,nofollow"></head>
<body class="admin login-page">
<div class="theme-float">${themeSwitch()}</div>
<main class="login-wrap">
  <form class="login-card glass-strong" method="post" action="${c.action}">
    ${csrfField(ctx)}
    <h1>${s.business_name}</h1>
    <p class="muted">${c.sub}</p>
    ${ctx.flash ? html`<div class="flash ${ctx.flash.type}" role="status">${ctx.flash.msg}</div>` : ''}
    ${error ? html`<div class="flash error">${error}</div>` : ''}
    <label class="field"><span>Email</span><input type="email" name="email" value="${email}" required autocomplete="username" autofocus></label>
    <label class="field"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>
    <p class="forgot-row"><a class="link" href="/admin/forgot">Forgot password?</a></p>
    <button class="btn btn-primary btn-block btn-lg" type="submit">Sign in</button>
    <p class="muted small center"><a class="link" href="${c.other}">${c.otherText}</a></p>
    <a class="back-link" href="/">${icon('arrow-left')} Back to website</a>
  </form>
</main>
<script src="/js/theme.js"></script>
<script src="/js/password.js"></script>
</body>
</html>`;
}

module.exports = { loginPage };
