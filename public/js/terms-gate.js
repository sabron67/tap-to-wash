// Sign-in and sign-up forms marked data-terms-gate keep their submit button off until the Terms box is ticked.
// (The server checks it again, so this is only a helpful guide, never the only lock.)
(function () {
  'use strict';
  function wire(form) {
    var box = form.querySelector('input[name="accept"]');
    var btn = form.querySelector('button[type="submit"]');
    var hint = form.querySelector('[data-terms-hint]');
    if (!box || !btn) return;
    var sync = function () {
      btn.disabled = !box.checked;
      if (hint) hint.hidden = box.checked;
    };
    box.addEventListener('change', sync);
    window.addEventListener('pageshow', sync); // browsers can restore a ticked box when you press Back
    sync();
  }
  document.querySelectorAll('form[data-terms-gate]').forEach(wire);
})();
