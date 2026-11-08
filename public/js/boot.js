// Runs in <head> before first paint: applies a saved Light/Dark choice and marks the page as JS-enabled.
(function () {
  var d = document.documentElement;
  try {
    var t = localStorage.getItem('ttw-theme');
    if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
  } catch (e) {}
  d.classList.add('js');
  // Safety net: if the scroll script never starts, never leave content hidden.
  setTimeout(function () { if (!window.__ttwScroll) d.classList.remove('js'); }, 4000);
})();
