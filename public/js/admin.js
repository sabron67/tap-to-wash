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

  // Background photos: resize in the browser, then upload as JPEG
  var tokenEl = document.getElementById('csrfToken');
  document.querySelectorAll('[data-photo-upload]').forEach(function (btn) {
    var slot = btn.getAttribute('data-photo-upload');
    var input = document.querySelector('[data-photo-input="' + slot + '"]');
    var err = document.querySelector('[data-photo-err="' + slot + '"]');
    function show(msg) { err.textContent = msg || ''; err.classList.toggle('show', !!msg); }
    btn.addEventListener('click', function () {
      show('');
      var file = input.files && input.files[0];
      if (!file) return show('Choose a picture first.');
      if (!/^image\//.test(file.type)) return show('That file is not a picture.');
      var reader = new FileReader();
      reader.onerror = function () { show('That picture could not be read.'); };
      reader.onload = function () {
      var url = reader.result; // data: URL (allowed by the page's security policy)
      var img = new Image();
      img.onload = function () {
        var max = 1800, scale = Math.min(1, max / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          if (!blob) return show('Could not prepare that picture.');
          btn.disabled = true;
          fetch('/admin/photos/' + slot, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-CSRF-Token': tokenEl ? tokenEl.value : '' }, body: blob })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (out) { if (out.ok) window.location.reload(); else { btn.disabled = false; show(out.error || 'Upload failed.'); } })
            .catch(function () { btn.disabled = false; show('Upload failed. Check your connection.'); });
        }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { show('That picture could not be read.'); };
      img.src = url;
      };
      reader.readAsDataURL(file);
    });
  });
})();
