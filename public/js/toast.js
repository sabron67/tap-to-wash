// Turns server messages (.flash) into floating toasts: icon, close button, timer bar, auto-dismiss.
// Errors stay a little longer. Hover or focus pauses the timer. Works without JS too (the message just shows in place).
(function () {
  var ICONS = {
    success: '<path d="M20 6 9 17l-5-5"/>',
    error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
  };
  var TITLES = { success: 'Done', error: 'Please check', warn: 'Heads up', info: 'Information' };
  var svg = function (d) {
    return '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  };

  function positionToasts() {
    var offset = 0;
    Array.prototype.forEach.call(document.querySelectorAll('.flash.toast-card'), function (el) {
      el.style.setProperty('--toast-offset', offset + 'px');
      offset += el.getBoundingClientRect().height + 12;
    });
  }

  function build(el) {
    if (el.getAttribute('data-toast')) return;
    el.setAttribute('data-toast', '1');
    var type = el.classList.contains('error') ? 'error' : el.classList.contains('warn') ? 'warn' : el.classList.contains('info') ? 'info' : 'success';
    var msg = el.textContent.trim();
    var ms = type === 'error' ? 9000 : 6000;
    el.classList.add('toast-card');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML =
      '<span class="tc-icon">' + svg(ICONS[type]) + '</span>' +
      '<div class="tc-body"><strong></strong><span></span></div>' +
      '<button type="button" class="tc-close" aria-label="Dismiss message">' + svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>') + '</button>' +
      '<i class="tc-bar" style="animation-duration:' + ms + 'ms"></i>';
    el.querySelector('strong').textContent = TITLES[type];
    el.querySelector('.tc-body span').textContent = msg;

    var timer;
    var close = function () {
      clearTimeout(timer);
      el.classList.add('hide');
      setTimeout(function () { el.remove(); positionToasts(); }, 400);
    };
    var start = function () { clearTimeout(timer); el.classList.remove('paused'); timer = setTimeout(close, ms); };
    var pause = function () { clearTimeout(timer); el.classList.add('paused'); };
    el.querySelector('.tc-close').addEventListener('click', close);
    el.addEventListener('mouseenter', pause);
    el.addEventListener('mouseleave', start);
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', start);
    start();
  }

  // window.ttwToast('Message', 'error' | 'success' | 'warn' | 'info') shows a themed toast from any script.
  window.ttwToast = function (message, type) {
    var el = document.createElement('div');
    el.className = 'flash ' + (type || 'info');
    el.textContent = message;
    document.body.appendChild(el);
    build(el);
    positionToasts();
  };

  // Replace the browser's own "Please fill out this field" bubble with a themed toast.
  var shown = false;
  document.addEventListener('invalid', function (e) {
    var field = e.target;
    e.preventDefault(); // hides the native bubble
    if (shown) return;
    shown = true;
    setTimeout(function () { shown = false; }, 600);
    var wrap = field.closest && field.closest('label, .field');
    var label = wrap && wrap.querySelector('span') ? wrap.querySelector('span').textContent.replace('*', '').trim() : (field.getAttribute('aria-label') || field.placeholder || field.name || '');
    var why = field.validationMessage || 'This field needs attention.';
    try { field.focus({ preventScroll: false }); } catch (err) { /* hidden field */ }
    window.ttwToast(label ? label + ': ' + why : why, 'error');
  }, true);

  function init() {
    var messages = Array.prototype.slice.call(document.querySelectorAll('.flash'));
    messages.forEach(build);
    positionToasts();
    window.addEventListener('resize', positionToasts);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
