(function () {
  'use strict';

  // Address prefix of this login (empty for the normal one) - keeps requests inside the right session.
  var baseEl = document.querySelector('meta[name="app-base"]');
  var BASE = baseEl ? baseEl.getAttribute('content') : '';

  // Mobile sidebar
  var menuBtn = document.getElementById('menuBtn');
  var sidebar = document.getElementById('sidebar');
  var scrim = document.getElementById('sideScrim');
  function setMenu(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (scrim) scrim.classList.toggle('show', open);
    document.body.classList.toggle('menu-open', open);
  }
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', function () {
      setMenu(!sidebar.classList.contains('open'));
    });
  }
  if (scrim) scrim.addEventListener('click', function () { setMenu(false); });
  document.querySelectorAll('[data-menu-open]').forEach(function (b) {
    b.addEventListener('click', function () { setMenu(true); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  // Phones show tables as cards: give every cell the label of its column heading
  document.querySelectorAll('table.table').forEach(function (t) {
    var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    t.querySelectorAll('tbody tr').forEach(function (tr) {
      Array.prototype.forEach.call(tr.children, function (td, i) {
        if (td.tagName === 'TD' && !td.hasAttribute('colspan') && heads[i]) td.setAttribute('data-label', heads[i]);
      });
    });
  });

  // WhatsApp link page: keep the status and QR code fresh
  var wa = document.querySelector('[data-wa-status]');
  if (wa) {
    var labels = { off: 'Not linked', starting: 'Starting…', qr: 'Waiting for you to scan the QR code', ready: 'Linked and ready', disconnected: 'Disconnected - reconnecting', error: 'Problem' };
    var qrBox = wa.querySelector('[data-wa-qrbox]');
    var qrImg = wa.querySelector('[data-wa-qr]');
    var lab = wa.querySelector('[data-wa-label]');
    var errEl = wa.querySelector('[data-wa-error]');
    var numBox = wa.querySelector('[data-wa-number]');
    var numEl = wa.querySelector('[data-wa-num]');
    var tick = function () {
      fetch(BASE + '/admin/api/whatsapp/status', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) return;
          if (lab) {
            lab.textContent = labels[d.state] || d.state;
            lab.className = 'badge ' + (d.state === 'ready' ? 'pay-paid' : d.state === 'error' ? 'pay-unpaid' : 'pay-partial');
          }
          if (qrBox && qrImg) {
            var showQr = d.state === 'qr' && !!d.qr;
            qrBox.hidden = !showQr;
            if (showQr && qrImg.getAttribute('src') !== d.qr) qrImg.setAttribute('src', d.qr);
          }
          if (errEl) { errEl.textContent = d.error || ''; errEl.classList.toggle('show', !!d.error); }
          if (numBox) { numBox.hidden = !(d.state === 'ready' && d.number); if (numEl) numEl.textContent = '+' + (d.number || ''); }
        })
        .catch(function () {});
    };
    setInterval(tick, 3000);
  }

  // Confirm before destructive actions: handled by /js/dialog.js (themed dialog)

  // "Use estimate" style helpers
  document.querySelectorAll('[data-fill]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.querySelector(btn.getAttribute('data-fill'));
      if (target) target.value = btn.getAttribute('data-value');
    });
  });

  // Category photos: resize locally and store against the selected category.
  document.querySelectorAll('[data-category-image-upload]').forEach(function (btn) {
    var id = btn.getAttribute('data-category-image-upload');
    var input = document.querySelector('[data-category-image-input="' + id + '"]');
    var err = document.querySelector('[data-category-image-err="' + id + '"]');
    function show(msg) { if (err) { err.textContent = msg || ''; err.classList.toggle('show', !!msg); } }
    btn.addEventListener('click', function () {
      show('');
      var file = input && input.files && input.files[0];
      if (!file) return show('Choose a category photo first.');
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return show('Choose a JPEG, PNG or WebP image.');
      var reader = new FileReader();
      reader.onerror = function () { show('That image could not be read.'); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { show('That image could not be read.'); };
        img.onload = function () {
          var max = 1200, scale = Math.min(1, max / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            if (!blob) return show('Could not prepare that image.');
            btn.disabled = true;
            fetch(BASE + '/admin/categories/' + id + '/image', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-CSRF-Token': tokenEl ? tokenEl.value : '' }, body: blob })
              .then(function (r) { return r.json().catch(function () { return {}; }); })
              .then(function (out) { if (out.ok) window.location.reload(); else { btn.disabled = false; show(out.error || 'Upload failed.'); } })
              .catch(function () { btn.disabled = false; show('Upload failed. Check your connection.'); });
          }, 'image/jpeg', 0.86);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  });

  // Flash messages are shown as toasts by /js/toast.js

  // Background photos: resize in the browser, then upload as JPEG
  var tokenEl = document.getElementById('csrfToken');
  document.querySelectorAll('[data-photo-upload]').forEach(function (btn) {
    var slot = btn.getAttribute('data-photo-upload');
    var input = document.querySelector('[data-photo-input="' + slot + '"]');
    var err = document.querySelector('[data-photo-err="' + slot + '"]');
    function show(msg) { err.textContent = msg || ''; err.classList.toggle('show', !!msg); }
    btn.addEventListener('click', function () {
      show('');
      var file = input.files && input.files[0];
      if (!file) return show('Choose a picture first.');
      if (!/^image\//.test(file.type)) return show('That file is not a picture.');
      var reader = new FileReader();
      reader.onerror = function () { show('That picture could not be read.'); };
      reader.onload = function () {
      var url = reader.result; // data: URL (allowed by the page's security policy)
      var img = new Image();
      img.onload = function () {
        var max = 1800, scale = Math.min(1, max / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          if (!blob) return show('Could not prepare that picture.');
          btn.disabled = true;
          fetch(BASE + '/admin/photos/' + slot, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-CSRF-Token': tokenEl ? tokenEl.value : '' }, body: blob })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (out) { if (out.ok) window.location.reload(); else { btn.disabled = false; show(out.error || 'Upload failed.'); } })
            .catch(function () { btn.disabled = false; show('Upload failed. Check your connection.'); });
        }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { show('That picture could not be read.'); };
      img.src = url;
      };
      reader.readAsDataURL(file);
    });
  });

  // Site icon (favicon): crop to a square, resize to 512 x 512, upload as PNG (keeps transparency)
  var favBtn = document.getElementById('faviconUpload');
  var favInput = document.getElementById('faviconInput');
  var favErr = document.getElementById('faviconErr');
  if (favBtn && favInput) {
    var favShow = function (msg) { favErr.textContent = msg || ''; favErr.classList.toggle('show', !!msg); };
    favBtn.addEventListener('click', function () {
      favShow('');
      var file = favInput.files && favInput.files[0];
      if (!file) return favShow('Choose a picture first.');
      if (!/^image\//.test(file.type)) return favShow('That file is not a picture.');
      var reader = new FileReader();
      reader.onerror = function () { favShow('That picture could not be read.'); };
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || img.width || 512, h = img.naturalHeight || img.height || 512;
          var side = Math.min(w, h), size = 512;
          var canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          var c = canvas.getContext('2d');
          c.imageSmoothingQuality = 'high';
          c.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
          canvas.toBlob(function (blob) {
            if (!blob) return favShow('Could not prepare that picture.');
            favBtn.disabled = true;
            fetch(BASE + '/admin/settings/favicon', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/png', 'X-CSRF-Token': tokenEl ? tokenEl.value : '' }, body: blob })
              .then(function (r) { return r.json().catch(function () { return {}; }); })
              .then(function (out) { if (out.ok) window.location.reload(); else { favBtn.disabled = false; favShow(out.error || 'Upload failed.'); } })
              .catch(function () { favBtn.disabled = false; favShow('Upload failed. Check your connection.'); });
          }, 'image/png');
        };
        img.onerror = function () { favShow('That picture could not be read.'); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- job alerts: bell, pop-ups, sound, phone push ---------- */
  function csrf() {
    var el = document.querySelector('input[name="_csrf"]');
    return el ? el.value : '';
  }

  var bell = document.getElementById('bell');
  var bellCount = document.getElementById('bellCount');
  var lastId = bell ? parseInt(bell.getAttribute('data-last'), 10) || 0 : 0;
  var baseTitle = document.title;
  var audioCtx = null;

  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      [0, 0.18].forEach(function (t, i) {
        var o = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = i ? 988 : 740;
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.16);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + t);
        o.stop(audioCtx.currentTime + t + 0.18);
      });
    } catch (e) { /* sound is a bonus; ignore */ }
  }

  function toast(item) {
    var stack = document.getElementById('toasts');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toasts';
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      document.body.appendChild(stack);
    }
    var a = document.createElement('a');
    a.className = 'toast';
    a.href = BASE + item.url;
    var t = document.createElement('strong');
    t.textContent = item.title;
    var b = document.createElement('span');
    b.textContent = item.body;
    a.appendChild(t);
    a.appendChild(b);
    stack.appendChild(a);
    setTimeout(function () { a.classList.add('out'); setTimeout(function () { a.remove(); }, 400); }, 9000);
  }

  function showCount(n) {
    if (!bellCount) return;
    bellCount.textContent = n > 99 ? '99+' : String(n);
    bellCount.hidden = !n;
    document.title = n ? '(' + n + ') ' + baseTitle : baseTitle;
  }
  showCount(bellCount && !bellCount.hidden ? parseInt(bellCount.textContent, 10) || 0 : 0);

  var polling = !!bell;
  function poll() {
    if (!polling) return;
    if (document.hidden) return setTimeout(poll, 20000);
    fetch(BASE + '/admin/api/alerts?after=' + lastId, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        var ct = r.headers.get('content-type') || '';
        if (!r.ok || ct.indexOf('json') === -1) { polling = false; return null; } // signed out or blocked: stop quietly
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        if (d.items && d.items.length) {
          d.items.forEach(function (it) { toast(it); });
          beep();
        }
        if (d.last > lastId) lastId = d.last;
        showCount(d.unread);
      })
      .catch(function () { /* offline: try again next round */ })
      .then(function () { if (polling) setTimeout(poll, 12000); });
  }
  if (bell) setTimeout(poll, 4000);
  // Browsers only allow sound after a first tap on the page.
  document.addEventListener('click', function once() {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* none */ }
    document.removeEventListener('click', once);
  });

  // Phone / desktop push (My account page)
  var pushBtn = document.querySelector('[data-push-enable]');
  var testBtn = document.querySelector('[data-push-test]');
  var pushStatus = document.querySelector('[data-push-status]');
  function say(msg) { if (pushStatus) pushStatus.textContent = msg; }
  function b64(s) {
    var pad = '='.repeat((4 - (s.length % 4)) % 4);
    var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function postJson(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json(); });
  }
  if (pushBtn) {
    var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) {
      pushBtn.disabled = true;
      if (testBtn) testBtn.disabled = true;
      say('This browser cannot receive push alerts. On iPhone, add the site to your Home Screen first.');
    } else {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) { if (sub) say('Enabled on this device.'); });
      }).catch(function () {});
      pushBtn.addEventListener('click', function () {
        say('Setting up…');
        Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings, then try again.');
          return fetch(BASE + '/admin/api/push/key', { credentials: 'same-origin' }).then(function (r) { return r.json(); });
        }).then(function (k) {
          if (!k.ok) throw new Error('Phone alerts are not available on this server.');
          return navigator.serviceWorker.ready.then(function (reg) {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(k.key) });
          });
        }).then(function (sub) { return postJson(BASE + '/admin/api/push/subscribe', sub.toJSON()); })
          .then(function (out) { say(out.ok ? 'Enabled on this device.' : (out.error || 'Could not enable.')); })
          .catch(function (e) { say(e.message || 'Could not enable alerts.'); });
      });
      if (testBtn) testBtn.addEventListener('click', function () {
        say('Sending…');
        postJson(BASE + '/admin/api/push/test').then(function (o) { say(o.sent ? 'Test sent - check your notifications.' : 'No device is enabled yet. Tap "Enable on this device" first.'); })
          .catch(function () { say('Could not send the test.'); });
      });
    }
  }
})();

// Settings > M-Pesa payments: show the number field once a method is chosen, and the account field only for Paybill.
(function () {
  'use strict';
  var sel = document.getElementById('mpesaType');
  if (!sel) return;
  var form = sel.closest('form');
  var fields = form.querySelector('[data-mpesa-fields]');
  var acct = form.querySelector('[data-mpesa-account]');
  var label = document.getElementById('mpesaNumLabel');
  function sync() {
    var v = sel.value;
    fields.hidden = !v;
    acct.hidden = v !== 'paybill';
    if (label) label.textContent = v === 'paybill' ? 'Paybill number' : 'Till number';
  }
  sel.addEventListener('change', sync);
  sync();
})();
