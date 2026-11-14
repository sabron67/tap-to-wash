const { html } = require('../../lib/html');
const { head } = require('../layouts/public');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { themeSwitch } = require('../partials/theme');
const { icon } = require('../../lib/icons');

// Second step of sign-in (shown after a correct password).
function challengePage(ctx, { portal = 'admin', error = '', email = '' } = {}) {
  const s = ctx.settings;
  const action = portal === 'staff' ? '/staff/login/2fa' : '/admin/login/2fa';
  return html`<!doctype html>
<html lang="en">
<head>${head('Two-step verification', s)}<meta name="robots" content="noindex,nofollow"></head>
<body class="admin login-page">
<div class="theme-float">${themeSwitch()}</div>
<main class="login-wrap">
  <form class="login-card glass-strong" method="post" action="${action}">
    ${csrfField(ctx)}
    <h1>${s.business_name}</h1>
    <p class="muted">Two-step verification</p>
    ${error ? html`<div class="flash error">${error}</div>` : ''}
    <p class="small">Open your authenticator app and enter the 6-digit code for <strong>${email}</strong>.</p>
    <label class="field"><span>Code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required autofocus placeholder="123456"></label>
    <button class="btn btn-primary btn-block btn-lg" type="submit">Verify and sign in</button>
    <details><summary class="small">Lost your phone? Use a recovery code</summary><p class="muted small">Type one of the recovery codes you saved (for example <span class="mono">ABCDE-FGHJK</span>) in the box above. Each works once. Otherwise ask the owner to reset your two-step verification.</p></details>
    <a class="back-link" href="${portal === 'staff' ? '/staff' : '/admin/login'}">${icon('arrow-left')} Start again</a>
  </form>
</main>
<script src="/js/theme.js"></script>
</body>
</html>`;
}

const codesBlock = (codes) => html`<section class="rc-card glass pad">
  <div class="rc-head">
    <span class="rc-ico">${icon('shield-check')}</span>
    <div>
      <h2>Two-step verification is on</h2>
      <p class="muted">Save your recovery codes now. If you lose your phone, each code signs you in <strong>once</strong>.</p>
    </div>
  </div>
  <div class="rc-warn">${icon('triangle-alert')}<span>These codes are shown <strong>only this once</strong>. Print them or store them somewhere safe, away from your phone.</span></div>
  <ol class="rc-grid" id="rcCodes">${codes.map((c, i) => html`<li><span class="rc-n">${i + 1}</span><code>${c}</code></li>`)}</ol>
  <div class="rc-actions">
    <button class="btn btn-ghost" type="button" data-rc-copy>${icon('copy')} Copy codes</button>
    <button class="btn btn-ghost" type="button" data-rc-print>${icon('printer')} Print</button>
    <a class="btn btn-primary" href="/admin/account">${icon('check')} I have saved them</a>
  </div>
</section>
<script src="/js/recovery.js"></script>`;

function recoveryPage(ctx, { codes, title = 'Two-step verification is on' }) {
  return adminLayout(ctx, { title, active: 'account', body: codesBlock(codes) });
}

function setupPage(ctx, { qr, secret, error = '' }) {
  const body = html`
  ${ctx.require2fa ? html`<div class="notice"><strong>Two-step verification is required.</strong> Set it up to continue using the admin area.</div>` : ''}
  <section class="glass pad stack" style="max-width:560px">
    <h2>Set up two-step verification</h2>
    <ol class="sheet-list">
      <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or 1Password).</li>
      <li>Scan this picture, or type the key by hand.</li>
      <li>Enter the 6-digit code the app shows.</li>
    </ol>
    <img src="${qr}" alt="QR code for your authenticator app" width="220" height="220" style="background:#fff;padding:8px;border-radius:12px;border:1px solid var(--line)">
    <p class="small">Key (if you cannot scan): <strong class="mono">${secret}</strong></p>
    ${error ? html`<div class="flash error">${error}</div>` : ''}
    <form method="post" action="/admin/account/2fa/enable" class="stack">
      ${csrfField(ctx)}
      <label class="field"><span>6-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></label>
      <button class="btn btn-primary" type="submit">Turn on two-step verification</button>
    </form>
  </section>`;
  return adminLayout(ctx, { title: 'Two-step verification', active: 'account', body });
}

// Card for the My account page.
function twofaCard(ctx, { enabled, left, required }) {
  return html`<section class="glass pad stack" style="margin-top:1.25rem" id="twofa">
    <h2>Two-step verification ${enabled ? html`<span class="badge">On</span>` : html`<span class="badge pay-partial">Off</span>`}</h2>
    ${enabled
      ? html`<p class="muted small">Sign-in needs your password and a code from your authenticator app. You have <strong>${left}</strong> unused recovery code${left === 1 ? '' : 's'}.</p>
        <form method="post" action="/admin/account/2fa/recovery" class="row-form">${csrfField(ctx)}
          <label class="field" style="margin:0"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>
          <button class="btn btn-ghost" type="submit" style="align-self:flex-end">New recovery codes</button></form>
        ${required ? html`<p class="muted small">The owner requires two-step verification, so it cannot be turned off.</p>` : html`
        <form method="post" action="/admin/account/2fa/disable" class="row-form" data-confirm="Turn off two-step verification?">${csrfField(ctx)}
          <label class="field" style="margin:0"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>
          <label class="field" style="margin:0"><span>Current code</span><input name="code" inputmode="numeric" required maxlength="20"></label>
          <button class="btn btn-ghost" type="submit" style="align-self:flex-end">Turn off</button></form>`}`
      : html`<p class="muted small">Protect your account: after your password you will be asked for a 6-digit code from an authenticator app on your phone.</p>
        <a class="btn btn-primary" href="/admin/account/2fa/setup">${icon('shield-check')} Set up</a>`}
  </section>`;
}

module.exports = { challengePage, recoveryPage, setupPage, twofaCard };
