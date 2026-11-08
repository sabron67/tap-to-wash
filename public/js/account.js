(function () {
  'use strict';
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });
  document.querySelectorAll('table.table').forEach(function (t) {
    var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    t.querySelectorAll('tbody tr').forEach(function (tr) {
      Array.prototype.forEach.call(tr.children, function (td, i) {
        if (td.tagName === 'TD' && !td.hasAttribute('colspan') && heads[i]) td.setAttribute('data-label', heads[i]);
      });
    });
  });
})();
