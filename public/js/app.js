(function () {
  'use strict';

  const data = JSON.parse(document.getElementById('app-data').textContent || '{}');
  const categories = data.categories || [];
  const currency = data.currency || 'KES';
  const ui = data.ui || {};
  const byId = new Map(categories.map((c) => [c.id, c]));

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // state.items: { key: quantity } where key is "categoryId" or, for categories with item options, "categoryId:optionId"
  const state = { items: {}, lat: null, lng: null, acc: null, step: 1, sending: false };
  const expanded = new Set(); // category ids whose option list is open in the picker

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
  const hasOpts = (c) => !!(c && c.options && c.options.length);
  const catOf = (key) => String(key).split(':')[0];
  const catSelected = (id) => Object.keys(state.items).some((k) => catOf(k) === String(id));
  // One entry per ordered line: { key, c, o (option or null), qty, price (unit price or null) }
  function lines() {
    const out = [];
    Object.keys(state.items).forEach((key) => {
      const parts = key.split(':');
      const c = byId.get(Number(parts[0]));
      if (!c) return;
      const o = parts[1] ? (c.options || []).find((x) => x.id === Number(parts[1])) : null;
      if (parts[1] && !o) return;
      const price = o && o.price !== null ? o.price : c.price;
      out.push({ key, c, o, qty: state.items[key], price, name: o ? c.name + ' – ' + o.name : c.name });
    });
    return out;
  }
  const selectedCount = () => new Set(Object.keys(state.items).map(catOf)).size;

  /* ---------- selection on the page cards ---------- */
  function syncCards() {
    $$('.cat-card').forEach((card) => {
      const on = catSelected(card.dataset.id);
      card.classList.toggle('selected', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
      const check = $('.cat-check', card);
      if (check) check.innerHTML = on ? ui.check : ui.plus;
    });
    const n = selectedCount();
    if (selBar) {
      selBar.hidden = n === 0 || !modal.hidden;
      selText.textContent = n + (n === 1 ? ' category selected' : ' categories selected');
    }
  }

  function toggleCategory(id) {
    const c = byId.get(Number(id));
    if (hasOpts(c)) {
      // Categories with options: open the wizard on that category so the customer picks the exact items.
      expanded.add(Number(id));
      if (modal.hidden) openWizard();
      else renderPicker();
      return;
    }
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
    const stepper = (key, label, unit) => {
      const q = document.createElement('div');
      q.className = 'qty';
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.innerHTML = ui.minus;
      minus.setAttribute('aria-label', 'Less ' + label);
      const val = document.createElement('span');
      val.textContent = state.items[key] + ' ' + unit;
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.innerHTML = ui.plus;
      plus.setAttribute('aria-label', 'More ' + label);
      minus.addEventListener('click', () => {
        if (hasOptKey(key) && state.items[key] <= 1) delete state.items[key];
        else state.items[key] = Math.max(1, state.items[key] - 1);
        syncCards();
        renderPicker();
      });
      plus.addEventListener('click', () => {
        state.items[key] = Math.min(999, state.items[key] + 1);
        renderPicker();
      });
      q.append(minus, val, plus);
      return q;
    };
    const hasOptKey = (key) => String(key).indexOf(':') > -1;

    categories.forEach((c) => {
      const withOpts = hasOpts(c);
      const qty = state.items[c.id];
      const on = withOpts ? catSelected(c.id) : qty !== undefined;
      const open = withOpts && expanded.has(c.id);
      const wrap = document.createElement('div');
      wrap.className = 'pick-group';
      const row = document.createElement('div');
      row.className = 'pick' + (on ? ' on' : '');
      row.style.setProperty('--c', c.color);

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'pick-main';
      main.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (withOpts) main.setAttribute('aria-expanded', open ? 'true' : 'false');
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
      if (withOpts) {
        const n = Object.keys(state.items).filter((k) => catOf(k) === String(c.id)).length;
        pr.textContent = n ? n + (n === 1 ? ' item chosen' : ' items chosen') : c.options.length + ' options - tap to choose';
      } else {
        pr.textContent = c.price !== null ? 'From ' + money(c.price) + ' / ' + c.unit : 'Price on request';
      }
      txt.append(nm, pr);
      const chk = document.createElement('span');
      chk.className = 'pick-check';
      chk.innerHTML = on ? ui.check : '';
      main.append(ico, txt, chk);
      main.addEventListener('click', () => {
        if (withOpts) {
          if (expanded.has(c.id)) expanded.delete(c.id); else expanded.add(c.id);
          renderPicker();
        } else {
          toggleCategory(String(c.id));
        }
      });
      row.appendChild(main);
      if (!withOpts && on) row.appendChild(stepper(String(c.id), c.name, c.unit));
      wrap.appendChild(row);

      if (open) {
        const list = document.createElement('div');
        list.className = 'opt-list';
        c.options.forEach((o) => {
          const key = c.id + ':' + o.id;
          const sel = state.items[key] !== undefined;
          const price = o.price !== null ? o.price : c.price;
          const orow = document.createElement('div');
          orow.className = 'opt' + (sel ? ' on' : '');
          const obtn = document.createElement('button');
          obtn.type = 'button';
          obtn.className = 'opt-main';
          obtn.setAttribute('aria-pressed', sel ? 'true' : 'false');
          const oname = document.createElement('strong');
          oname.textContent = o.name;
          const oprice = document.createElement('small');
          oprice.textContent = price !== null ? money(price) + ' / ' + c.unit : 'Price on request';
          const otxt = document.createElement('span');
          otxt.className = 'opt-txt';
          otxt.append(oname, oprice);
          const ochk = document.createElement('span');
          ochk.className = 'pick-check';
          ochk.innerHTML = sel ? ui.check : '';
          obtn.append(otxt, ochk);
          obtn.addEventListener('click', () => {
            if (sel) delete state.items[key]; else state.items[key] = 1;
            syncCards();
            renderPicker();
          });
          orow.appendChild(obtn);
          if (sel) orow.appendChild(stepper(key, o.name, c.unit));
          list.appendChild(orow);
        });
        wrap.appendChild(list);
      }
      picker.appendChild(wrap);
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
    const rows = lines().map((l) => {
      if (l.price !== null) {
        total += l.price * l.qty;
        hasPrice = true;
      }
      return '<li><span class="sum-name">' + l.c.icon + ' ' + esc(l.name) + '</span><strong>× ' + l.qty + ' ' + esc(l.c.unit) + '</strong></li>';
    });
    box.innerHTML =
      '<h4>Your request</h4><ul>' +
      rows.join('') +
      '</ul>' +
      (state.lat !== null ? '<p class="small sum-loc">' + ui.pin + ' Location shared</p>' : '') +
      (hasPrice ? '<p class="small muted">Estimated from ' + money(total) + ' - final price is confirmed after weighing/inspection.</p>' : '');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function next() {
    if (state.step === 1) {
      if (!lines().length) return showError(1, 'Please choose at least one thing to wash.');
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
    expanded.clear();
    state.lat = state.lng = state.acc = null;
    state.step = 1;
    ['#locDesc', '#fName', '#fPhone', '#fNotes'].forEach((s) => ($(s).value = ''));
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
    const rows = lines().map((l) => {
      const c = l.c;
      const q = l.qty;
      count += q;
      const priced = l.price !== null;
      if (priced) { total += l.price * q; hasPrice = true; }
      return '<li class="rc-row"><span class="rc-thumb">' + c.icon + '</span><div class="rc-nm"><b>' + esc(l.name) + '</b>' +
        (priced ? '<small>' + money(l.price) + ' per ' + esc(c.unit) + '</small>' : '<small>Price on request</small>') + '</div>' +
        '<span class="rc-qty">× ' + q + '</span>' + (priced ? '<span class="rc-lt">' + money(l.price * q) + '</span>' : '') + '</li>';
    });
    const when = new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
    const loc = ($('#locDesc').value || '').trim();
    const dateValue = ($('#pickupDate') && $('#pickupDate').value) || '';
    const pref = ($('#pickupSlot') && $('#pickupSlot').selectedOptions[0] ? $('#pickupSlot').selectedOptions[0].textContent : '').trim();
    const info = (ico, label, val) => '<div>' + ico + '<span><small>' + label + '</small><b>' + esc(val) + '</b></span></div>';
    const steps = ['New', 'Confirmed', 'Picked up', 'Washing', 'Ready', 'Delivered'];
    box.innerHTML =
      '<div class="rc-title"><h2 style="margin:0;font-size:1.28rem">Order receipt</h2><span class="rc-badge">Received</span></div>' +
      '<p class="rc-sub"><span>' + ui.clock + ' ' + esc(when) + '</span><span>' + count + (count === 1 ? ' item' : ' items') + '</span></p>' +
      '<div class="rc-chips" aria-label="Order progress">' + steps.map((t, i) => '<span class="rc-chip' + (i === 0 ? ' now' : '') + '">' + esc(t) + '</span>').join('') + '</div>' +
      '<div class="rc-live" id="rcLive" role="status" aria-live="polite"><p class="rc-live-msg" id="rcLiveMsg">Sending your request…</p><a class="btn btn-primary rc-live-pay" id="rcLivePay" href="#" hidden>Pay now</a></div>' +
      '<h3 class="rc-h">Order items <small>' + rows.length + (rows.length === 1 ? ' service' : ' services') + '</small></h3><ul class="rc-rows">' + rows.join('') + '</ul>' +
      '<h3 class="rc-h">Your details</h3><div class="rc-info">' +
      info(ui.user, 'Name', name) + info(ui.phone, 'Phone', phone) + info(ui.pin, 'Pick-up location' + (state.lat !== null ? ' (shared on map)' : ''), loc || 'Shared location') +
      (pref ? info(ui.clock, 'Pickup appointment', dateValue + ' · ' + pref) : '') + '</div>' +
      '<section class="rc-total" aria-label="Estimate">' +
      (hasPrice
        ? '<div class="rc-big" style="border-top:0;margin-top:0;padding-top:0"><span>Estimated total</span><strong>' + money(total) + '</strong></div><p class="rc-note">Final price is confirmed after weighing or inspection.</p>'
        : '<div class="rc-big" style="border-top:0;margin-top:0;padding-top:0"><span>Price</span><strong>To be confirmed</strong></div><p class="rc-note">We will confirm the price after weighing or inspection.</p>') +
      '<div class="rc-tags"><span class="rc-tag solid">Received</span><span class="rc-tag">Awaiting confirmation</span></div></section>';
  }

  /* ---------- live order status on the receipt (auto-confirm, payment, rider) ---------- */
  const STEP_AT = { new: 0, confirmed: 1, rider_arrived: 1, picked_up: 2, washing: 3, ready: 4, delivered: 5 };
  let liveSource = null;

  function applyOrderState(d, ref) {
    const box = $('#rcBody');
    if (!box || !d) return;
    const st = d.order_status || d.status || 'new';
    const pay = d.payment_status || 'awaiting_bill';
    const idx = STEP_AT[st] === undefined ? 0 : STEP_AT[st];
    const chips = $$('.rc-chip', box);
    chips.forEach((c, i) => { c.classList.toggle('done', i < idx); c.classList.toggle('now', i === idx); });
    const badge = $('.rc-badge', box);
    const tags = $$('.rc-tag', box);
    const labels = { new: 'Received', confirmed: 'Confirmed', rider_arrived: 'Rider arrived', picked_up: 'Picked up', washing: 'Washing', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' };
    const label = labels[st] || 'Received';
    if (badge) badge.textContent = label;
    if (tags[0]) tags[0].textContent = label;
    if (tags[1]) tags[1].textContent = pay === 'paid' ? 'Paid' : pay === 'pending_payment' || pay === 'part_paid' ? 'Payment due' : st === 'new' ? 'Awaiting confirmation' : 'Price after weighing';

    const total = d.total_price !== null && d.total_price !== undefined ? Number(d.total_price) : null;
    const due = total !== null ? Math.max(0, total - Number(d.amount_paid || 0)) : null;
    const msg = $('#rcLiveMsg');
    const payBtn = $('#rcLivePay');
    let text = 'Waiting for confirmation…';
    let showPay = false;
    let payLabel = 'Pay now';
    if (st === 'cancelled') text = 'This request was cancelled.';
    else if (st === 'new') text = 'Request received. We will confirm it shortly.';
    else if (st === 'confirmed' || st === 'rider_arrived') {
      if (pay === 'paid') text = 'Payment received. Thank you! Our rider has been told and will collect your laundry.';
      else if (pay === 'part_paid' && due !== null) { text = 'Part payment received. Balance: ' + money(due) + '.'; showPay = true; }
      else if (pay === 'pending_payment' && total !== null) { text = (st === 'rider_arrived' ? 'Your rider has arrived. ' : 'Confirmed! ') + 'Please pay ' + money(due !== null ? due : total) + ' so we can collect your laundry.'; showPay = true; }
      else if (d.bill_status === 'awaiting_confirm' && total !== null) { text = 'Your clothes are weighed. Please check and confirm your bill of ' + money(total) + '.'; showPay = true; payLabel = 'Review my bill'; }
      else if (d.bill_status === 'needs_price') text = 'Confirmed! A rider is assigned. We are finalising your price and will update this page.';
      else text = (st === 'rider_arrived' ? 'Your rider has arrived. ' : 'Confirmed! A rider is on the way. ') + 'Your clothes are weighed at your door, then you confirm the bill and pay here.';
    }
    else if (st === 'picked_up') text = 'Picked up. Your laundry is on its way to be washed.';
    else if (st === 'washing') text = 'Your laundry is being washed.';
    else if (st === 'ready') text = 'Your laundry is clean and ready for delivery.';
    else if (st === 'delivered') text = due ? 'Delivered. Balance due: ' + money(due) + '.' : 'Delivered. Thank you for choosing us!';
    if (msg) msg.textContent = text;
    if (payBtn) {
      payBtn.hidden = !showPay;
      payBtn.textContent = payLabel;
      if (ref) payBtn.href = (me ? '/account/requests/' + encodeURIComponent(ref) : '/track?ref=' + encodeURIComponent(ref)) + '#bill';
    }
    const live = $('#rcLive');
    if (live) live.classList.toggle('is-done', st === 'confirmed' && pay === 'paid');
  }

  // Keeps the receipt up to date (confirmed, paid, rider arrived ...) without a refresh.
  function watchOrder(ref) {
    if (!window.EventSource) return;
    if (liveSource) liveSource.close();
    liveSource = new EventSource('/live/order?ref=' + encodeURIComponent(ref), { withCredentials: true });
    liveSource.addEventListener('order', (e) => {
      let d; try { d = JSON.parse(e.data); } catch (x) { return; }
      applyOrderState(d, ref);
      if (d.order_status === 'delivered' || d.order_status === 'cancelled') { liveSource.close(); liveSource = null; }
    });
  }

  /* ---------- submit ---------- */
  async function submit() {
    if (state.sending) return;
    const name = $('#fName').value.trim();
    const phone = $('#fPhone').value.trim();
    if (name.length < 2) return showError(3, 'Please enter your name.');
    if (phone.replace(/\D/g, '').length < 9) return showError(3, 'Please enter a valid phone number.');
    if (!$('#pickupDate').value || !$('#pickupSlot').value) return showError(3, 'Choose an available pickup date and time slot.');
    if (!$('#fTerms').checked) return showError(3, 'Please accept the Terms of Service to continue.');
    showError(3, '');

    state.sending = true;
    nextBtn.disabled = true;
    nextBtn.textContent = 'Sending…';
    if (window.ttwBusy) window.ttwBusy(nextBtn, true);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          location_description: $('#locDesc').value,
          notes: $('#fNotes').value,
          pickup_date: $('#pickupDate').value,
          pickup_slot: $('#pickupSlot').value,
          branch_id: $('#fBranch') ? $('#fBranch').value : '',
          latitude: state.lat,
          longitude: state.lng,
          accuracy: state.acc,
          website: $('#fWebsite').value,
          accept_terms: true,
          terms_version: data.termsVersion,
          items: lines().map((l) => ({ category_id: l.c.id, option_id: l.o ? l.o.id : null, quantity: l.qty })),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401 && out.login) { window.location.href = out.login; return; }
      if (!res.ok || !out.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
      $('#refBox').textContent = out.ref;
      renderReceipt(name, phone);
      applyOrderState(out.confirmed ? out : { order_status: 'new' }, out.ref); // auto-confirm answers at once; the stream below keeps it live
      watchOrder(out.ref);
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
      if (window.ttwBusy) window.ttwBusy(nextBtn, false);
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
        const c = byId.get(it.category_id);
        if (!c) return;
        const q = Math.min(999, Math.max(1, it.quantity || 1));
        if (hasOpts(c)) {
          if (it.option_id && c.options.some((o) => o.id === it.option_id)) { state.items[c.id + ':' + it.option_id] = q; expanded.add(c.id); }
        } else if (!it.option_id) {
          state.items[c.id] = q;
        }
      });
      $('#locDesc').value = me.again.text || '';
      
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
