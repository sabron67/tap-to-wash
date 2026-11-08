const { html } = require('../../lib/html');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { icon } = require('../../lib/icons');

const LABELS = {
  off: 'Not linked',
  starting: 'Starting…',
  qr: 'Waiting for you to scan the QR code',
  ready: 'Linked and ready',
  disconnected: 'Disconnected - reconnecting',
  error: 'Problem',
};

function whatsappPage(ctx, { status, myPhone }) {
  const s = status;
  const body = html`
  <section class="glass pad stack" data-wa-status data-state="${s.state}">
    <div class="card-head"><h2>WhatsApp connection</h2><span class="badge ${s.state === 'ready' ? 'pay-paid' : s.state === 'error' ? 'pay-unpaid' : 'pay-partial'}" data-wa-label>${LABELS[s.state] || s.state}</span></div>
    ${!s.enabled
      ? html`<p class="muted">Automatic WhatsApp is switched off with <span class="mono">WHATSAPP_WEB=0</span>. Staff alerts fall back to tap-to-send links${s.meta ? ' and the Meta WhatsApp Business API' : ''}.</p>`
      : html`
    <p class="muted small">The server signs in to WhatsApp Web as a linked device and sends staff job alerts and password-reset codes automatically. Use a number that belongs to the business.</p>
    <p data-wa-number class="strong" ${s.state === 'ready' && s.number ? '' : 'hidden'}>Linked number: <span class="mono" data-wa-num>+${s.number}</span></p>
    <p class="err ${s.error ? 'show' : ''}" data-wa-error role="alert">${s.error}</p>
    <div class="wa-qr" data-wa-qrbox ${s.state === 'qr' && s.qr ? '' : 'hidden'}>
      <img data-wa-qr alt="WhatsApp QR code" width="280" height="280" src="${s.qr || 'data:,'}">
      <ol class="sheet-list">
        <li>Open WhatsApp on the business phone.</li>
        <li>Go to <strong>Settings → Linked devices → Link a device</strong>.</li>
        <li>Point the phone at this code. It refreshes by itself.</li>
      </ol>
    </div>
    <div class="row-gap">
      <form method="post" action="/admin/whatsapp/restart" class="inline">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${icon('refresh-cw')} Restart connection</button></form>
      <form method="post" action="/admin/whatsapp/repair" class="inline" data-confirm="Reset the WhatsApp encryption sessions? You do not need to scan the QR code again.">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${icon('shield-check')} Fix “Waiting for this message”</button></form>
      <form method="post" action="/admin/whatsapp/logout" class="inline" data-confirm="Unlink WhatsApp? Automatic alerts and reset codes stop until you scan a new QR code.">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${icon('log-out')} Unlink</button></form>
    </div>`}
  </section>

  ${s.enabled
    ? html`<form class="glass pad stack" method="post" action="/admin/whatsapp/test">
    ${csrfField(ctx)}
    <h2>Send a test</h2>
    <p class="muted small">Sends a short message to the number below to confirm everything works.</p>
    <label class="field"><span>WhatsApp number</span><input type="tel" name="phone" value="${myPhone}" maxlength="20" placeholder="0712 345 678" required></label>
    <button class="btn btn-primary" type="submit">${icon('message-circle')} Send test message</button>
  </form>`
    : ''}

  <section class="glass pad">
    <h2>Who gets alerted</h2>
    <p class="muted small">New request → owner and manager · Confirmed → rider · Picked up → laundry attendant · Ready → rider · Delivered with a balance → cashier. Each person turns WhatsApp on and saves their number under <a class="link" href="/admin/account">My account</a>.</p>
  </section>`;
  return adminLayout(ctx, { title: 'WhatsApp', active: 'whatsapp', body });
}

module.exports = { whatsappPage };
