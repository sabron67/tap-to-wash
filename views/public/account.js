const { html } = require('../../lib/html');
const { fmtDate, STATUS_MAP } = require('../../lib/helpers');
const { publicLayout } = require('../layouts/public');
const { pubNav } = require('../partials/pubnav');
const { csrfField, statusBadge } = require('../partials/ui');
const { icon } = require('../../lib/icons');

const msgBlock = (ctx) =>
  ctx.flash ? (ctx.flash.type === 'error' ? html`<p class="err show">${ctx.flash.msg}</p>` : html`<div class="notice">${ctx.flash.msg}</div>`) : '';

const shell = (ctx, title, active, inner) =>
  publicLayout(ctx, {
    title,
    bodyClass: 'public',
    scripts: html`<script src="/js/account.js"></script>`,
    body: html`${pubNav(ctx, active)}<main class="container narrow section" style="padding-top:calc(var(--nav-h) + 2.5rem)">${inner}</main>`,
  });

function authPage(ctx, { mode = 'login', error = '', values = {}, next = '' }) {
  const signup = mode === 'signup';
  const v = (k) => values[k] || '';
  const inner = html`
  <div class="section-head">
    <span class="pill">${icon('user-round')} Customer account</span>
    <h2>${signup ? 'Create your account' : 'Welcome back'}</h2>
    <p class="muted">${signup ? 'Keep your orders, details and addresses in one place. It is optional - you can always order as a guest.' : 'Sign in to see your orders and order faster.'}</p>
  </div>
  <form class="glass pad stack" method="post" action="/account/${signup ? 'signup' : 'login'}">
    ${csrfField(ctx)}
    <input type="hidden" name="next" value="${next}">
    ${signup ? html`<label class="field"><span>Your name <em>*</em></span><input name="name" value="${v('name')}" maxlength="80" required autocomplete="name"></label>` : ''}
    <label class="field"><span>Email <em>*</em></span><input type="email" name="email" value="${v('email')}" maxlength="120" required autocomplete="email"></label>
    ${signup ? html`<label class="field"><span>Phone number</span><input type="tel" name="phone" value="${v('phone')}" maxlength="20" autocomplete="tel" placeholder="0712 345 678"><small class="muted">Optional. Saved so your next request is pre-filled.</small></label>` : ''}
    <label class="field"><span>Password <em>*</em></span><input type="password" name="password" required autocomplete="${signup ? 'new-password' : 'current-password'}" ${signup ? 'minlength="10"' : ''}>${signup ? html`<small class="muted">At least 10 characters with a letter and a number.</small>` : ''}</label>
    ${signup
      ? html`<label class="field"><span>Repeat password <em>*</em></span><input type="password" name="confirm" required minlength="10" autocomplete="new-password"></label>
         <label class="check"><input type="checkbox" name="accept" value="1" required><span>I accept the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and have read the <a href="/privacy" target="_blank" rel="noopener">Privacy Notice</a>. <em>*</em></span></label>`
      : html`<label class="check"><input type="checkbox" name="remember" value="1"><span>Keep me signed in on this device</span></label>`}
    ${error ? html`<p class="err show" role="alert">${error}</p>` : ''}
    ${!signup && ctx.flash && ctx.flash.type === 'success' ? html`<div class="notice">${ctx.flash.msg}</div>` : ''}
    ${signup ? '' : html`<p class="forgot-row"><a class="link" href="/account/forgot">Forgot password?</a></p>`}
    <button class="btn btn-primary btn-block" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
    <p class="muted small center">${signup ? html`Already have an account? <a class="link" href="/account/login">Sign in</a>` : html`New here? <a class="link" href="/account/signup">Create an account</a>`}<br>
    <a class="link" href="/">Continue as a guest</a></p>
  </form>`;
  return shell(ctx, signup ? 'Create account' : 'Sign in', 'account', inner);
}

