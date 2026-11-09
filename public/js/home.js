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
