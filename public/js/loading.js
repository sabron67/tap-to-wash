// Loading states for the whole site (loaded by the shared page head, so customers and staff both get it).
//  - Busy buttons: a spinner on any button that submits a form, and a guard against double submits.
//  - Page-load bar (and a "Loading..." pill when a page is slow) when a link or form opens another page.
//  - Download progress: links to Excel/report downloads are fetched with a live progress card, then saved.
//  - window.ttwUpload(url, body, opts): upload with a live progress card (used by the photo and icon uploads).
//  - window.ttwBusy(button, true|false): spinner on a button from other scripts.
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var SPIN = '<span class="ttw-spin" role="status" aria-label="Loading"><svg viewBox="0 0 24 24" aria-hidden="true"><circle class="trk" cx="12" cy="12" r="9"/><circle class="arc" cx="12" cy="12" r="9"/></svg></span>';
  var ICON = {
    up: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>',
    down: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
    ok: '<path d="M20 6 9 17l-5-5"/>',
    bad: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
  };
  var svg = function (d) { return '<svg xmlns="' + NS + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
  function size(n) {
    if (!isFinite(n) || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  /* ---------- busy buttons ---------- */
  function busy(btn, on) {
    if (!btn) return;
    if (on) {
      if (btn.classList.contains('is-busy')) return;
      btn.classList.add('is-busy');
      btn.setAttribute('aria-busy', 'true');
      var s = el('span'); s.innerHTML = SPIN;
      var spinner = s.firstChild; spinner.setAttribute('data-ttw', '1');
      btn.insertBefore(spinner, btn.firstChild);
    } else {
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
      var sp = btn.querySelector(':scope > .ttw-spin[data-ttw]');
      if (sp) sp.remove();
    }
  }
  window.ttwBusy = busy;

  /* ---------- page-load bar and slow-page pill ---------- */
  var bar, pill, pillTimer, barTimer;
  function ensureBar() {
    if (bar) return;
    bar = el('div'); bar.id = 'ttwLoad'; bar.setAttribute('aria-hidden', 'true'); bar.appendChild(el('i'));
    pill = el('div'); pill.id = 'ttwPill'; pill.setAttribute('role', 'status'); pill.innerHTML = SPIN + '<span>Loading…</span>';
    document.body.appendChild(bar); document.body.appendChild(pill);
  }
  function pageLoading(on) {
    ensureBar();
    clearTimeout(pillTimer); clearTimeout(barTimer);
    if (on) {
      bar.classList.add('on');
      pillTimer = setTimeout(function () { pill.classList.add('on'); }, 1200);
      barTimer = setTimeout(pageLoading.bind(null, false), 45000); // never leave it stuck if the page does not open
    } else {
      bar.classList.remove('on'); pill.classList.remove('on');
    }
  }
  // Coming back with the Back button (page restored from cache): clear everything that was left spinning.
  window.addEventListener('pageshow', function (e) {
    if (e && !e.persisted) return; // a normal load starts clean; only a cached page can come back mid-spin
    pageLoading(false);
    document.querySelectorAll('.is-busy[aria-busy]').forEach(function (b) { busy(b, false); });
    document.querySelectorAll('form[data-ttw-busy]').forEach(function (f) { f.removeAttribute('data-ttw-busy'); });
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches('form')) return;
    if (form.hasAttribute('data-no-busy') || form.getAttribute('method') === 'dialog') return;
    if (form.target && form.target !== '_self') return;
    if (form.hasAttribute('data-ttw-busy')) { e.preventDefault(); return; } // already sending: ignore the second tap
    var submitter = e.submitter || null;
    // Wait a tick: a confirm dialog or a validator may cancel this submit.
    setTimeout(function () {
      if (e.defaultPrevented) return;
      form.setAttribute('data-ttw-busy', '1');
      var btn = submitter || form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
      if (btn && btn.tagName === 'BUTTON') busy(btn, true);
      pageLoading(true);
    }, 0);
  }, false);

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-no-busy')) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|sms:|javascript:|whatsapp:)/i.test(href)) return;
    var u; try { u = new URL(a.href, location.href); } catch (_) { return; }
    if (u.origin !== location.origin) return;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return;
    if (isDownload(u)) return; // handled by the download progress below
    pageLoading(true);
  }, false);

  /* ---------- transfer cards (upload and download progress) ---------- */
  var tray;
  function card(kind, title, sub, onCancel) {
    if (!tray) { tray = el('div'); tray.id = 'ttwTransfers'; tray.setAttribute('aria-live', 'polite'); document.body.appendChild(tray); }
    var c = el('div', 'ttw-xfer wait');
    c.innerHTML = '<span class="ico">' + svg(kind === 'up' ? ICON.up : ICON.down) + '</span><div class="ttl"></div><button type="button" class="x" aria-label="Cancel">' + svg(ICON.x) + '</button><div class="sub"></div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><b></b></div>';
    c.querySelector('.ttl').textContent = title;
    c.querySelector('.sub').textContent = sub || '';
    var closeBtn = c.querySelector('.x');
    var api = {
      sub: function (t) { c.querySelector('.sub').textContent = t; },
      title: function (t) { c.querySelector('.ttl').textContent = t; },
      progress: function (pct) {
        c.classList.remove('wait');
        var p = Math.max(0, Math.min(100, pct));
        c.querySelector('.bar b').style.width = p + '%'; // allowed: style property set from script, not inline markup
        c.querySelector('.bar').setAttribute('aria-valuenow', Math.round(p));
      },
      finish: function (ok, msg, keepMs) {
        c.classList.remove('wait'); c.classList.add(ok ? 'done' : 'fail');
        c.querySelector('.ico').innerHTML = svg(ok ? ICON.ok : ICON.bad);
        c.querySelector('.bar b').style.width = '100%';
        closeBtn.setAttribute('aria-label', 'Dismiss'); closeBtn.onclick = api.close;
        if (msg) api.sub(msg);
        setTimeout(api.close, keepMs || (ok ? 1800 : 7000));
      },
      close: function () { c.classList.add('hide'); setTimeout(function () { c.remove(); }, 320); }
    };
    closeBtn.onclick = function () { if (onCancel) onCancel(); api.close(); };
    tray.appendChild(c);
    return api;
  }

  /* ---------- uploads ---------- */
  // Resolves with the server's JSON answer (an empty object if it was not JSON); rejects on a network failure or cancel.
  window.ttwUpload = function (url, body, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var total = body && body.size ? body.size : 0;
      var ui = card('up', opts.title || 'Uploading…', opts.name ? opts.name + (total ? ' · ' + size(total) : '') : (total ? size(total) : ''), function () { xhr.abort(); });
      xhr.open(opts.method || 'POST', url);
      xhr.withCredentials = true;
      var h = opts.headers || {};
      Object.keys(h).forEach(function (k) { xhr.setRequestHeader(k, h[k]); });
      xhr.upload.onprogress = function (ev) {
        if (!ev.lengthComputable) return;
        ui.progress((ev.loaded / ev.total) * 100);
        ui.sub(size(ev.loaded) + ' of ' + size(ev.total) + ' · ' + Math.round((ev.loaded / ev.total) * 100) + '%');
      };
      xhr.upload.onload = function () { ui.progress(100); ui.title('Saving…'); };
      xhr.onload = function () {
        var out = {}; try { out = JSON.parse(xhr.responseText); } catch (_) {}
        var good = xhr.status >= 200 && xhr.status < 300 && out.ok !== false;
        ui.finish(good, good ? 'Upload complete' : (out.error || 'Upload failed'), good ? 900 : 7000);
        resolve(out);
      };
      xhr.onerror = function () { ui.finish(false, 'Upload failed. Check your connection.'); reject(new Error('network')); };
      xhr.onabort = function () { reject(new Error('cancelled')); };
      xhr.send(body);
    });
  };

  /* ---------- downloads ---------- */
  function isDownload(u) { return /\/(download|export\.xlsx)(\/|$)/.test(u.pathname); }
  function fileName(res, fallback) {
    var cd = res.headers.get('Content-Disposition') || '', m;
    if ((m = /filename\*=UTF-8''([^;]+)/i.exec(cd))) { try { return decodeURIComponent(m[1]); } catch (_) {} }
    if ((m = /filename="?([^";]+)"?/i.exec(cd))) return m[1];
    return fallback;
  }
  function startDownload(u, a) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var label = (a.textContent || 'Report').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Report';
    var ui = card('down', 'Preparing download…', label, function () { if (ctrl) ctrl.abort(); });
    var fallbackName = decodeURIComponent(u.pathname.split('/').pop() || 'download');
    fetch(u.href, { credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        var type = res.headers.get('Content-Type') || '';
        if (!res.ok || /text\/html/i.test(type)) throw new Error('fallback'); // e.g. signed out: let the browser handle it normally
        var name = fileName(res, fallbackName);
        var total = parseInt(res.headers.get('Content-Length'), 10) || 0;
        ui.title('Downloading…'); ui.sub(name);
        if (!res.body || !res.body.getReader) return res.blob().then(function (b) { return { blob: b, name: name }; });
        var reader = res.body.getReader(), chunks = [], got = 0;
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return { blob: new Blob(chunks, { type: type }), name: name };
            chunks.push(r.value); got += r.value.length;
            if (total) { ui.progress((got / total) * 100); ui.sub(name + ' · ' + size(got) + ' of ' + size(total)); }
            else ui.sub(name + ' · ' + size(got));
            return pump();
          });
        }
        return pump();
      })
      .then(function (f) {
        var url = URL.createObjectURL(f.blob);
        var link = el('a'); link.href = url; link.download = f.name; link.hidden = true;
        document.body.appendChild(link); link.click();
        setTimeout(function () { link.remove(); URL.revokeObjectURL(url); }, 4000);
        ui.finish(true, f.name + ' · ' + size(f.blob.size) + ' saved');
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        ui.close();
        window.location.href = u.href; // anything unexpected: a normal browser download
      });
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.hasAttribute('data-no-busy')) return;
    var u; try { u = new URL(a.href, location.href); } catch (_) { return; }
    if (u.origin !== location.origin || !isDownload(u) || !window.fetch) return;
    e.preventDefault();
    startDownload(u, a);
  }, false);
})();
