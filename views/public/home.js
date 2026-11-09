const { html, raw } = require('../../lib/html');
const { money, STATUS_MAP } = require('../../lib/helpers');
const { publicLayout } = require('../layouts/public');
const { themeSwitch } = require('../partials/theme');
const { icon, svg, categoryIconName } = require('../../lib/icons');
const { mediaUrl } = require('../../lib/media');
const { publicTabbar } = require('../partials/tabbar');

function nav(s, account) {
  return html`<header class="nav">
    <a class="brand" href="/"><span>${s.business_name}</span></a>
    <nav class="nav-links" aria-label="Main">
      <a href="#categories">Services</a>
      <a href="#how">How it works</a>
      <a href="/track">Track order</a>
      <a href="#contact">Contact</a>
      ${account ? html`<a href="/account">My account</a>` : html`<a href="/account/login">Sign in</a>`}
    </nav>
    ${themeSwitch()}
    <button class="btn btn-primary btn-sm" type="button" data-open-wizard>Tap to wash</button>
  </header>`;
}

function categoryCard(c, currency) {
  const price = c.price !== null && c.price !== undefined ? `Start from ${money(c.price, currency)} / ${c.unit}` : 'Price on request';
  return html`<article class="cat-card svc-card" data-id="${c.id}" data-name="${String(c.name).toLowerCase()}" style="--c:${c.color}" tabindex="0" role="button" aria-pressed="false" aria-label="Select ${c.name}">
    <div class="svc-pic"><span class="cat-icon">${icon(categoryIconName(c.icon))}</span></div>
    <div class="svc-body">
      <h3>${c.name}</h3>
      <p>${c.description}</p>
      <div class="cat-foot"><span class="svc-price">${price}</span><span class="cat-check" aria-hidden="true">${icon('plus')}</span></div>
    </div>
  </article>`;
}

// Order progress shown on the "Recent laundry" card: four steps mapped from the real order statuses.
const PROGRESS = [
  { label: 'Confirmed' },
  { label: 'Picked up' },
  { label: 'Washing' },
  { label: 'Delivery' },
];
const DONE_COUNT = { new: 0, confirmed: 1, picked_up: 2, washing: 2, ready: 3, delivered: 4 };

