/* Live services: when the admin adds, edits or hides a category, an open public page updates by itself.
   It reloads at once if the visitor has not touched anything yet; otherwise a small bar asks them to refresh,
   so a booking in progress is never lost. The stream carries only a version number. */
(function () {
  if (!window.EventSource) return;
  var touched = false;
  var version = null;
  var es = null;
  var hiddenTimer = null;
  var hadError = false;

  ['pointerdown', 'keydown', 'input', 'touchstart'].forEach(function (n) {
    window.addEventListener(n, function () { touched = true; }, { passive: true, capture: true });
  });

  var bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  bar.hidden = true;
  bar.style.cssText = 'position:fixed;left:50%;bottom:5.5rem;transform:translateX(-50%);z-index:60;padding:.6rem 1rem;border-radius:999px;background:var(--ink,#1c1c1a);color:var(--on-ink,#fff);font-size:.9rem;cursor:pointer;max-width:92vw;text-align:center';
  bar.textContent = 'Our services were just updated - tap to refresh';
  document.body.appendChild(bar);
  bar.addEventListener('click', function () { location.reload(); });

  function changed() {
    if (touched) { bar.hidden = false; return; }
    setTimeout(function () { location.reload(); }, 300);
  }

  function connect() {
    if (es) return;
    es = new EventSource('/live/catalog');
    es.addEventListener('hello', function (e) {
      var d; try { d = JSON.parse(e.data); } catch (x) { return; }
      if (version !== null && d.v !== version) { version = d.v; changed(); return; } // a change happened while we were away
      version = d.v;
    });
    es.addEventListener('catalog', function (e) {
      var d; try { d = JSON.parse(e.data); } catch (x) { return; }
      if (d.v === version) return;
      version = d.v;
      changed();
    });
    es.addEventListener('error', function () {
      hadError = true;
      if (es && es.readyState === 2) { es = null; } // refused (too many connections): stay quiet, the page still works
    });
  }

  // A hidden tab does not need a connection: drop it after a minute and rejoin (and re-check the version) when it is shown again.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hiddenTimer = setTimeout(function () { if (es) { es.close(); es = null; } }, 60000);
    } else {
      clearTimeout(hiddenTimer);
      connect();
    }
  });

  connect();
})();
