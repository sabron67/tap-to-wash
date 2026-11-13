// Promotion popup ad. It appears on every page load while a promotion is live, until the customer closes it
// (X, Esc or tapping outside). After that it stays closed for the rest of the visit and comes back
// only when the customer opens the website again (new tab/window).
(function () {
  'use strict';
  if (/^\/(admin|staff)/.test(location.pathname)) return;

  function seen(id) { try { return sessionStorage.getItem('promo-closed-' + id) === '1'; } catch (e) { return false; } }
  function mark(id) { try { sessionStorage.setItem('promo-closed-' + id, '1'); } catch (e) {} }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }

  function show(p) {
    var pop = el('div', 'promo-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', p.title);
    var card = el('div', 'promo-card');
    var x = el('button', 'promo-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    card.appendChild(x);
    card.appendChild(el('span', 'promo-tag', 'Special offer'));
    card.appendChild(el('div', 'promo-off', p.off));
    card.appendChild(el('h2', '', p.title));
    if (p.message) card.appendChild(el('p', '', p.message));
    var cta = el('button', 'btn btn-primary promo-cta', 'Book a pick-up');
    cta.type = 'button';
    card.appendChild(cta);
    var until = '';
    try { until = new Date(p.ends_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) {}
    card.appendChild(el('p', 'promo-note', 'Applied automatically to your bill. No code needed.' + (until ? ' Offer ends ' + until + '.' : '')));
    pop.appendChild(card);

    var last = document.activeElement;
    function close() {
      mark(p.id);
      document.removeEventListener('keydown', onKey);
      pop.classList.remove('in');
      setTimeout(function () { pop.remove(); if (last && last.focus) try { last.focus(); } catch (e) {} }, 250);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    x.addEventListener('click', close);
    pop.addEventListener('click', function (e) { if (e.target === pop) close(); });
    cta.addEventListener('click', function () {
      close();
      var open = document.querySelector('[data-open-wizard]');
      if (open) open.click(); else location.href = '/?start=1';
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(pop);
    requestAnimationFrame(function () { pop.classList.add('in'); x.focus(); });
  }

  fetch('/api/promo', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && d.promo && !seen(d.promo.id)) show(d.promo); })
    .catch(function () {});
})();
