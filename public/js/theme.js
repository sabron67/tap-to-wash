(function () {
  'use strict';

  var KEY = 'ttw-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try {
      var t = localStorage.getItem(KEY);
      return t === 'light' || t === 'dark' ? t : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function paint(mode) {
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);

    document.querySelectorAll('[data-theme-set]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-theme-set') === mode ? 'true' : 'false');
    });

    // keep the browser bar colour in step with the page: a manual choice sets both
    // theme-color tags to that colour, System restores the per-scheme defaults
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      var light = m.getAttribute('data-light');
      var dark = m.getAttribute('data-dark');
      var own = light || dark;
      if (mode === 'system') m.setAttribute('content', own);
      else m.setAttribute('content', mode === 'dark' ? '#0C1511' : '#F3FAF6');
    });
  }

  function save(mode) {
    try {
      if (mode === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch (e) {
      /* private mode: the choice still applies until the page is closed */
    }
  }

  document.querySelectorAll('[data-theme-set]').forEach(function (b) {
    b.addEventListener('click', function () {
      var mode = b.getAttribute('data-theme-set');
      save(mode);
      paint(mode);
    });
  });

  // While on "System", react live when the device switches between light and dark.
  if (media) {
    var onChange = function () {
      if (stored() === 'system') paint('system');
    };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }

  // Keep several open tabs in sync.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === null) paint(stored());
  });

  paint(stored());
})();
