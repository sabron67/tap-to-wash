// Themed confirmation dialog. Replaces the browser's own window.confirm() pop-up so every
// message in the site uses the same look (light, dark and system) and works well with a keyboard.
//   - Any <form data-confirm="Are you sure?"> asks first, then submits.
//   - window.ttwConfirm(message, { title, confirmText, cancelText, danger }) returns a Promise<boolean>.
(function () {
  'use strict';

  var ICON = '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  var DANGER = /\b(delete|remove|cancel|reset|clear|revoke|discard|disable|deactivate)\b/i;

  function ttwConfirm(message, opts) {
    opts = opts || {};
    var danger = opts.danger !== undefined ? opts.danger : DANGER.test(message || '');
    var opener = document.activeElement;

    return new Promise(function (resolve) {
      var root = document.createElement('div');
      root.className = 'dlg';
      root.innerHTML =
        '<div class="dlg-backdrop" data-dlg-no></div>' +
        '<div class="dlg-card" role="alertdialog" aria-modal="true" aria-labelledby="dlgTitle" aria-describedby="dlgMsg">' +
        '<span class="dlg-icon' + (danger ? ' is-danger' : '') + '">' + ICON + '</span>' +
        '<h3 id="dlgTitle"></h3><p id="dlgMsg"></p>' +
        '<div class="dlg-actions"><button type="button" class="btn btn-ghost" data-dlg-no></button>' +
        '<button type="button" class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-dlg-yes></button></div></div>';
      root.querySelector('#dlgTitle').textContent = opts.title || 'Please confirm';
      root.querySelector('#dlgMsg').textContent = message || 'Are you sure?';
      root.querySelector('[data-dlg-no].btn').textContent = opts.cancelText || 'Cancel';
      root.querySelector('[data-dlg-yes]').textContent = opts.confirmText || (danger ? 'Yes, continue' : 'Confirm');
      document.body.appendChild(root);
      document.body.classList.add('modal-open');

      var yes = root.querySelector('[data-dlg-yes]');
      var no = root.querySelector('.btn[data-dlg-no]');
      function done(ok) {
        document.removeEventListener('keydown', onKey, true);
        document.body.classList.remove('modal-open');
        root.classList.add('out');
        setTimeout(function () { root.remove(); }, 160);
        if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* element gone */ } }
        resolve(ok);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
        else if (e.key === 'Tab') {
          // keep keyboard focus inside the dialog
          if (e.shiftKey && document.activeElement === no) { e.preventDefault(); yes.focus(); }
          else if (!e.shiftKey && document.activeElement === yes) { e.preventDefault(); no.focus(); }
        }
      }
      root.addEventListener('click', function (e) {
        if (e.target.closest('[data-dlg-yes]')) done(true);
        else if (e.target.closest('[data-dlg-no]')) done(false);
      });
      document.addEventListener('keydown', onKey, true);
      (danger ? no : yes).focus();
    });
  }
  window.ttwConfirm = ttwConfirm;

  // Forms that ask before they submit.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches('form[data-confirm]')) return;
    if (form.__ttwOk) { form.__ttwOk = false; return; }
    e.preventDefault();
    var submitter = e.submitter || null;
    ttwConfirm(form.getAttribute('data-confirm')).then(function (ok) {
      if (!ok) return;
      form.__ttwOk = true;
      if (form.requestSubmit) form.requestSubmit(submitter || undefined);
      else form.submit();
    });
  }, true);
})();
