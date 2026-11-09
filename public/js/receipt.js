// Receipt page: Print button and scroll the progress chips to the current step.
// (Inline scripts and onclick are blocked by the site's security policy, so this lives in a file.)
(function () {
  document.querySelectorAll('[data-print]').forEach(function (b) {
    b.addEventListener('click', function () { window.print(); });
  });
  var c = document.querySelector('.rc-chip.now');
  if (c && c.parentNode && c.parentNode.scrollTo) c.parentNode.scrollTo({ left: Math.max(0, c.offsetLeft - 20), behavior: 'auto' });
})();
