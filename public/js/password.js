// Adds a show / hide (eye) button to every password field on the site, including the ones added later.
(function () {
  'use strict';
  if (window.__ttwPw) return;
  window.__ttwPw = true;

  var EYE = '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

  function enhance(input) {
    if (input.getAttribute('data-pw') || input.disabled) return;
    input.setAttribute('data-pw', '1');
    var wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Show password';
    btn.innerHTML = EYE;
    wrap.appendChild(btn);

    function set(show) {
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.title = show ? 'Hide password' : 'Show password';
    }
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      set(show);
      input.focus({ preventScroll: true });
    });
    // never leave a password visible after the form is sent or the page is restored from the back button
    if (input.form) input.form.addEventListener('submit', function () { set(false); });
    window.addEventListener('pageshow', function () { set(false); });
  }

  function scan(root) {
    (root || document).querySelectorAll('input[type="password"]').forEach(enhance);
  }
  scan();
  if (window.MutationObserver) {
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType === 1) scan(n);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }
})();
