(function () {
  'use strict';

  const data = JSON.parse(document.getElementById('app-data').textContent || '{}');
  const categories = data.categories || [];
  const currency = data.currency || 'KES';
  const ui = data.ui || {};
  const byId = new Map(categories.map((c) => [c.id, c]));

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // state.items: { categoryId: quantity }
  const state = { items: {}, lat: null, lng: null, acc: null, step: 1, sending: false };

  const modal = $('#wizard');
  const picker = $('#picker');
  const selBar = $('#selBar');
  const selText = $('#selText');
  const backBtn = $('#backBtn');
  const nextBtn = $('#nextBtn');
  const actions = $('#wizActions');
  const stepsEl = $('#wizSteps');
  const sub = $('#wizSub');
  const subtitles = {
    1: 'Pick what you would like washed.',
    2: 'Share where we should collect from.',
    3: 'Last step - how can we reach you?',
  };

  const money = (n) => currency + ' ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const selectedIds = () => Object.keys(state.items).map(Number);

  /* ---------- selection on the page cards ---------- */
  function syncCards() {
    $$('.cat-card').forEach((card) => {
      const on = state.items[card.dataset.id] !== undefined;
      card.classList.toggle('selected', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
      const check = $('.cat-check', card);
      if (check) check.innerHTML = on ? ui.check : ui.plus;
    });
    const n = selectedIds().length;
    if (selBar) {
      selBar.hidden = n === 0 || !modal.hidden;
      selText.textContent = n + (n === 1 ? ' category selected' : ' categories selected');
    }
  }

  function toggleCategory(id) {
    if (state.items[id] !== undefined) delete state.items[id];
    else state.items[id] = 1;
    syncCards();
    if (!modal.hidden) renderPicker();
  }

  $$('.cat-card').forEach((card) => {
    card.addEventListener('click', () => toggleCategory(card.dataset.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCategory(card.dataset.id);
      }
    });
  });

  /* ---------- wizard: step 1 picker ---------- */
  function renderPicker() {
    if (!categories.length) {
      picker.innerHTML = '<p class="muted">Services are being set up. Please check back soon.</p>';
      return;
    }
    picker.innerHTML = '';
    categories.forEach((c) => {
      const qty = state.items[c.id];
      const on = qty !== undefined;
      const row = document.createElement('div');
      row.className = 'pick' + (on ? ' on' : '');
      row.style.setProperty('--c', c.color);

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'pick-main';
      main.setAttribute('aria-pressed', on ? 'true' : 'false');
      const ico = document.createElement('span');
      ico.className = 'pick-ico';
      if (c.imageUrl) {
        const photo = document.createElement('img');
        photo.className = 'pick-photo';
        photo.src = c.imageUrl;
        photo.alt = '';
        photo.loading = 'lazy';
        photo.onerror = function () { photo.remove(); ico.innerHTML = c.icon; };
        ico.appendChild(photo);
      } else {
        ico.innerHTML = c.icon; // trusted SVG rendered by the server
      }
      const txt = document.createElement('span');
      txt.className = 'pick-txt';
      const nm = document.createElement('strong');
      nm.textContent = c.name;
      const pr = document.createElement('small');
      pr.textContent = c.price !== null ? 'From ' + money(c.price) + ' / ' + c.unit : 'Price on request';
      txt.append(nm, pr);
      const chk = document.createElement('span');
      chk.className = 'pick-check';
      chk.innerHTML = on ? ui.check : '';
      main.append(ico, txt, chk);
      main.addEventListener('click', () => toggleCategory(String(c.id)));
      row.appendChild(main);

      if (on) {
        const q = document.createElement('div');
        q.className = 'qty';
        const minus = document.createElement('button');
        minus.type = 'button';
        minus.innerHTML = ui.minus;
        minus.setAttribute('aria-label', 'Less ' + c.name);
        const val = document.createElement('span');
        val.textContent = qty + ' ' + c.unit;
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.innerHTML = ui.plus;
        plus.setAttribute('aria-label', 'More ' + c.name);
        minus.addEventListener('click', () => {
          state.items[c.id] = Math.max(1, state.items[c.id] - 1);
          renderPicker();
        });
        plus.addEventListener('click', () => {
          state.items[c.id] = Math.min(999, state.items[c.id] + 1);
          renderPicker();
        });
        q.append(minus, val, plus);
        row.appendChild(q);
      }
      picker.appendChild(row);
    });
  }

  /* ---------- wizard: navigation ---------- */
  function showError(n, msg) {
    const el = $('#err' + n);
    if (el) {
      el.textContent = msg || '';
      el.classList.toggle('show', !!msg);
    }
  }

  function goStep(n) {
    state.step = n;
    $$('.wiz-pane').forEach((p) => (p.hidden = p.dataset.pane !== String(n)));
    $$('li', stepsEl).forEach((li) => {
      const s = Number(li.dataset.s);
      li.classList.toggle('active', s === n);
      li.classList.toggle('done', s < n);
    });
    const done = n === 'done';
    stepsEl.hidden = done;
    actions.hidden = done;
    if (!done) {
      sub.textContent = subtitles[n];
      backBtn.style.visibility = n === 1 ? 'hidden' : 'visible';
      nextBtn.innerHTML = n === 3 ? ui.send + ' Send my request' : 'Next ' + ui.arrow;
      nextBtn.disabled = false;
    } else {
      sub.textContent = 'All done!';
    }
    if (n === 3) renderSummary();
    const card = $('.modal-card');
    if (card) card.scrollTop = 0;
  }

  function renderSummary() {
    const box = $('#summary');
    let total = 0;
    let hasPrice = false;
    const lines = selectedIds().map((id) => {
      const c = byId.get(id);
      const q = state.items[id];
      if (c.price !== null) {
        total += c.price * q;
        hasPrice = true;
      }
      return '<li><span class="sum-name">' + c.icon + ' ' + esc(c.name) + '</span><strong>× ' + q + ' ' + esc(c.unit) + '</strong></li>';
    });
    box.innerHTML =
      '<h4>Your request</h4><ul>' +
      lines.join('') +
      '</ul>' +
      (state.lat !== null ? '<p class="small sum-loc">' + ui.pin + ' Location shared</p>' : '') +
      (hasPrice ? '<p class="small muted">Estimated from ' + money(total) + ' - final price is confirmed after weighing/inspection.</p>' : '');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function next() {
    if (state.step === 1) {
      if (!selectedIds().length) return showError(1, 'Please choose at least one category.');
      showError(1, '');
      return goStep(2);
    }
    if (state.step === 2) {
      if ($('#locDesc').value.trim().length < 3) return showError(2, 'Please describe where you are (landmark, building, door number…).');
      showError(2, '');
      return goStep(3);
    }
    if (state.step === 3) submit();
  }

  nextBtn.addEventListener('click', next);
  backBtn.addEventListener('click', () => {
    if (typeof state.step === 'number' && state.step > 1) goStep(state.step - 1);
  });

  /* ---------- open / close ---------- */
  let lastFocus = null;
  function openWizard() {
    if (!data.me) { window.location.href = '/account/login?next=' + encodeURIComponent('/?start=1'); return; } // booking needs an account
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    selBar.hidden = true;
    renderPicker();
    if (state.step === 'done') resetForm();
    goStep(state.step);
    setTimeout(() => nextBtn.focus(), 50);
  }
  function closeWizard() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    syncCards();
    if (state.step === 'done') resetForm();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function resetForm() {
    state.items = {};
    state.lat = state.lng = state.acc = null;
    state.step = 1;
    ['#locDesc', '#fName', '#fPhone', '#fTime', '#fNotes'].forEach((s) => ($(s).value = ''));
    if ($('#fBranch')) $('#fBranch').value = '';
    $('#fTerms').checked = false;
    clearLocation();
    applyMe(false);
    syncCards();
  }

  $$('[data-open-wizard]').forEach((b) => b.addEventListener('click', openWizard));
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeWizard));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeWizard();
  });

  /* ---------- location ---------- */
  const locBtn = $('#locBtn');
  const locStatus = $('#locStatus');
  const mapBox = $('#mapBox');
  const mapFrame = $('#mapFrame');

  function showMap(lat, lng) {
    const d = 0.004;
    mapFrame.src =
      'https://www.openstreetmap.org/export/embed.html?bbox=' +
      [lng - d, lat - d * 0.65, lng + d, lat + d * 0.65].join('%2C') +
      '&layer=mapnik&marker=' + lat + '%2C' + lng;
    mapBox.hidden = false;
  }

  function clearLocation() {
    state.lat = state.lng = state.acc = null;
    mapBox.hidden = true;
    mapFrame.removeAttribute('src');
    locBtn.innerHTML = ui.pin + ' Share my location';
    locStatus.textContent = 'Tap the button so our rider can find you quickly. Your location is only used for this request.';
  }
  $('#locClear').addEventListener('click', clearLocation);

  locBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      locStatus.textContent = 'Your browser cannot share location. Please describe where you are below.';
      return;
    }
    locBtn.disabled = true;
    locBtn.innerHTML = ui.loader + ' Finding you…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.lat = pos.coords.latitude;
        state.lng = pos.coords.longitude;
        state.acc = pos.coords.accuracy;
        showMap(state.lat, state.lng);
        locBtn.disabled = false;
        locBtn.innerHTML = ui.refresh + ' Update my location';
        locStatus.textContent = 'Location captured (about ' + Math.round(state.acc) + ' m accuracy). Now describe where you are.';
        showError(2, '');
      },
      (err) => {
        locBtn.disabled = false;
        locBtn.innerHTML = ui.pin + ' Try again';
        locStatus.textContent =
          err.code === 1
            ? 'Location permission was blocked. You can allow it in your browser settings, or just describe where you are below.'
            : 'We could not get your location. Please try again, or describe where you are below.';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });


  /* ---------- "Request received" receipt ---------- */
  function renderReceipt(name, phone) {
    const box = $('#rcBody');
    if (!box) return;
    let total = 0;
    let hasPrice = false;
    let count = 0;
    const rows = selectedIds().map((id) => {
      const c = byId.get(id);
      const q = state.items[id];
      count += q;
      const priced = c.price !== null;
      if (priced) { total += c.price * q; hasPrice = true; }
      return '<li class="rc-row"><span class="rc-thumb">' + c.icon + '</span><div class="rc-nm"><b>' + esc(c.name) + '</b>' +
        (priced ? '<small>' + money(c.price) + ' per ' + esc(c.unit) + '</small>' : '<small>Price on request</small>') + '</div>' +
        '<span class="rc-qty">× ' + q + '</span>' + (priced ? '<span class="rc-lt">' + money(c.price * q) + '</span>' : '') + '</li>';
    });
    const when = new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
    const loc = ($('#locDesc').value || '').trim();
    const pref = ($('#fTime').value || '').trim();
    const info = (ico, label, val) => '<div>' + ico + '<span><small>' + label + '</small><b>' + esc(val) + '</b></span></div>';
    const steps = ['New', 'Confirmed', 'Picked up', 'Washing', 'Ready', 'Delivered'];
    box.innerHTML =
      '<div class="rc-title"><h2 style="margin:0;font-size:1.28rem">Order receipt</h2><span class="rc-badge">Received</span></div>' +
      '<p class="rc-sub"><span>' + ui.clock + ' ' + esc(when) + '</span><span>' + count + (count === 1 ? ' item' : ' items') + '</span></p>' +
      '<div class="rc-chips" aria-label="Order progress">' + steps.map((t, i) => '<span class="rc-chip' + (i === 0 ? ' now' : '') + '">' + esc(t) + '</span>').join('') + '</div>' +
      '<h3 class="rc-h">Order items <small>' + rows.length + (rows.length === 1 ? ' service' : ' services') + '</small></h3><ul class="rc-rows">' + rows.join('') + '</ul>' +
      '<h3 class="rc-h">Your details</h3><div class="rc-info">' +
      info(ui.user, 'Name', name) + info(ui.phone, 'Phone', phone) + info(ui.pin, 'Pick-up location' + (state.lat !== null ? ' (shared on map)' : ''), loc || 'Shared location') +
      (pref ? info(ui.clock, 'Preferred pick-up time', pref) : '') + '</div>' +
      '<section class="rc-total" aria-label="Estimate">' +
      (hasPrice
        ? '<div class="rc-big" style="border-top:0;margin-top:0;padding-top:0"><span>Estimated total</span><strong>' + money(total) + '</strong></div><p class="rc-note">Final price is confirmed after weighing or inspection.</p>'
        : '<div class="rc-big" style="border-top:0;margin-top:0;padding-top:0"><span>Price</span><strong>To be confirmed</strong></div><p class="rc-note">We will confirm the price after weighing or inspection.</p>') +
      '<div class="rc-tags"><span class="rc-tag solid">Received</span><span class="rc-tag">Awaiting confirmation</span></div></section>';
  }

  /* ---------- submit ---------- */
  async function submit() {
    if (state.sending) return;
    const name = $('#fName').value.trim();
    const phone = $('#fPhone').value.trim();
    if (name.length < 2) return showError(3, 'Please enter your name.');
    if (phone.replace(/\D/g, '').length < 9) return showError(3, 'Please enter a valid phone number.');
    if (!$('#fTerms').checked) return showError(3, 'Please accept the Terms of Service to continue.');
    showError(3, '');

    state.sending = true;
    nextBtn.disabled = true;
    nextBtn.textContent = 'Sending…';
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          location_description: $('#locDesc').value,
          notes: $('#fNotes').value,
          preferred_time: $('#fTime').value,
          branch_id: $('#fBranch') ? $('#fBranch').value : '',
          latitude: state.lat,
          longitude: state.lng,
          accuracy: state.acc,
          website: $('#fWebsite').value,
          accept_terms: true,
          terms_version: data.termsVersion,
          items: selectedIds().map((id) => ({ category_id: id, quantity: state.items[id] })),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401 && out.login) { window.location.href = out.login; return; }
      if (!res.ok || !out.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
      $('#refBox').textContent = out.ref;
      renderReceipt(name, phone);
      $('#trackLink').href = me ? '/account/requests/' + encodeURIComponent(out.ref) : '/track?ref=' + encodeURIComponent(out.ref);
      const wa = $('#waLink');
      if (wa && data.whatsapp) {
        const msg = 'Hello ' + (data.business || '') + ', I just sent laundry request ' + out.ref + '. My name is ' + name + '.';
        wa.href = 'https://wa.me/' + data.whatsapp + '?text=' + encodeURIComponent(msg);
        wa.hidden = false;
      }
      goStep('done');
    } catch (err) {
      showError(3, err.message);
      nextBtn.disabled = false;
      nextBtn.innerHTML = ui.send + ' Send my request';
    } finally {
      state.sending = false;
    }
  }

  /* ---------- signed-in customers: pre-filled details, saved places, request again ---------- */
  const me = data.me;
  function applyMe(withAgain) {
    if (!me) return;
    $('#fName').value = me.name || '';
    $('#fPhone').value = me.phone || '';
    if (withAgain && me.again) {
      state.items = {};
      (me.again.items || []).forEach((it) => {
        if (byId.has(it.category_id)) state.items[it.category_id] = Math.min(999, Math.max(1, it.quantity || 1));
      });
      $('#locDesc').value = me.again.text || '';
      $('#fTime').value = me.again.time || '';
    }
  }
  if (me) {
    const box = $('#placesBox');
    const sel = $('#placesSel');
    if (me.places && me.places.length && box && sel) {
      me.places.forEach((p, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = p.text.length > 70 ? p.text.slice(0, 67) + '…' : p.text;
        sel.appendChild(o);
      });
      box.hidden = false;
      sel.addEventListener('change', () => {
        const p = me.places[Number(sel.value)];
        if (p) {
          $('#locDesc').value = p.text;
          showError(2, '');
        }
      });
    }
    applyMe(true);
    syncCards();
    if (me.start) openWizard();
  }

  syncCards();
})();
