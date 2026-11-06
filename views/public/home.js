const { html, raw } = require('../../lib/html');
const { money } = require('../../lib/helpers');
const { publicLayout } = require('../layouts/public');
const { logo } = require('../partials/logo');
const { themeSwitch } = require('../partials/theme');
const { icon, svg, categoryIconName } = require('../../lib/icons');

function nav(s) {
  return html`<header class="nav glass">
    <a class="brand" href="/">${logo({ prefix: 'nav', animated: false, className: 'brand-logo' })}<span>${s.business_name}</span></a>
    <nav class="nav-links" aria-label="Main">
      <a href="#categories">Categories</a>
      <a href="#how">How it works</a>
      <a href="/track">Track order</a>
      <a href="#contact">Contact</a>
    </nav>
    ${themeSwitch()}
    <button class="btn btn-primary btn-sm" type="button" data-open-wizard>${icon('pointer')} Tap to wash</button>
  </header>`;
}

function categoryCard(c, currency) {
  const price = c.price !== null && c.price !== undefined ? `From ${money(c.price, currency)} / ${c.unit}` : 'Price on request';
  return html`<article class="cat-card glass" data-id="${c.id}" style="--c:${c.color}" tabindex="0" role="button" aria-pressed="false" aria-label="Select ${c.name}">
    <span class="cat-icon">${icon(categoryIconName(c.icon))}</span>
    <h3>${c.name}</h3>
    <p>${c.description}</p>
    <div class="cat-foot"><span class="price">${price}</span><span class="cat-check" aria-hidden="true">${icon('plus')}</span></div>
  </article>`;
}

function contactBlock(s) {
  const waDigits = String(s.whatsapp || '').replace(/\D/g, '');
  const items = [
    s.phone && html`<li><span>${icon('phone')}</span><a href="tel:${s.phone}">${s.phone}</a></li>`,
    waDigits && html`<li><span>${icon('message-circle')}</span><a href="https://wa.me/${waDigits}" target="_blank" rel="noopener">WhatsApp us</a></li>`,
    s.email && html`<li><span>${icon('mail')}</span><a href="mailto:${s.email}">${s.email}</a></li>`,
    s.address && html`<li><span>${icon('map-pin')}</span>${s.address}</li>`,
    s.opening_hours && html`<li><span>${icon('clock')}</span>${s.opening_hours}</li>`,
  ].filter(Boolean);
  return items.length
    ? html`<ul class="contact-list">${items}</ul>`
    : html`<p class="muted">Contact details will appear here soon.</p>`;
}

function wizard(s) {
  return html`<div class="modal" id="wizard" hidden>
    <div class="modal-backdrop" data-close></div>
    <div class="modal-card glass-strong" role="dialog" aria-modal="true" aria-labelledby="wizTitle">
      <button class="modal-x" type="button" data-close aria-label="Close">${icon('x')}</button>

      <div class="wiz-head">
        <div class="wiz-logo">${logo({ prefix: 'wiz', animated: true })}</div>
        <div>
          <h2 id="wizTitle">Tap to wash</h2>
          <p class="muted" id="wizSub">Tell us what to wash and where to find you.</p>
        </div>
      </div>

      <ol class="wiz-steps" id="wizSteps">
        <li data-s="1"><span>1</span> What to wash</li>
        <li data-s="2"><span>2</span> Where you are</li>
        <li data-s="3"><span>3</span> Your details</li>
      </ol>

      <section class="wiz-pane" data-pane="1">
        <div id="picker" class="picker"></div>
        <p class="err" id="err1" role="alert"></p>
      </section>

      <section class="wiz-pane" data-pane="2" hidden>
        <button type="button" class="btn btn-accent btn-block" id="locBtn">${icon('map-pin')} Share my location</button>
        <p class="muted small" id="locStatus">Tap the button so our rider can find you quickly. Your location is only used for this request.</p>
        <div class="mapbox" id="mapBox" hidden>
          <iframe id="mapFrame" title="Your location on the map" loading="lazy"></iframe>
          <button type="button" class="link-btn" id="locClear">Remove shared location</button>
        </div>
        <label class="field">
          <span>Describe where you are <em>*</em></span>
          <textarea id="locDesc" rows="3" maxlength="500" placeholder="e.g. Blue gate opposite the pharmacy, Block B, 3rd floor, door 12"></textarea>
        </label>
        <p class="err" id="err2" role="alert"></p>
      </section>

      <section class="wiz-pane" data-pane="3" hidden>
        <div class="grid-2">
          <label class="field"><span>Your name <em>*</em></span><input id="fName" type="text" maxlength="80" autocomplete="name" placeholder="Jane Wanjiku"></label>
          <label class="field"><span>Phone number <em>*</em></span><input id="fPhone" type="tel" maxlength="20" autocomplete="tel" inputmode="tel" placeholder="0712 345 678"></label>
        </div>
        <label class="field"><span>Preferred pick-up time</span><input id="fTime" type="text" maxlength="80" placeholder="e.g. Tomorrow morning, after 4 PM"></label>
        <label class="field"><span>Anything we should know?</span><textarea id="fNotes" rows="2" maxlength="1000" placeholder="Stains, delicate fabrics, special care…"></textarea></label>
        <input type="text" id="fWebsite" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="summary" id="summary"></div>
        <p class="err" id="err3" role="alert"></p>
      </section>

      <section class="wiz-pane success" data-pane="done" hidden>
        <div class="success-burst">${icon('party-popper')}</div>
        <h3>Request received!</h3>
        <p class="muted">Keep your reference code. We will call you shortly to confirm pick-up.</p>
        <div class="ref-box" id="refBox">—</div>
        <div class="success-actions">
          <a class="btn btn-primary" id="trackLink" href="/track">Track my order</a>
          <button type="button" class="btn btn-ghost" data-close>Close</button>
        </div>
      </section>

      <div class="wiz-actions" id="wizActions">
        <button type="button" class="btn btn-ghost" id="backBtn">Back</button>
        <button type="button" class="btn btn-primary" id="nextBtn">Next ${icon('arrow-right')}</button>
      </div>
    </div>
  </div>`;
}

