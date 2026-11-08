const { html } = require('../../lib/html');
const { fmtDate, STATUS_MAP } = require('../../lib/helpers');
const { publicLayout } = require('../layouts/public');
const { timeline } = require('../partials/ui');
const { pubNav } = require('../partials/pubnav');
const { icon } = require('../../lib/icons');

function trackPage(ctx, { ref = '', error = '', result = null, info = '' }) {
  const s = ctx.settings;
  const body = html`
  ${pubNav(ctx, 'track')}

  <main class="container narrow section" style="padding-top:calc(var(--nav-h) + 2.5rem)">
    <div class="section-head">
      <span class="pill">Track</span>
      <h2>Where is my laundry?</h2>
      <p class="muted">Enter your reference code and the phone number you used.</p>
    </div>

    <form class="glass pad" method="get" action="/track">
      <div class="grid-2">
        <label class="field"><span>Reference code</span><input name="ref" value="${ref}" placeholder="TTW-XXXXXX" maxlength="20" required autocapitalize="characters"></label>
        <label class="field"><span>Phone number</span><input name="phone" type="tel" placeholder="0712 345 678" maxlength="20" required></label>
      </div>
      <button class="btn btn-primary" type="submit">Check status</button>
      ${error ? html`<p class="err show">${error}</p>` : ''}
      ${info ? html`<p class="success show">${info}</p>` : ''}
    </form>

    ${result
      ? html`<section class="glass pad result">
          <div class="result-head">
            <div><span class="muted small">Reference</span><div class="ref-box sm">${result.ref_code}</div></div>
            <div class="result-status" style="--bc:${STATUS_MAP[result.status].color}">${STATUS_MAP[result.status].icon} ${STATUS_MAP[result.status].label}</div>
          </div>
          ${timeline(result.status)}
          <h3>Items</h3>
          <ul class="plain-list">${result.items.map((i) => html`<li>${i.category_name} <strong>× ${i.quantity}</strong></li>`)}</ul>
          ${result.pickup_scheduled_at || result.delivery_scheduled_at || result.dispatch_stage ? html`<h3>Collection and delivery</h3><p class="muted small">${result.dispatch_stage ? `Dispatch: ${result.dispatch_stage} · ` : ''}${result.pickup_scheduled_at ? `Pickup scheduled: ${fmtDate(result.pickup_scheduled_at)}` : ''}${result.delivery_scheduled_at ? ` · Delivery scheduled: ${fmtDate(result.delivery_scheduled_at)}` : ''}</p>` : ''}
          ${result.garments && result.garments.length ? html`<h3>Individual garment progress</h3><ul class="plain-list">${result.garments.map(g=>html`<li>${g.item_name} <strong>${g.process_status}</strong></li>`)}</ul>` : ''}
          <h3>Updates</h3>
          <ul class="events">${result.events.map((e) => html`<li><span class="ev-dot"></span><div><strong>${STATUS_MAP[e.status] ? STATUS_MAP[e.status].label : e.status}</strong><span class="muted small"> · ${fmtDate(e.created_at)}</span>${e.note ? html`<p class="muted small">${e.note}</p>` : ''}</div></li>`)}</ul>
          <form class="glass pad feedback-form" method="post" action="/track/feedback"><h3>Feedback and support</h3><input type="hidden" name="ref" value="${result.ref_code}"><label class="field"><span>Phone number used for this order</span><input name="phone" type="tel" required></label><label class="field"><span>Feedback type</span><select name="kind"><option value="review">Rate my laundry service</option><option value="complaint">Report a problem</option></select></label><label class="field"><span>Rating (1–5)</span><select name="rating"><option value="5">5 - Excellent</option><option value="4">4 - Good</option><option value="3">3 - Average</option><option value="2">2 - Poor</option><option value="1">1 - Very poor</option></select></label><label class="field"><span>Comment / issue details</span><textarea name="comment" rows="3" maxlength="1500"></textarea></label><button class="btn btn-primary" type="submit">Send feedback</button></form>
        </section>`
      : ''}
  </main>`;

  return publicLayout(ctx, { title: 'Track order', body, bodyClass: 'public' });
}

function messagePage(ctx, { title, message, code = '' }) {
  const body = html`
  <header class="nav scrolled"><a class="brand" href="/"><span>${ctx.settings.business_name}</span></a></header>
  <main class="container narrow section center" style="padding-top:calc(var(--nav-h) + 2.5rem)">
    <div class="glass pad">
      <div class="big">${icon(code === '404' ? 'shopping-basket' : 'droplets')}</div>
      <h2>${title}</h2>
      <p class="muted">${message}</p>
      <a class="btn btn-primary" href="/">Back to home</a>
    </div>
  </main>`;
  return publicLayout(ctx, { title, body, bodyClass: 'public' });
}

module.exports = { trackPage, messagePage };
