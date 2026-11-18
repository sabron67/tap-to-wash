// "Install app" prompt: offers to add the site to the phone / computer as an app (PWA).
//  - Chrome, Edge, Samsung Internet and other Chromium browsers: shows our banner, then the browser's own install dialog.
//  - iPhone / iPad Safari (no install dialog exists): shows the same banner with the "Share -> Add to Home Screen" steps.
// Nothing is shown when the site is already running as an installed app, or after the visitor chose "Not now" (asked again in 7 days).
(function () {
  var KEY = 'ttw-install-dismissed';
  var WAIT_DAYS = 7;
  var deferred = null;
  var banner = null;

  function installed() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function snoozed() {
    try {
      var t = +localStorage.getItem(KEY);
      return t && Date.now() - t < WAIT_DAYS * 86400000;
    } catch (e) { return false; }
  }
  function snooze() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} }

  var ua = navigator.userAgent || '';
  var isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isIosSafari = isIos && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function hide(remember) {
    if (remember) snooze();
    if (!banner) return;
    banner.classList.remove('show');
    var b = banner;
    banner = null;
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 300);
  }

  function show(mode) {
    if (banner || installed() || snoozed()) return;
    var name = (document.querySelector('meta[property="og:site_name"]') || {}).content || 'our app';

    banner = el('div', 'install-banner');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Install ' + name);

    var img = el('img', 'install-icon');
    img.src = '/icons/icon-192.webp';
    img.alt = '';
    img.width = 48;
    img.height = 48;

    var txt = el('div', 'install-txt');
    txt.appendChild(el('strong', 'install-title', 'Install ' + name));
    txt.appendChild(el('span', 'install-sub', mode === 'ios'
      ? 'Tap Share, then "Add to Home Screen".'
      : 'Add it to your home screen for faster booking and live order updates.'));

    var actions = el('div', 'install-actions');
    if (mode === 'ios') {
      var ok = el('button', 'btn btn-primary install-go', 'Got it');
      ok.type = 'button';
      ok.addEventListener('click', function () { hide(true); });
      actions.appendChild(ok);
    } else {
      var go = el('button', 'btn btn-primary install-go', 'Install');
      go.type = 'button';
      go.addEventListener('click', function () {
        if (!deferred) return hide(false);
        var ev = deferred;
        deferred = null;
        hide(false);
        ev.prompt();
        if (ev.userChoice) ev.userChoice.then(function (c) { if (c && c.outcome !== 'accepted') snooze(); });
      });
      var no = el('button', 'btn btn-ghost install-no', 'Not now');
      no.type = 'button';
      no.addEventListener('click', function () { hide(true); });
      actions.appendChild(go);
      actions.appendChild(no);
    }

    var x = el('button', 'install-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '\u00D7';
    x.addEventListener('click', function () { hide(true); });

    banner.appendChild(img);
    banner.appendChild(txt);
    banner.appendChild(actions);
    banner.appendChild(x);
    document.body.appendChild(banner);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (banner) banner.classList.add('show'); }); });
  }

  // The service worker is what makes the site installable (and lets phones show order alerts when it is installed).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); // keep the browser's mini-bar away; we show our own banner
    deferred = e;
    setTimeout(function () { show('prompt'); }, 3500);
  });
  window.addEventListener('appinstalled', function () { deferred = null; hide(false); try { localStorage.removeItem(KEY); } catch (e) {} });

  if (isIosSafari && !installed()) setTimeout(function () { show('ios'); }, 4500);
})();
