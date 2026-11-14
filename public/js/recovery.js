// Copy / print buttons for the recovery codes page.
(function () {
  var list = document.getElementById('rcCodes');
  if (!list) return;
  var codes = function () { return Array.prototype.map.call(list.querySelectorAll('code'), function (c) { return c.textContent; }); };
  var copy = document.querySelector('[data-rc-copy]');
  var print = document.querySelector('[data-rc-print]');
  if (copy) copy.addEventListener('click', function () {
    var text = codes().join('\n');
    var done = function () { var old = copy.innerHTML; copy.textContent = 'Copied'; setTimeout(function () { copy.innerHTML = old; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) {} document.body.removeChild(t); }
  });
  if (print) print.addEventListener('click', function () { window.print(); });
})();
