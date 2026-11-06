const { html, raw, esc } = require('../../lib/html');
const { STATUS_MAP, FLOW, paymentState } = require('../../lib/helpers');

const csrfField = (ctx) => raw(`<input type="hidden" name="_csrf" value="${esc(ctx.csrf || '')}">`);

const statusBadge = (key) => {
  const s = STATUS_MAP[key] || { label: key, icon: '•', color: '#94a3b8' };
  return html`<span class="badge" style="--bc:${s.color}">${s.icon} ${s.label}</span>`;
};

const paymentBadge = (total, paid) => {
  const p = paymentState(total, paid);
  return html`<span class="badge pay-${p.key}">${p.label}</span>`;
};

// Progress tracker used on the public tracking page and the admin request page.
const timeline = (status) => {
  if (status === 'cancelled') {
    return html`<div class="cancelled-note">✖️ This request was cancelled.</div>`;
  }
  const idx = FLOW.indexOf(status);
  return html`<ol class="timeline">
    ${FLOW.map((key, i) => {
      const s = STATUS_MAP[key];
      const cls = i < idx ? 'done' : i === idx ? 'current' : '';
      return html`<li class="${cls}"><span class="dot">${s.icon}</span><span class="tl-label">${s.label}</span></li>`;
    })}
  </ol>`;
};

const pager = (base, page, pages) => {
  if (pages <= 1) return '';
  const link = (p, label, disabled) =>
    disabled
      ? html`<span class="page disabled">${label}</span>`
      : html`<a class="page" href="${base}${base.includes('?') ? '&' : '?'}page=${p}">${label}</a>`;
  return html`<div class="pager">
    ${link(page - 1, '← Prev', page <= 1)}
    <span class="page-info">Page ${page} of ${pages}</span>
    ${link(page + 1, 'Next →', page >= pages)}
  </div>`;
};

module.exports = { csrfField, statusBadge, paymentBadge, timeline, pager };
