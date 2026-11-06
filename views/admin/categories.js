const { html } = require('../../lib/html');
const { money } = require('../../lib/helpers');
const { icon, categoryIconName, CATEGORY_ICONS } = require('../../lib/icons');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');

// Visual icon picker: one radio per icon, the chosen one is highlighted.
function iconPicker(selected) {
  const current = categoryIconName(selected);
  return html`<fieldset class="icon-picker">
    <legend>Icon</legend>
    ${CATEGORY_ICONS.map(
      (name) => html`<label class="ip" title="${name.replace(/-/g, ' ')}">
        <input type="radio" name="icon" value="${name}" ${current === name ? 'checked' : ''} aria-label="${name.replace(/-/g, ' ')}">
        <span>${icon(name)}</span>
      </label>`
    )}
  </fieldset>`;
}

function fields(ctx, c = {}) {
  return html`
    <div class="grid-2">
      <label class="field"><span>Name <em>*</em></span><input name="name" value="${c.name || ''}" maxlength="60" required placeholder="e.g. Bedding & Duvets"></label>
      <label class="field"><span>Colour</span><input type="color" name="color" value="${c.color || '#c2663a'}"></label>
    </div>
    ${iconPicker(c.icon)}
    <label class="field"><span>Description</span><input name="description" value="${c.description || ''}" maxlength="200" placeholder="Short line customers will see"></label>
    <div class="grid-3">
      <label class="field"><span>Price (${ctx.settings.currency}) <small>optional</small></span><input type="number" step="0.01" min="0" name="price" value="${c.price === null || c.price === undefined ? '' : c.price}" placeholder="e.g. 150"></label>
      <label class="field"><span>Per (unit)</span><input name="unit" value="${c.unit || 'item'}" maxlength="20" placeholder="kg, item, pair…"></label>
      <label class="field"><span>Display order</span><input type="number" name="sort_order" value="${c.sort_order === undefined ? 0 : c.sort_order}" step="1"></label>
    </div>`;
}

function categoriesPage(ctx, { rows }) {
  const cur = ctx.settings.currency;
  const body = html`
  <section class="glass pad">
    <div class="card-head"><h2>Add a category</h2><span class="muted small">Customers choose from these on the public page.</span></div>
    <form method="post" action="/admin/categories" class="stack">
      ${csrfField(ctx)}
      ${fields(ctx)}
      <button class="btn btn-primary" type="submit">${icon('plus')} Add category</button>
    </form>
  </section>

  <section class="cat-admin">
    ${rows.length
      ? rows.map(
          (c) => html`<article class="glass pad cat-admin-card ${c.is_active ? '' : 'is-off'}" style="--c:${c.color}">
            <div class="cat-admin-top">
              <span class="cat-icon sm">${icon(categoryIconName(c.icon))}</span>
              <div class="grow">
                <h3>${c.name} ${c.is_active ? '' : html`<span class="badge" style="--bc:#94a3b8">Hidden</span>`}</h3>
                <p class="muted small">${c.description || 'No description'}</p>
                <p class="small"><strong>${c.price !== null ? `${money(c.price, cur)} / ${c.unit}` : 'No price set'}</strong> · ${c.used} request item${c.used === 1 ? '' : 's'}</p>
              </div>
              <div class="cat-actions">
                <form method="post" action="/admin/categories/${c.id}/toggle" class="inline">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${icon(c.is_active ? 'eye-off' : 'eye')} ${c.is_active ? 'Hide' : 'Show'}</button></form>
                <form method="post" action="/admin/categories/${c.id}/delete" class="inline" data-confirm="Delete “${c.name}”? Past requests keep their history.">${csrfField(ctx)}<button class="btn btn-danger btn-sm" type="submit" aria-label="Delete ${c.name}">${icon('trash-2')}</button></form>
              </div>
            </div>
            <details>
              <summary>${icon('pencil')} Edit</summary>
              <form method="post" action="/admin/categories/${c.id}" class="stack">
                ${csrfField(ctx)}
                ${fields(ctx, c)}
                <button class="btn btn-primary btn-sm" type="submit">Save changes</button>
              </form>
            </details>
          </article>`
        )
      : html`<div class="glass pad empty"><div class="big">${icon('tag')}</div><p>No categories yet. Add your first one above.</p></div>`}
  </section>`;

  return adminLayout(ctx, { title: 'Categories', active: 'categories', body });
}

module.exports = { categoriesPage };
