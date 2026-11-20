// Delete without reloading the page.
//
// Any <form method="post" data-ajax-delete> is sent in the background (fetch) instead of being submitted as a page.
// The question "Are you sure?" still comes from dialog.js (data-confirm), and every message uses the existing toast.
//
//   data-remove="<selector>"   on success, the closest matching ancestor (a table row, a card...) is removed from the page.
//                              The counters and the empty message are updated by the attributes below.
//   data-counter="<selector>"  an element holding a number such as "(3)": counted down by one after a removal.
//   data-scope / data-img / data-note / data-note-text
//                              for "reset to default" buttons that delete an uploaded picture: the picture inside the
//                              closest `data-scope` element is swapped for the default one the server returned, the note
//                              shows `data-note-text`, and the form disappears.
//
// With none of those, a successful answer that carries a `redirect` moves on to that page (used where the page itself is
// gone after the delete, e.g. the request you were looking at, or your own account). Without JavaScript the form still
// posts and redirects as before.
//
// Server contract (all delete routes): { ok: true, message?, redirect?, imageUrl? } or { ok: false, error, gone?, redirect? }
// with a real HTTP status (400, 401, 403, 404, 409, 500). Nothing is removed from the screen until the server says ok.
(function () {
  'use strict';

  var BUSY = 'data-ajax-busy';

  function toast(message, type) {
    if (typeof window.ttwToast === 'function') window.ttwToast(message, type);
  }

  function tokenOf(form) {
    var field = form.querySelector('input[name="_csrf"]');
    if (field && field.value) return field.value;
    var shared = document.getElementById('csrfToken');
    return shared ? shared.value : '';
  }

  // Only ever follow a link on this site (an absolute path), never an address supplied by a response.
  function safePath(url) {
    return typeof url === 'string' && /^\/(?![\/\\])/.test(url) ? url : '';
  }

  function setBusy(form, button, on) {
    if (on) form.setAttribute(BUSY, '1'); else form.removeAttribute(BUSY);
    if (!button) return;
    button.disabled = on;
    if (on) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
    if (typeof window.ttwBusy === 'function') window.ttwBusy(button, on);
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function fadeOut(el, done) {
    if (reducedMotion()) { done(); return; }
    el.style.transition = 'opacity .18s ease, transform .18s ease';
    el.style.opacity = '0';
    el.style.transform = 'scale(.98)';
    setTimeout(done, 200);
  }

  // "(3)" -> "(2)": counts the first number in the element down by one (never below zero).
  function countDown(selector) {
    if (!selector) return;
    var el = document.querySelector(selector);
    if (!el) return;
    el.textContent = el.textContent.replace(/\d+/, function (n) { return String(Math.max(0, parseInt(n, 10) - 1)); });
  }

  // After the last item of a list is removed, show the page's own "nothing here" message (kept in a <template data-empty>).
  function showEmptyState(container) {
    if (!container) return;
    if (container.tagName === 'TBODY') {
      if (container.querySelector('tr')) return;
      var holder = container.closest('.table-wrap') || container;
      var tpl = holder.nextElementSibling;
      if (tpl && tpl.matches && tpl.matches('template[data-empty]')) {
        holder.parentNode.replaceChild(tpl.content.cloneNode(true), holder);
        tpl.remove();
      }
      return;
    }
    var own = container.querySelector(':scope > template[data-empty]');
    if (!own) return;
    var left = Array.prototype.filter.call(container.children, function (c) { return c !== own; });
    if (!left.length) { container.appendChild(own.content.cloneNode(true)); own.remove(); }
  }

  function removeItem(form, item) {
    var container = item.parentNode;
    var counter = form.getAttribute('data-counter');
    fadeOut(item, function () {
      item.remove();
      countDown(counter);
      showEmptyState(container);
      // The button that had focus is gone: keep keyboard users in the list instead of dropping them at the top of the page.
      if (container && container.nodeType === 1 && (!document.activeElement || document.activeElement === document.body)) {
        if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
        try { container.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
      }
    });
  }

  // "Reset to default": show the default picture the server returned, then drop the reset button.
  function swapImage(form, out) {
    var scopeSel = form.getAttribute('data-scope');
    var scope = scopeSel ? form.closest(scopeSel) : null;
    if (!scope) return;
    var imgSel = form.getAttribute('data-img');
    var img = imgSel ? scope.querySelector(imgSel) : null;
    if (img && out.imageUrl) img.src = out.imageUrl;
    var noteSel = form.getAttribute('data-note');
    var note = noteSel ? scope.querySelector(noteSel) : null;
    if (note) {
      var text = form.getAttribute('data-note-text');
      if (text) note.textContent = text;
      note.hidden = false;
    }
    form.remove();
  }

  function failMessage(res, out) {
    if (out && out.error) return out.error;
    if (res.status === 401) return 'Your session ended. Please sign in again.';
    if (res.status === 403) return 'You are not allowed to do that, or the page is out of date. Refresh and try again.';
    if (res.status === 404) return 'That record was not found. It may already have been deleted.';
    if (res.status === 429) return 'Too many attempts. Please wait a moment and try again.';
    return 'Something went wrong on the server. Nothing was deleted. Please try again.';
  }

  function send(form, submitter) {
    if (form.hasAttribute(BUSY)) return; // already sending: ignore the second tap
    var button = submitter || form.querySelector('button[type="submit"], button:not([type])');
    setBusy(form, button, true);

    var token = tokenOf(form);
    var body = new URLSearchParams(new FormData(form)).toString();
    var item = form.hasAttribute('data-remove') ? form.closest(form.getAttribute('data-remove')) : null;

    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual', // a redirect here would mean "signed out": never follow it silently
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'ttw-fetch',
        'X-CSRF-Token': token
      },
      body: body
    }).then(function (res) {
      if (res.type === 'opaqueredirect') {
        return { res: { status: 401, ok: false }, out: { ok: false, error: 'Your session may have ended. Refresh the page and try again.' } };
      }
      return res.json().then(function (out) { return { res: res, out: out }; }, function () { return { res: res, out: null }; });
    }).then(function (r) {
      var res = r.res;
      var out = r.out;

      // Success needs BOTH a 2xx status and an explicit ok:true from the server.
      if (res.ok && out && out.ok === true) {
        if (item) {
          if (out.message) toast(out.message, 'success');
          removeItem(form, item);
          form.removeAttribute(BUSY);
          return;
        }
        if (form.hasAttribute('data-img')) {
          if (out.message) toast(out.message, 'success');
          swapImage(form, out);
          return;
        }
        var to = safePath(out.redirect);
        if (to) { window.location.assign(to); return; } // the page's subject is gone: the next page shows the message
        if (out.message) toast(out.message, 'success');
        setBusy(form, button, false);
        return;
      }

      // Already deleted somewhere else: the record is gone either way, so take it off this screen too.
      if (res.status === 404 && out && out.gone && item) {
        toast(failMessage(res, out), 'warn');
        removeItem(form, item);
        form.removeAttribute(BUSY);
        return;
      }

      // Failure: nothing was deleted, so keep everything on screen and give the button back.
      toast(failMessage(res, out), 'error');
      setBusy(form, button, false);
      var ahead = safePath(out && out.redirect);
      if (ahead && (res.status === 401 || res.status === 403 || (out && out.gone))) {
        setTimeout(function () { window.location.assign(ahead); }, 1600);
      }
      var field = form.querySelector('input[type="password"]');
      if (field && res.status === 400) { field.value = ''; try { field.focus(); } catch (e) { /* hidden */ } }
    }).catch(function () {
      toast('Could not reach the server. Check your connection. Nothing was deleted.', 'error');
      setBusy(form, button, false);
    });
  }

  // Runs after dialog.js (its handler is registered first): a cancelled confirmation has already been stopped there,
  // so only an approved (or confirmation-free) submit reaches this point.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches('form[data-ajax-delete]')) return;
    if (e.defaultPrevented) return; // the confirmation dialog is open, or the user cancelled
    e.preventDefault(); // no page load
    send(form, e.submitter || null);
  }, true);
})();
