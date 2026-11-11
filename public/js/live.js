/* Live updates: opens one event stream per page (customer tracking page, or the staff workspace),
   reconnects by itself and re-syncs after a reconnect. Forward-only: an older update never replaces a newer one. */
(function () {
  var cfg = document.getElementById('liveCfg');
  if (!cfg || !window.EventSource) return;
  var kind = cfg.getAttribute('data-kind');
  var base = (document.querySelector('meta[name="app-base"]') || {}).content || '';
  var url = kind === 'staff' ? base + '/admin/api/live'
    : '/live/order?ref=' + encodeURIComponent(cfg.getAttribute('data-ref') || '') + '&phone=' + encodeURIComponent(cfg.getAttribute('data-phone') || '');
  var path = location.pathname.replace(/^\/s_[a-z0-9]+/, '');
  var m = /\/requests\/(\d+)/.exec(path);
  var orderId = Number(cfg.getAttribute('data-order') || (m ? m[1] : 0)); // 0 = list or dashboard (any order)
  var watchesOrders = kind === 'order' || /^\/(admin|staff)(\/requests|\/operations)?\/?$/.test(path) || /^\/admin\/(requests|operations)/.test(path);
  var lastSeq = {};
  var pending = null;
  var hadError = false;

  var bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  bar.hidden = true;
  bar.style.cssText = 'position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:60;padding:.6rem 1rem;border-radius:999px;background:var(--text,#222);color:var(--bg,#fff);font-size:.9rem;box-shadow:0 4px 18px rgba(0,0,0,.25);cursor:pointer';
  document.body.appendChild(bar);
  bar.addEventListener('click', function () { location.reload(); });

  function editing() {
    var a = document.activeElement;
    return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !!a.closest('main, .home-search');
  }
  // State locking: buttons of that order's forms are disabled at once, before the page refreshes.
  function lockForms(id) {
    document.querySelectorAll('main form[action*="/requests/' + id + '/"] button[type=submit]').forEach(function (b) { b.disabled = true; });
  }
  function refresh(msg) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      if (editing()) { bar.textContent = (msg || 'This page was updated') + ' - tap to refresh'; bar.hidden = false; return; }
      try { sessionStorage.setItem('liveScroll', '1'); } catch (e) {}
      location.reload();
    }, 400);
  }

  var es = new EventSource(url, { withCredentials: true });
  es.addEventListener('open', function () { if (hadError) { hadError = false; refresh('Reconnected'); } });
  es.addEventListener('error', function () { hadError = true; });
  es.addEventListener('order', function (e) {
    var d; try { d = JSON.parse(e.data); } catch (x) { return; }
    if (lastSeq[d.order_id] && d.seq <= lastSeq[d.order_id]) return;
    lastSeq[d.order_id] = d.seq;
    if (!watchesOrders || (orderId && d.order_id !== orderId)) return;
    lockForms(d.order_id);
    refresh('Order updated');
  });
  es.addEventListener('policy', function () { refresh('Payment policy changed'); });

  // After a live refresh on the tracking page, bring a new bill into view so the customer can confirm and pay.
  try {
    if (sessionStorage.getItem('liveScroll')) {
      sessionStorage.removeItem('liveScroll');
      var bill = document.getElementById('bill');
      if (bill && kind === 'order') bill.scrollIntoView({ block: 'center' });
    }
  } catch (e) {}
})();
