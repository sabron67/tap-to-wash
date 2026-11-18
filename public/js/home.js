// Home screen: filter the service cards as the visitor types in the search box.
(function () {
  'use strict';
  var input = document.getElementById('svcSearch');
  var rail = document.getElementById('catGrid');
  var none = document.getElementById('svcNone');
  if (!input || !rail) return;
  var cards = Array.prototype.slice.call(rail.querySelectorAll('.cat-card'));

  function filter() {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (c) {
      var hit = !q || (c.dataset.name || '').indexOf(q) !== -1 || (c.textContent || '').toLowerCase().indexOf(q) !== -1;
      c.hidden = !hit;
      if (hit) shown++;
    });
    if (none) none.hidden = shown !== 0;
    if (q && shown) {
      var sec = document.getElementById('categories');
      if (sec && sec.getBoundingClientRect().top > window.innerHeight * 0.7) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  input.addEventListener('input', filter);
  input.closest('form') && input.closest('form').addEventListener('submit', function (e) { e.preventDefault(); });

})();
(function () {
  'use strict';
  /* Service item options open as ONE floating card laid over the cards around it (nothing shifts).
     Guests can browse without signing in. Tap "View items" to open it; scrolling, tapping outside, Esc or the close button hides it. */
  var blocks = Array.prototype.slice.call(document.querySelectorAll('.svc-opts'));
  if (!blocks.length) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pop = document.createElement('div');
  pop.className = 'opts-pop';
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  document.body.appendChild(pop);
  var current = null, pinned = false;

  function place() {
    if (!current) return;
    var card = current.closest('.cat-card');
    var r = card.getBoundingClientRect(), b = current.querySelector('[data-opts-toggle]').getBoundingClientRect();
    var sx = window.pageXOffset, sy = window.pageYOffset;
    var w = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
    var left = Math.min(Math.max(r.left, 8), window.innerWidth - w - 8);
    pop.style.width = w + 'px';
    pop.style.left = left + sx + 'px';
    pop.style.top = b.bottom + sy + 4 + 'px';
  }
  function open(block, pin) {
    if (current === block) { pinned = pinned || !!pin; return; }
    close(true);
    current = block; pinned = !!pin;
    var card = block.closest('.cat-card');
    var items = block.querySelector('.svc-opts-list').cloneNode(true);
    Array.prototype.forEach.call(items.children, function (li, i) { li.style.setProperty('--i', i); });
    pop.innerHTML = '';
    var head = document.createElement('div'); head.className = 'opts-pop-head';
    var t = document.createElement('strong'); t.textContent = (card.querySelector('h3') || {}).textContent || 'Items';
    var x = document.createElement('button'); x.type = 'button'; x.className = 'opts-pop-x'; x.setAttribute('aria-label', 'Close'); x.innerHTML = '&times;';
    x.addEventListener('click', function () { close(); });
    head.append(t, x);
    var go = document.createElement('button'); go.type = 'button'; go.className = 'btn btn-primary btn-sm btn-block opts-pop-go'; go.textContent = 'Choose items';
    go.addEventListener('click', function () { close(); card.click(); });
    pop.append(head, items, go);
    pop.setAttribute('aria-label', t.textContent + ' items');
    block.classList.add('open');
    block.querySelector('[data-opts-toggle]').setAttribute('aria-expanded', 'true');
    pop.hidden = false;
    place();
    void pop.offsetWidth; // let the browser see the start state, then animate in
    pop.classList.add('show');
  }
  function close(instant) {
    if (!current) return;
    var b = current; current = null; pinned = false;
    b.classList.remove('open');
    b.querySelector('[data-opts-toggle]').setAttribute('aria-expanded', 'false');
    pop.classList.remove('show');
    if (instant || reduce) { pop.hidden = true; return; }
    setTimeout(function () { if (!current) pop.hidden = true; }, 220);
  }

  blocks.forEach(function (b) {
    // the card itself starts a booking, so taps inside the options row must not reach it
    ['click', 'keydown'].forEach(function (ev) { b.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    b.querySelector('[data-opts-toggle]').addEventListener('click', function () {
      if (current === b) close(); else open(b, true);
    });
  });
  document.addEventListener('click', function (e) {
    if (current && !pop.contains(e.target) && !e.target.closest('.svc-opts')) close();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', place);
  window.addEventListener('orientationchange', place);

  // Scrolling hides the card (a few pixels of movement are ignored so a tap does not close it).
  var startY = null;
  window.addEventListener('scroll', function () {
    if (!current) { startY = null; return; }
    if (startY === null) startY = window.pageYOffset;
    if (Math.abs(window.pageYOffset - startY) > 12) { startY = null; close(); }
  }, { passive: true });
})();
