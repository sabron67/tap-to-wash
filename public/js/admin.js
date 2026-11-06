(function () {
  'use strict';

  // Mobile sidebar
  var menuBtn = document.getElementById('menuBtn');
  var sidebar = document.getElementById('sidebar');
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', function () {
      sidebar.classList.toggle('open');
    });
  }

  // Confirm before destructive actions
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Emoji chips fill the nearest icon field
  document.querySelectorAll('.emoji').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var form = btn.closest('form');
      var input = form && form.querySelector('.icon-input');
      if (input) input.value = btn.getAttribute('data-emoji');
    });
  });

  // "Use estimate" style helpers
  document.querySelectorAll('[data-fill]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.querySelector(btn.getAttribute('data-fill'));
      if (target) target.value = btn.getAttribute('data-value');
    });
  });

  // Auto-dismiss flash messages
  var flash = document.querySelector('.flash');
  if (flash) {
    setTimeout(function () {
      flash.classList.add('hide');
    }, 5000);
  }
})();