function accountPage(ctx, { account, requests }) {
  const mustChange = account.must_change_password;
  const pwForm = html`<form class="glass pad stack" method="post" action="/account/password">
      ${csrfField(ctx)}
      <h2>${mustChange ? 'Choose your own password' : 'Change password'}</h2>
      <label class="field"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label>
      <label class="field"><span>New password</span><input type="password" name="password" minlength="10" required autocomplete="new-password"><small class="muted">At least 10 characters with a letter and a number.</small></label>
      <label class="field"><span>Repeat new password</span><input type="password" name="confirm" minlength="10" required autocomplete="new-password"></label>
      <button class="btn btn-primary" type="submit">Update password</button>
    </form>`;

  const inner = mustChange
    ? html`<div class="section-head"><h2>Hello, ${account.name}</h2></div>
        ${msgBlock(ctx)}
        <div class="notice"><strong>Please choose your own password.</strong> You are using a temporary password from us. The rest of your account unlocks once you change it.</div>
        ${pwForm}`
    : html`
  <div class="section-head">
    <span class="pill">${icon('user-round')} My account</span>
    <h2>Hello, ${account.name}</h2>
    <p class="muted">${account.email}</p>
  </div>
  ${msgBlock(ctx)}
  <section class="glass pad">
    <div class="row-between">
      <h2>My requests</h2>
      <div class="row-gap">
        <a class="btn btn-primary btn-sm" href="/?start=1">${icon('plus')} New request</a>
        <form method="post" action="/account/logout" class="inline">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${icon('log-out')} Sign out</button></form>
      </div>
    </div>
    ${requests.length
      ? html`<div class="table-wrap"><table class="table acct-table">
        <thead><tr><th>Ref</th><th>Items</th><th>Status</th><th>Received</th><th></th></tr></thead>
        <tbody>${requests.map(
          (r) => html`<tr>
            <td><a class="link strong" href="/account/requests/${r.ref_code}">${r.ref_code}</a></td>
            <td class="clip">${r.items || '—'}</td>
            <td>${statusBadge(r.status)}</td>
            <td class="nowrap">${fmtDate(r.created_at)}</td>
            <td class="nowrap"><a class="btn btn-ghost btn-sm" href="/account/requests/${r.ref_code}">Track</a> <a class="btn btn-ghost btn-sm" href="/?again=${r.id}">${icon('refresh-cw')} Request again</a></td>
          </tr>`
        )}</tbody></table></div>`
      : html`<div class="empty"><div class="big">${icon('shopping-basket')}</div><p>No requests on your account yet.</p></div>`}
  </section>

  <section class="grid-2 gap">
    <form class="glass pad stack" method="post" action="/account/profile">
      ${csrfField(ctx)}
      <h2>My details</h2>
      <label class="field"><span>Name</span><input name="name" value="${account.name}" maxlength="80" required></label>
      <label class="field"><span>Phone number</span><input type="tel" name="phone" value="${account.phone}" maxlength="20" placeholder="0712 345 678"><small class="muted">Used to pre-fill your requests.</small></label>
      <label class="field"><span>Email</span><input value="${account.email}" disabled></label>
      <button class="btn btn-primary" type="submit">Save details</button>
    </form>
    ${pwForm}
  </section>

  <section class="grid-2 gap">
    <form class="glass pad stack" method="post" action="/account/claim">
      ${csrfField(ctx)}
      <h2>Add an earlier order</h2>
      <p class="muted small">Ordered before as a guest? Enter the reference code and the phone number you used to add it to your account.</p>
      <div class="grid-2">
        <label class="field"><span>Reference code</span><input name="ref" placeholder="TTW-XXXXXX" maxlength="20" required autocapitalize="characters"></label>
        <label class="field"><span>Phone used</span><input name="phone" type="tel" maxlength="20" required placeholder="0712 345 678"></label>
      </div>
      <button class="btn btn-ghost" type="submit">Add order</button>
    </form>
    <form class="glass pad stack danger" method="post" action="/account/delete" data-confirm="Delete your account? Your login and saved details will be removed. This cannot be undone.">
      ${csrfField(ctx)}
      <h2>Delete my account</h2>
      <p class="muted small">Deleting removes your login and saved details. Past orders stay in our business records without your account link. See our <a class="link" href="/privacy">Privacy Notice</a>.</p>
      <label class="field"><span>Password (to delete)</span><input type="password" name="password" autocomplete="current-password"></label>
      <button class="btn btn-danger btn-sm" type="submit">${icon('trash-2')} Delete my account</button>
    </form>
  </section>`;
  return shell(ctx, 'My account', 'account', inner);
}

module.exports = { authPage, accountPage };
