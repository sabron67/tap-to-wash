(function () {
  'use strict';
  window.__ttwScroll = true;
  var doc = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  // ---- stagger children of [data-stagger] ----
  $$('[data-stagger]').forEach(function (g) {
    Array.prototype.forEach.call(g.children, function (c, i) { c.classList.add('rv'); c.style.setProperty('--d', Math.min(i, 8) * 70 + 'ms'); });
  });

  // ---- reveal on scroll ----
  var items = $$('.rv');
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  // ---- active nav link ----
  var links = $$('.nav-links a[href^="#"]');
  if (links.length && 'IntersectionObserver' in window) {
    var map = {};
    links.forEach(function (a) { var s = document.querySelector(a.getAttribute('href')); if (s) map[s.id] = a; });
    var so = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && map[e.target.id]) { links.forEach(function (l) { l.classList.remove('active'); }); map[e.target.id].classList.add('active'); }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    Object.keys(map).forEach(function (id) { so.observe(document.getElementById(id)); });
  }

  // ---- scroll-linked: progress bar, nav state, hero parallax/fade, band parallax ----
  var bar = document.getElementById('progress');
  var nav = document.querySelector('.nav');
  var hero = document.querySelector('.hero');
  var heroInner = hero && hero.querySelector('.hero-inner');
  var bands = $$('.band.has-img');
  var ticking = false;

  function frame() {
    ticking = false;
    var y = window.pageYOffset || doc.scrollTop;
    var vh = window.innerHeight;
    var max = Math.max(doc.scrollHeight - vh, 1);
    if (bar) bar.style.transform = 'scaleX(' + Math.min(y / max, 1) + ')';
    if (nav) nav.classList.toggle('scrolled', y > 8);
    if (reduce || window.innerWidth <= 720) return;
    if (hero && y < vh * 1.3) {
      hero.style.setProperty('--py', (y * 0.22).toFixed(1) + 'px');
      if (heroInner) {
        var k = Math.min(y / (vh * 0.75), 1);
        heroInner.style.opacity = String(1 - k);
        heroInner.style.transform = 'translate3d(0,' + (-k * 40).toFixed(1) + 'px,0)';
      }
    }
    bands.forEach(function (b) {
      var r = b.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      b.style.setProperty('--py', (((r.top + r.height / 2) - vh / 2) * -0.06).toFixed(1) + 'px');
    });
  }
  function onScroll() { if (!ticking) { ticking = true; window.requestAnimationFrame(frame); } }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  frame();
})();
