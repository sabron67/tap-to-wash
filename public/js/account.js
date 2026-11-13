(function () {
  'use strict';
  // data-confirm forms are handled by /js/dialog.js (themed dialog)
  document.querySelectorAll('table.table').forEach(function (t) {
    var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    t.querySelectorAll('tbody tr').forEach(function (tr) {
      Array.prototype.forEach.call(tr.children, function (td, i) {
        if (td.tagName === 'TD' && !td.hasAttribute('colspan') && heads[i]) td.setAttribute('data-label', heads[i]);
      });
    });
  });
})();