function recentCard(recent, s) {
  if (!recent) {
    return html`<div class="recent-card recent-empty">
      <div class="recent-top"><div><h3>No laundry in progress</h3><p>Tap to wash and we will come to you.</p></div></div>
      <div class="recent-actions"><button class="btn btn-primary btn-sm" type="button" data-open-wizard>Tap to wash</button><a class="btn btn-light btn-sm" href="/track">Track an order</a></div>
    </div>`;
  }
  const st = STATUS_MAP[recent.status] || { label: recent.status };
  const cancelled = recent.status === 'cancelled';
  const done = DONE_COUNT[recent.status] ?? 0;
  const when = new Date(recent.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' });
  return html`<a class="recent-card" href="/track?ref=${recent.ref_code}" aria-label="Track order ${recent.ref_code}">
    <div class="recent-top">
      <div><h3>${recent.ref_code}</h3><p>${when}${recent.items ? ` · ${recent.items}` : ''}</p></div>
      <span class="recent-pill">${st.label}</span>
    </div>
    ${cancelled
      ? ''
      : html`<ol class="recent-steps">${PROGRESS.map((p, i) => html`<li class="${i < done ? 'done' : i === done && recent.status !== 'delivered' ? 'now' : ''}"><span class="dot">${i < done ? icon('check') : ''}</span>${p.label}</li>`)}</ol>`}
  </a>`;
}

function branchCard(b, rating, imgStyle) {
  return html`<article class="branch-card">
    <div class="branch-pic" style="${raw(imgStyle)}" role="img" aria-label="${b.name} branch"><span class="branch-tag">${icon('store')} Branch</span></div>
    <div class="branch-body">
      <h3>${b.name}</h3>
      <p class="branch-meta">${icon('map-pin')} ${b.address || 'Address coming soon'}</p>
      <div class="branch-foot">
        ${rating ? html`<span class="rate">${icon('star')} ${rating.avg.toFixed(1)} <small>(${rating.count})</small></span>` : html`<span></span>`}
        ${b.phone ? html`<a class="btn btn-ghost btn-sm" href="tel:${b.phone}">${icon('phone')} Call</a>` : ''}
      </div>
    </div>
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
  return items.length ? html`<ul class="contact-list">${items}</ul>` : html`<p class="muted">Contact details will appear here soon.</p>`;
}

function wizard(signedIn, branches = []) {
  return html`<div class="modal" id="wizard" hidden>
    <div class="modal-backdrop" data-close></div>
    <div class="modal-card glass-strong" role="dialog" aria-modal="true" aria-labelledby="wizTitle">
      <button class="modal-x" type="button" data-close aria-label="Close">${icon('x')}</button>

      <div class="wiz-head">
        <h2 id="wizTitle">Tap to wash</h2>
        <p class="muted" id="wizSub">Tell us what to wash and where to find you.</p>
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
        <label class="field" id="placesBox" hidden>
          <span>Use a saved place</span>
          <select id="placesSel"><option value="">Choose an earlier place…</option></select>
        </label>
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
        ${branches.length ? html`<label class="field"><span>Nearest branch</span><select id="fBranch"><option value="">Any branch</option>${branches.map((b) => html`<option value="${b.id}">${b.name}${b.address ? ' - ' + b.address : ''}</option>`)}</select></label>` : ''}
        <label class="field"><span>Preferred pick-up time</span><input id="fTime" type="text" maxlength="80" placeholder="e.g. Tomorrow morning, after 4 PM"></label>
        <label class="field"><span>Anything we should know?</span><textarea id="fNotes" rows="2" maxlength="1000" placeholder="Stains, delicate fabrics, special care…"></textarea></label>
        ${signedIn ? '' : html`<p class="muted small guest-hint">Ordering as a guest. <a class="link" href="/account/login?next=/">Sign in</a> or <a class="link" href="/account/signup">create an account</a> to save your details.</p>`}
        <input type="text" id="fWebsite" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="summary" id="summary"></div>
        <label class="check"><input type="checkbox" id="fTerms"><span>I have read and accept the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a>. <em>*</em></span></label>
        <p class="err" id="err3" role="alert"></p>
      </section>

      <section class="wiz-pane success" data-pane="done" hidden>
        <div class="rc rc-embed">
          <header class="rc-banner">
            <div class="rc-brand"><span class="rc-mark">${icon('circle-check')}</span><div><b>Request received!</b><small>Keep your reference code</small></div></div>
            <span class="rc-ref" id="refBox">—</span>
          </header>
          <div class="rc-sheet">
            <div class="rc-grab" aria-hidden="true"></div>
            <div id="rcBody"></div>
            <p class="rc-thanks"><b>We will call you shortly</b>Our rider confirms pick-up by phone.</p>
            ${signedIn ? '' : html`<p class="rc-hint" id="acctHint">Want your orders and details saved? <a class="link" href="/account/signup">Create a free account</a> - or keep ordering as a guest.</p>`}
            <div class="rc-actions">
              <a class="btn btn-primary" id="trackLink" href="/track">${icon('clock')} Track my order</a>
              <a class="btn btn-accent" id="waLink" href="#" target="_blank" rel="noopener" hidden>${icon('message-circle')} Message us on WhatsApp</a>
              <button type="button" class="btn btn-ghost" data-close>Close</button>
            </div>
          </div>
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
  const mv = ctx.media || {};
  const img = (slot) => `--img:url(${mediaUrl(slot, mv)})`;
  const firstName = String((ctx.personal && ctx.personal.name) || '').trim().split(/\s+/)[0] || 'Guest';
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
    termsVersion: Number(s.terms_version) || 1,
    business: s.business_name,
    whatsapp: ctx.whatsapp || '',
    me: ctx.personal || null,
    ui: {
      pin: svg('map-pin'),
      refresh: svg('refresh-cw'),
      loader: svg('loader-circle', { cls: 'spin' }),
      send: svg('send'),
      check: svg('check'),
      plus: svg('plus'),
      minus: svg('minus'),
      arrow: svg('arrow-right'),
      clock: svg('clock'),
      user: svg('user-round'),
      phone: svg('phone'),
    },
  }).replace(/</g, '\\u003c');

  const body = html`
  ${nav(s, ctx.account)}
  ${publicTabbar(ctx, 'home', true)}

  <header class="home-head">
    <div class="container">
      <div class="home-top">
        <div class="home-who">
          <p class="home-hi">Welcome, <b>${firstName}</b></p>
          <p class="home-loc">${icon('map-pin')} <span>${s.address || s.business_name}</span></p>
        </div>
        <div class="home-tools">
          <span class="home-theme">${themeSwitch()}</span>
        ${ctx.account
          ? html`<a class="home-avatar" href="/account" aria-label="My account" title="My account"><span>${firstName.charAt(0).toUpperCase()}</span>${ctx.recent && ctx.recent.status !== 'delivered' && ctx.recent.status !== 'cancelled' ? html`<i class="dot" aria-hidden="true"></i>` : ''}</a>`
          : html`<a class="home-login" href="/account/login">${icon('user-round')}<span>Sign in</span></a>`}
        </div>
      </div>
      <label class="home-search">
        ${icon('search')}
        <input id="svcSearch" type="search" placeholder="Search laundry services" autocomplete="off" aria-label="Search laundry services" aria-controls="catGrid">
      </label>
      <div class="home-banner" style="${raw(img('hero'))}" role="img" aria-label="Washing machines in a laundry room">
        <div class="home-banner-txt"><b>${s.tagline}</b><span>${icon('truck')} We come to you</span></div>
      </div>
    </div>
  </header>

  <main class="sheet home-sheet">
    ${ctx.recent
      ? html`<section class="home-sec" id="recent">
      <div class="container">
        <div class="sec-row"><h2>Recent laundry</h2><a href="/account">See all ${icon('chevron-right')}</a></div>
        ${recentCard(ctx.recent, s)}
      </div>
    </section>`
      : ''}

    <section class="home-sec svc-band" id="categories" style="${raw(img('hero'))}">
      <div class="container">
        <div class="sec-row on-bg"><h2>Our services</h2><span class="sec-hint">Tap to select</span></div>
        ${categories.length
          ? html`<div class="svc-rail" id="catGrid">${categories.map((c) => categoryCard(c, s.currency))}</div><p class="muted small svc-none" id="svcNone" hidden>No service matches your search.</p>`
          : html`<div class="empty glass"><div class="big">${icon('shopping-basket')}</div><p>Our services are being set up. Please check back soon!</p></div>`}
        <button class="btn btn-primary btn-block tap-btn home-tap" type="button" data-open-wizard>Tap to wash</button>
      </div>
    </section>

    ${(ctx.branches || []).length
      ? html`<section class="home-sec" id="branches">
      <div class="container">
        <div class="sec-row"><h2>Our branches</h2></div>
        <div class="svc-rail branch-rail">${ctx.branches.map((b) => branchCard(b, ctx.rating, img('hero')))}</div>
      </div>
    </section>`
      : ''}

    <section class="band has-img alt" id="how" style="${raw(img('how'))}">
      <div class="container">
        <div class="section-head on-img rv">
          <h2>How it works</h2>
        </div>
        <div class="steps-grid" data-stagger>
          <div class="step glass"><span class="step-no">1</span><div class="step-ico">${icon('pointer')}</div><h3>Tap</h3><p>Choose what to wash and tap to wash.</p></div>
          <div class="step glass"><span class="step-no">2</span><div class="step-ico">${icon('map-pin')}</div><h3>Share location</h3><p>Send where you are with a short description.</p></div>
          <div class="step glass"><span class="step-no">3</span><div class="step-ico">${icon('truck')}</div><h3>We collect</h3><p>Our rider confirms by phone and picks up.</p></div>
          <div class="step glass"><span class="step-no">4</span><div class="step-ico">${icon('sparkles')}</div><h3>Fresh delivery</h3><p>Washed, dried and folded, back at your door.</p></div>
        </div>
      </div>
    </section>

    <footer class="footer" id="contact">
      <div class="container">
        <div class="footer-grid">
          <div>
            <a class="brand" href="/"><span>${s.business_name}</span></a>
            <p class="muted" style="margin-top:.8rem">${s.tagline}</p>
          </div>
          <div><h4>Contact</h4>${contactBlock(s)}</div>

        </div>
        <p class="copy"><a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Notice</a><br>© ${new Date().getFullYear()} ${s.business_name}. All rights reserved.</p>
      </div>
    </footer>
  </main>

  <div class="selbar glass-strong" id="selBar" hidden>
    <span id="selText">0 selected</span>
    <button class="btn btn-primary btn-sm" type="button" data-open-wizard>Tap to wash</button>
  </div>

  ${wizard(!!ctx.account, ctx.branches || [])}
  <script type="application/json" id="app-data">${raw(json)}</script>`;

  return publicLayout(ctx, { body, scripts: raw('<script src="/js/app.js"></script><script src="/js/home.js"></script><script src="/js/scroll.js"></script>'), bodyClass: 'public home' });
}

module.exports = { homePage };
