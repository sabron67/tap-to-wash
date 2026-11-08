const { html } = require('../../lib/html');
const { adminLayout } = require('../layouts/admin');
const { icon } = require('../../lib/icons');

function forbiddenPage(ctx) {
  const body = html`<section class="glass pad center">
    <div class="big">${icon('lock')}</div>
    <h2>This area is not part of your role</h2>
    <p class="muted">You are signed in as <strong>${ctx.roleLabel}</strong>. Ask the owner if you need access to this page.</p>
    <a class="btn btn-primary" href="${ctx.can('dashboard') ? '/admin' : '/admin/requests'}">Go back</a>
  </section>`;
  return adminLayout(ctx, { title: 'No access', active: '', body });
}

module.exports = { forbiddenPage };
