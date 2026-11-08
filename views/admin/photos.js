const { html } = require('../../lib/html');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { icon } = require('../../lib/icons');
const { SLOTS, mediaUrl } = require('../../lib/media');

function photosPage(ctx, { versions }) {
  const body = html`
  <section class="glass pad">
    <h2>Background pictures</h2>
    <p class="muted">The public page shows drawn laundry illustrations by default. Upload your own photos of washing machines, clean folded clothes or your shop to replace them. Pictures are resized in your browser before upload (JPEG, up to 1800 px wide).</p>
  </section>
  <section class="photo-grid">
    ${Object.entries(SLOTS).map(([slot, info]) => html`
      <div class="glass pad photo-card" data-slot="${slot}">
        <h3 style="margin-top:0">${info.label}</h3>
        <p class="muted small" style="margin:0">${info.hint}</p>
        <img src="${mediaUrl(slot, versions)}" alt="Current ${info.label} picture" loading="lazy">
        <p class="muted small">${versions[slot] ? 'Using your uploaded photo.' : 'Using the default illustration.'}</p>
        <div class="row-form">
          <input type="file" accept="image/jpeg,image/png,image/webp" data-photo-input="${slot}" aria-label="Choose a picture for ${info.label}">
          <button class="btn btn-primary btn-sm" type="button" data-photo-upload="${slot}">${icon('upload')} Upload</button>
        </div>
        <p class="err" data-photo-err="${slot}" role="alert"></p>
        ${versions[slot]
          ? html`<form method="post" action="/admin/photos/${slot}/reset" class="inline" data-confirm="Go back to the default illustration?">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit" style="margin-top:.6rem">${icon('rotate-ccw')} Reset to default</button></form>`
          : ''}
      </div>`)}
  </section>
  <input type="hidden" id="csrfToken" value="${ctx.csrf}">`;
  return adminLayout(ctx, { title: 'Photos', active: 'photos', body });
}

module.exports = { photosPage };
