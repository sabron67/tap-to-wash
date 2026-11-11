/* Waits for the answer to an M-Pesa prompt. Asks the server every few seconds; when the customer has paid,
   cancelled or the prompt timed out, the page reloads and the server shows the right message (and the live
   updates bring in the paid bill). Runs only on a page that shows the "Check your phone" box. */
(function () {
  var box = document.getElementById('stkWait');
  if (!box) return;
  var url = box.getAttribute('data-status-url');
  var msg = box.querySelector('[data-msg]');
  var tries = 0;
  var MAX = 90; // about 4 minutes

  function next(ms) { if (++tries < MAX) setTimeout(tick, ms); }
  function tick() {
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        if (!d || !d.ok) return next(4000);
        if (d.status === 'pending') return next(3000);
        if (msg && d.message) msg.textContent = d.message;
        setTimeout(function () { location.reload(); }, d.status === 'success' ? 900 : 400);
      })
      .catch(function () { next(5000); });
  }
  setTimeout(tick, 3000);
})();