function homePage(ctx, categories) {
  const s = ctx.settings;
  const data = categories.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    icon: svg(categoryIconName(c.icon)),
    color: c.color,
    price: c.price === null ? null : Number(c.price),
    unit: c.unit,
  }));
  const json = JSON.stringify({
    categories: data,
    currency: s.currency,
    ui: {
      pin: svg('map-pin'),
      refresh: svg('refresh-cw'),
      loader: svg('loader-circle', { cls: 'spin' }),
      pointer: svg('pointer'),
      check: svg('check'),
      plus: svg('plus'),
      minus: svg('minus'),
      arrow: svg('arrow-right'),
    },
  }).replace(/</g, '\\u003c');

  const body = html`
  ${nav(s)}

  <section class="hero container">
    <div class="hero-copy">
      <span class="pill">${icon('droplets')} Pick-up &amp; delivery laundry</span>
      <h1>${s.tagline}</h1>
      <p class="lead">${s.about}</p>
      <div class="hero-actions">
        <button class="btn btn-primary btn-lg" type="button" data-open-wizard>${icon('pointer')} Tap to wash</button>
        <a class="btn btn-ghost btn-lg" href="#categories">See what we wash</a>
      </div>
      <ul class="hero-points">
        <li>${icon('zap')} Fast turnaround</li>
        <li>${icon('map-pin')} We come to you</li>
        <li>${icon('sparkles')} Fresh &amp; folded</li>
      </ul>
    </div>

    <div class="hero-visual">
      <button class="tap-scene" type="button" id="tapScene" data-open-wizard aria-label="Tap to wash - start your laundry request">
        <span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>
        <span class="tap-glass glass-strong">${logo({ prefix: 'hero', animated: true })}</span>
        <span class="tap-label">TAP TO WASH</span>
      </button>
      <span class="float-chip c1">${icon('sparkles')} Spotless</span>
      <span class="float-chip c2">${icon('flower-2')} Fresh scent</span>
      <span class="float-chip c3">${icon('truck')} Doorstep</span>
    </div>
  </section>

  <section class="section container" id="categories">
    <div class="section-head">
      <span class="pill">Step 1</span>
      <h2>What would you like washed?</h2>
      <p class="muted">Select one or more categories, then tap to wash.</p>
    </div>
    ${categories.length
      ? html`<div class="cat-grid" id="catGrid">${categories.map((c) => categoryCard(c, s.currency))}</div>`
      : html`<div class="empty glass"><div class="big">${icon('shopping-basket')}</div><p>Our services are being set up. Please check back soon!</p></div>`}
  </section>

  <section class="section container" id="how">
    <div class="section-head">
      <span class="pill">Simple</span>
      <h2>How it works</h2>
    </div>
    <div class="steps-grid">
      <div class="step glass"><span class="step-no">1</span><div class="step-ico">${icon('pointer')}</div><h3>Tap</h3><p>Choose what to wash and tap the machine.</p></div>
      <div class="step glass"><span class="step-no">2</span><div class="step-ico">${icon('map-pin')}</div><h3>Share location</h3><p>Send where you are with a short description.</p></div>
      <div class="step glass"><span class="step-no">3</span><div class="step-ico">${icon('truck')}</div><h3>We collect</h3><p>Our rider confirms by phone and picks up.</p></div>
      <div class="step glass"><span class="step-no">4</span><div class="step-ico">${icon('sparkles')}</div><h3>Fresh delivery</h3><p>Washed, dried and folded, back at your door.</p></div>
    </div>
  </section>

  <section class="section container">
    <div class="cta glass-strong">
      <div>
        <h2>Ready for fresh clothes?</h2>
        <p>It takes less than a minute to place a request.</p>
      </div>
      <button class="btn btn-primary btn-lg" type="button" data-open-wizard>${icon('pointer')} Tap to wash</button>
    </div>
  </section>

  <footer class="footer container" id="contact">
    <div class="footer-grid glass">
      <div>
        <a class="brand" href="/">${logo({ prefix: 'foot', animated: false, className: 'brand-logo' })}<span>${s.business_name}</span></a>
        <p class="muted">${s.tagline}</p>
      </div>
      <div><h4>Contact</h4>${contactBlock(s)}</div>
      <div><h4>Quick links</h4><ul class="contact-list"><li><a href="/track">Track my order</a></li><li><a href="#categories">Categories</a></li><li><a href="/admin">Staff login</a></li></ul></div>
    </div>
    <p class="copy">© ${new Date().getFullYear()} ${s.business_name}. All rights reserved.</p>
  </footer>

  <div class="selbar glass-strong" id="selBar" hidden>
    <span id="selText">0 selected</span>
    <button class="btn btn-primary btn-sm" type="button" data-open-wizard>${icon('pointer')} Tap to wash</button>
  </div>

  ${wizard(s)}
  <script type="application/json" id="app-data">${raw(json)}</script>`;

  return publicLayout(ctx, { body, scripts: raw('<script src="/js/app.js"></script>'), bodyClass: 'public' });
}

module.exports = { homePage };
