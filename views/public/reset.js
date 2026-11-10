// "Forgot password" and "choose a new password" pages, shared by customers (public site) and staff (admin look).
const { html } = require('../../lib/html');
const { head, publicLayout } = require('../layouts/public');
const { pubNav } = require('../partials/pubnav');
const { csrfField } = require('../partials/ui');
const { themeSwitch } = require('../partials/theme');
const { icon } = require('../../lib/icons');

const CFG = {
  customer: { base: '/account', loginUrl: '/account/login', who: 'account' },
  admin: { base: '/admin', loginUrl: '/admin/login', who: 'staff account' },
};

function forgotForm(ctx, kind, { error = '', email = '', portal = '' }) {
  const c = { ...CFG[kind], ...(kind === 'admin' && portal === 'staff' ? { loginUrl: '/staff' } : {}) };
  return html`<form method="post" action="${c.base}/forgot" class="stack">
    ${csrfField(ctx)}
    <h1 class="rs-title">Forgot your password?</h1>
    <p class="muted small">Enter the email of your ${c.who}. We will WhatsApp a 6-digit code to the number saved on it.</p>
    ${error ? html`<p class="err show" role="alert">${error}</p>` : ''}
    <label class="field"><span>Email</span><input type="email" name="email" value="${email}" required maxlength="120" autocomplete="username" autofocus></label>
    <button class="btn btn-primary btn-block" type="submit">Send me a code</button>
    <p class="muted small center"><a class="link" href="${c.loginUrl}">${icon('arrow-left')} Back to sign in</a></p>
  </form>`;
}

function resetForm(ctx, kind, { error = '', info = '', email = '', portal = '' }) {
  const c = { ...CFG[kind], ...(kind === 'admin' && portal === 'staff' ? { loginUrl: '/staff' } : {}) };
  return html`<form method="post" action="${c.base}/reset" class="stack">
    ${csrfField(ctx)}
    <h1 class="rs-title">Choose a new password</h1>
    ${info ? html`<div class="notice">${info}</div>` : ''}
    ${error ? html`<p class="err show" role="alert">${error}</p>` : ''}
    <label class="field"><span>Email</span><input type="email" name="email" value="${email}" required maxlength="120" autocomplete="username"></label>
    <label class="field"><span>6-digit code</span><input name="code" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" required autocomplete="one-time-code" placeholder="123456" ${email ? 'autofocus' : ''}></label>
    <label class="field"><span>New password</span><input type="password" name="password" minlength="10" required autocomplete="new-password"><small class="muted">At least 10 characters with a letter and a number.</small></label>
    <label class="field"><span>Repeat new password</span><input type="password" name="confirm" minlength="10" required autocomplete="new-password"></label>
    <button class="btn btn-primary btn-block" type="submit">Update password</button>
    <p class="muted small center"><a class="link" href="${c.base}/forgot">Send a new code</a> · <a class="link" href="${c.loginUrl}">Back to sign in</a></p>
  </form>`;
}

function wrapPage(ctx, kind, title, inner) {
  if (kind === 'admin') {
    return html`<!doctype html>
<html lang="en">
<head>${head(title, ctx.settings)}<meta name="robots" content="noindex,nofollow"></head>
<body class="admin login-page">
<div class="theme-float">${themeSwitch()}</div>
<main class="login-wrap">
  <div class="login-card glass-strong">
    <p class="brand-line">${ctx.settings.business_name}</p>
    ${inner}
  </div>
</main>
<script src="/js/theme.js"></script>
<script src="/js/password.js"></script>
</body>
</html>`;
  }
  return publicLayout(ctx, {
    title,
    bodyClass: 'public',
    body: html`${pubNav(ctx, 'account')}<main class="container narrow section" style="padding-top:calc(var(--nav-h) + 2.5rem)"><div class="glass pad">${inner}</div></main>`,
  });
}

const forgotPage = (ctx, kind, opts = {}) => wrapPage(ctx, kind, 'Forgot password', forgotForm(ctx, kind, opts));
const resetPage = (ctx, kind, opts = {}) => wrapPage(ctx, kind, 'Reset password', resetForm(ctx, kind, opts));

module.exports = { forgotPage, resetPage };
