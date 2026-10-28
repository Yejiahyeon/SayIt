'use strict';
(function () {
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    setTimeout(function () {
      if (!event.defaultPrevented) btn.disabled = true;
    }, 0);
  });

  document.addEventListener('change', function (event) {
    var input = event.target;
    if (input.type === 'radio' && input.name === 'choice') {
      document.querySelectorAll('.choice-card').forEach(function (card) {
        card.classList.toggle('is-checked', card.contains(input));
      });
    }
  });

  function setupOwnerCards() {
    document.querySelectorAll('[data-detail-url]').forEach(function (card) {
      var detailUrl = card.getAttribute('data-detail-url');
      if (!detailUrl) return;
      var voteLink = card.querySelector('[data-detail-single-click]');
      var voteTimer = null;
      var lastTouch = 0;

      function goDetail() {
        if (voteTimer) {
          clearTimeout(voteTimer);
          voteTimer = null;
        }
        window.location.href = detailUrl;
      }

      function isInteractive(target) {
        var el = target.closest('a, button, input, select, textarea');
        if (!el) return false;
        return !(voteLink && el === voteLink);
      }

      if (voteLink) {
        voteLink.addEventListener('click', function (event) {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          if (voteTimer) clearTimeout(voteTimer);
          voteTimer = setTimeout(function () {
            window.location.href = voteLink.href;
          }, 280);
        });
      }

      card.addEventListener('dblclick', function (event) {
        if (isInteractive(event.target)) return;
        event.preventDefault();
        goDetail();
      });

      card.addEventListener('keydown', function (event) {
        if (event.target !== card) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          goDetail();
        }
      });

      card.addEventListener('touchend', function (event) {
        if (isInteractive(event.target) && !(voteLink && event.target.closest('[data-detail-single-click]'))) return;
        var now = Date.now();
        if (now - lastTouch < 400) {
          event.preventDefault();
          goDetail();
          lastTouch = 0;
          return;
        }
        lastTouch = now;
      });
    });
  }

  setupOwnerCards();
})();

(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  var MAX_TOTAL = 3.8 * 1024 * 1024;
  var MAX_FILE = 3 * 1024 * 1024;

  function compressFile(file) {
    if (!file || !/^image\//.test(file.type) || file.type === 'image/gif') return Promise.resolve(file);
    if (file.size <= 350 * 1024) return Promise.resolve(file);
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        var scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) return resolve(file);
          var name = file.name.replace(/\.[^.]+$/, '') + '.webp';
          resolve(new File([blob], name, { type: 'image/webp', lastModified: Date.now() }));
        }, 'image/webp', 0.8);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      image.src = url;
    });
  }

  function replaceFiles(input, files) {
    if (!window.DataTransfer) return false;
    try {
      var transfer = new DataTransfer();
      files.forEach(function (file) { transfer.items.add(file); });
      input.files = transfer.files;
      return true;
    } catch (error) {
      return false;
    }
  }

  function compressInput(input) {
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return Promise.resolve();
    return Promise.all(files.map(compressFile)).then(function (compressed) {
      replaceFiles(input, compressed);
    });
  }

  document.addEventListener('change', function (event) {
    var input = event.target;
    if (input.type === 'file' && input.files && input.files.length) {
      input.dataset.compressing = '1';
      compressInput(input).then(function () { input.dataset.compressing = ''; });
    }
  });

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (form.enctype !== 'multipart/form-data') return;
    if (form.dataset.ready === '1') {
      delete form.dataset.ready;
      return;
    }
    var inputs = Array.prototype.slice.call(form.querySelectorAll('input[type="file"]'));
    if (!inputs.some(function (input) { return input.files && input.files.length; })) return;
    event.preventDefault();
    Promise.all(inputs.map(compressInput)).then(function () {
      var total = 0;
      var tooBig = false;
      inputs.forEach(function (input) {
        Array.prototype.forEach.call(input.files || [], function (file) {
          total += file.size;
          if (file.size > MAX_FILE) tooBig = true;
        });
      });
      if (tooBig || total > MAX_TOTAL) {
        window.alert('Οι εικόνες είναι πολύ μεγάλες. Το όριο είναι 3MB ανά εικόνα και 4MB συνολικά.');
        return;
      }
      form.dataset.ready = '1';
      form.requestSubmit();
    });
  }, true);
})();
