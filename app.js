/*
 * Colour Check — user interface.
 * Flow: photo → tap something white (calibrate) → tap the fabric → score.
 * The photo is decoded into a <canvas> in this page and read there. Nothing is
 * uploaded, stored or sent anywhere.
 */
(function () {
  'use strict';

  var E = window.ColourEngine, PROFILE = window.COLOUR_PROFILE;
  var person = E.buildPerson(PROFILE);
  var app = document.getElementById('app'), main = document.getElementById('main');
  var toastEl = document.getElementById('toast');
  var pickCamera = document.getElementById('pickCamera'), pickFile = document.getElementById('pickFile');
  var DESKTOP = window.matchMedia('(min-width: 900px) and (min-aspect-ratio: 5/4)');
  var MAX_SIDE = 1600;

  var S = {
    screen: 'start',      // start | work | score
    mode: 'calibrate',    // calibrate | pick | result   (work screen)
    refType: 'white',     // white | grey
    img: null,            // { w, h, data }
    whitePt: null, white: null,
    calib: null, level: 'uncalibrated',
    fabricPt: null, fabric: null, fabricLab: null,
    result: null,
    kbd: null
  };

  /* ---------------------------------------------------------------- */
  /* Icons                                                            */
  /* ---------------------------------------------------------------- */
  function svg(w, d, sw) {
    return '<svg width="' + w + '" height="' + w + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }
  var I = {
    back: function () { return svg(20, '<path d="M15 18l-6-6 6-6"></path>'); },
    next: function () { return svg(18, '<path d="M9 18l6-6-6-6"></path>', 2.2); },
    check: function (w) { return svg(w || 18, '<path d="M5 12l5 5 9-10"></path>', 2.6); },
    target: function () { return svg(20, '<circle cx="12" cy="12" r="9"></circle><path d="M12 3v18"></path>'); },
    camera: function () { return svg(52, '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"></path><circle cx="12" cy="13.5" r="3.5"></circle>', 1.6); },
    gallery: function () { return svg(28, '<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="1.6"></circle><path d="M21 16l-5-5-9 9"></path>', 1.8); },
    upload: function () { return svg(56, '<path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"></path>', 1.5); },
    clip: function () { return svg(18, '<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"></path>'); },
    lock: function () { return svg(15, '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>'); },
    again: function () { return svg(18, '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path>'); },
    copy: function () { return svg(18, '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>'); },
    bulb: function () { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A4F0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z"></path></svg>'; },
    alert: function (w) { return svg(w || 13, '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16.5v.5"></path>', 2.4); }
  };

  /* ---------------------------------------------------------------- */
  /* Helpers                                                          */
  /* ---------------------------------------------------------------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isDesktop() { return DESKTOP.matches; }
  function rgbDots(rgb) { return rgb.join('·'); }
  function hexOfLab(lab) { return E.labToHex(lab); }
  var toastTimer = null;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 3200);
  }
  function tone(score) { return score >= 75 ? 'good' : score >= 55 ? 'warn' : 'bad'; }
  function toneColour(t) { return t === 'good' ? 'var(--good)' : t === 'warn' ? 'var(--warn)' : t === 'bad' ? 'var(--bad)' : 'var(--grey)'; }
  function castShort(cast) {
    if (!cast) return 'lighting checked';
    return { warm: 'warm light corrected', cool: 'cool light corrected', green: 'green cast corrected', pink: 'pink cast corrected', neutral: 'light was already neutral' }[cast.tone] || 'lighting corrected';
  }
  function patchRadius(kind) {
    var m = Math.min(S.img.w, S.img.h);
    return kind === 'white' ? Math.max(3, Math.round(m * 0.008)) : Math.max(4, Math.round(m * 0.012));
  }

  /* ---------------------------------------------------------------- */
  /* Persistent photo stage + loupe                                   */
  /* ---------------------------------------------------------------- */
  var stage = document.createElement('div');
  stage.className = 'stage';
  var photo = document.createElement('canvas');
  photo.className = 'photo';
  photo.tabIndex = 0;
  photo.setAttribute('role', 'img');
  var pctx = photo.getContext('2d', { willReadFrequently: true });
  var mWhite = document.createElement('div'); mWhite.className = 'marker white'; mWhite.hidden = true;
  var mFabric = document.createElement('div'); mFabric.className = 'marker fabric'; mFabric.hidden = true;
  stage.appendChild(photo); stage.appendChild(mWhite); stage.appendChild(mFabric);

  var loupe = document.createElement('div'); loupe.className = 'loupe'; loupe.hidden = true;
  var lc = document.createElement('canvas'); loupe.appendChild(lc);
  document.body.appendChild(loupe);
  var lctx = lc.getContext('2d');

  function fitStage() {
    var box = main.querySelector('.stage-box');
    if (!box || !S.img) return;
    var bw = box.clientWidth, bh = box.clientHeight;
    if (!bw || !bh) return;
    var k = Math.min(bw / S.img.w, bh / S.img.h);
    stage.style.width = Math.max(1, Math.floor(S.img.w * k)) + 'px';
    stage.style.height = Math.max(1, Math.floor(S.img.h * k)) + 'px';
    placeMarkers();
  }

  function placeMarkers() {
    if (!S.img) return;
    var sw = stage.clientWidth, sh = stage.clientHeight;
    function put(el, pt, show) {
      el.hidden = !(show && pt);
      if (show && pt) { el.style.left = (pt.x / S.img.w * sw) + 'px'; el.style.top = (pt.y / S.img.h * sh) + 'px'; }
    }
    put(mWhite, S.whitePt, S.mode === 'calibrate');
    put(mFabric, S.fabricPt, S.mode !== 'calibrate');
  }

  function toImage(clientX, clientY) {
    var r = photo.getBoundingClientRect();
    var x = (clientX - r.left) / r.width * S.img.w, y = (clientY - r.top) / r.height * S.img.h;
    return { x: Math.max(0, Math.min(S.img.w - 0.01, x)), y: Math.max(0, Math.min(S.img.h - 0.01, y)) };
  }

  function drawLoupe(pt, clientX, clientY, kind) {
    var size = 132, dpr = window.devicePixelRatio || 1;
    if (lc.width !== size * dpr) { lc.width = size * dpr; lc.height = size * dpr; }
    var disp = stage.clientWidth / S.img.w;
    var zoom = Math.max(2, disp * 4);                 // image px → loupe css px
    var src = size / zoom;
    lctx.imageSmoothingEnabled = false;
    lctx.fillStyle = '#ccc'; lctx.fillRect(0, 0, lc.width, lc.height);
    lctx.drawImage(photo, pt.x - src / 2, pt.y - src / 2, src, src, 0, 0, lc.width, lc.height);
    var c = lc.width / 2, rr = patchRadius(S.mode === 'calibrate' ? 'white' : 'fabric') * zoom * dpr;
    lctx.lineWidth = 2 * dpr;
    lctx.strokeStyle = '#fff'; lctx.beginPath(); lctx.arc(c, c, rr, 0, Math.PI * 2); lctx.stroke();
    lctx.strokeStyle = '#161616'; lctx.lineWidth = 1 * dpr; lctx.beginPath(); lctx.arc(c, c, rr + 1.5 * dpr, 0, Math.PI * 2); lctx.stroke();
    lctx.beginPath(); lctx.moveTo(c - rr - 10 * dpr, c); lctx.lineTo(c - rr - 2 * dpr, c); lctx.moveTo(c + rr + 2 * dpr, c); lctx.lineTo(c + rr + 10 * dpr, c);
    lctx.moveTo(c, c - rr - 10 * dpr); lctx.lineTo(c, c - rr - 2 * dpr); lctx.moveTo(c, c + rr + 2 * dpr); lctx.lineTo(c, c + rr + 10 * dpr);
    lctx.strokeStyle = '#fff'; lctx.lineWidth = 2 * dpr; lctx.stroke();
    var left, top, vw = window.innerWidth, vh = window.innerHeight;
    if (kind === 'mouse' || kind === 'key') { left = clientX + 24; top = clientY - size - 24; }
    else { left = clientX - size / 2; top = clientY - size - 70; if (top < 8) top = clientY + 60; }
    left = Math.max(8, Math.min(vw - size - 8, left));
    top = Math.max(8, Math.min(vh - size - 8, top));
    loupe.style.left = left + 'px'; loupe.style.top = top + 'px';
    loupe.hidden = false;
  }
  function hideLoupe() { loupe.hidden = true; }

  /* ---------------------------------------------------------------- */
  /* Sampling                                                         */
  /* ---------------------------------------------------------------- */
  function sampleAt(pt, kind) {
    var r = patchRadius(kind);
    var smp = E.samplePatch(S.img.data, S.img.w, S.img.h, pt.x, pt.y, r, kind);
    if (kind === 'fabric' && smp && smp.mixed) {
      // a print or stripe: try a smaller spot before calling it mixed
      for (var k = 2; k <= 4; k++) {
        var small = E.samplePatch(S.img.data, S.img.w, S.img.h, pt.x, pt.y, Math.max(2, r / k), kind);
        if (small && !small.mixed && small.kept >= 6) { small.small = true; return small; }
      }
    }
    return smp;
  }

  // Live preview while the finger / mouse is down (no full re-render)
  var rafPending = false, pendingPt = null;
  function preview(pt) {
    pendingPt = pt;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      var p = pendingPt; if (!p || !S.img) return;
      if (S.mode === 'calibrate') {
        var w = sampleAt(p, 'white'); if (!w) return;
        setLive(w.rawHex, E.hexToRgb8(w.rawHex));
      } else {
        var f = sampleAt(p, 'fabric'); if (!f) return;
        var lab = E.correctSample(f.lin, S.calib);
        setLive(hexOfLab(lab), E.labToRgb8(lab));
      }
    });
  }
  function setLive(hex, rgb) {
    var sw = main.querySelector('[data-live-sw]'), hx = main.querySelector('[data-live-hex]');
    if (sw) sw.style.background = hex;
    if (hx) hx.innerHTML = '<b>' + hex + '</b><small>' + rgbDots(rgb) + '</small>';
  }

  function commit(pt) {
    if (!S.img) return;
    if (S.mode === 'calibrate') {
      var w = sampleAt(pt, 'white'); if (!w) return;
      S.whitePt = pt;
      S.white = E.analyseWhite(w, S.refType, S.img.brightY);
      render();
      return;
    }
    var f = sampleAt(pt, 'fabric'); if (!f) return;
    S.fabricPt = pt;
    S.fabric = f;
    S.fabricLab = E.correctSample(f.lin, S.calib);
    if (S.mode === 'result') { evaluateNow(); }
    render();
  }

  function evaluateNow() {
    S.result = E.evaluate(S.fabricLab, person, { level: S.level, mixed: S.fabric && S.fabric.mixed });
  }

  // Pointer handling on the photo
  var activeId = null;
  photo.addEventListener('pointerdown', function (e) {
    if (!S.img || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { photo.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    activeId = e.pointerId;
    var pt = toImage(e.clientX, e.clientY);
    drawLoupe(pt, e.clientX, e.clientY, e.pointerType);
    preview(pt);
  });
  photo.addEventListener('pointermove', function (e) {
    if (!S.img) return;
    var pressed = activeId === e.pointerId;
    if (!pressed && e.pointerType !== 'mouse') return;
    var pt = toImage(e.clientX, e.clientY);
    drawLoupe(pt, e.clientX, e.clientY, e.pointerType);
    if (pressed) preview(pt);
  });
  photo.addEventListener('pointerup', function (e) {
    if (activeId !== e.pointerId) return;
    activeId = null;
    var pt = toImage(e.clientX, e.clientY);
    if (e.pointerType !== 'mouse') hideLoupe();
    commit(pt);
  });
  photo.addEventListener('pointercancel', function () { activeId = null; hideLoupe(); });
  photo.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && activeId === null) hideLoupe(); });
  photo.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // Keyboard eyedropper: arrows move, Enter / Space samples
  photo.addEventListener('keydown', function (e) {
    if (!S.img) return;
    var step = Math.max(1, Math.round(Math.min(S.img.w, S.img.h) * (e.shiftKey ? 0.05 : 0.01)));
    if (!S.kbd) S.kbd = { x: S.img.w / 2, y: S.img.h / 2 };
    var k = e.key, moved = true;
    if (k === 'ArrowLeft') S.kbd.x -= step; else if (k === 'ArrowRight') S.kbd.x += step;
    else if (k === 'ArrowUp') S.kbd.y -= step; else if (k === 'ArrowDown') S.kbd.y += step;
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); hideLoupe(); commit({ x: S.kbd.x, y: S.kbd.y }); return; }
    else if (k === 'Escape') { hideLoupe(); return; } else moved = false;
    if (!moved) return;
    e.preventDefault();
    S.kbd.x = Math.max(0, Math.min(S.img.w - 1, S.kbd.x)); S.kbd.y = Math.max(0, Math.min(S.img.h - 1, S.kbd.y));
    var r = photo.getBoundingClientRect();
    var cx = r.left + S.kbd.x / S.img.w * r.width, cy = r.top + S.kbd.y / S.img.h * r.height;
    drawLoupe(S.kbd, cx, cy, 'key');
    preview(S.kbd);
  });
  photo.addEventListener('blur', hideLoupe);

  /* ---------------------------------------------------------------- */
  /* Loading a photo                                                  */
  /* ---------------------------------------------------------------- */
  function loadFile(file) {
    if (!file) return;
    if (file.type && !/^image\//.test(file.type)) { toast('Please choose a photo (JPG, PNG, WebP or HEIC).'); return; }
    decode(file).then(function (src) {
      var nw = src.width, nh = src.height;
      if (!nw || !nh) throw new Error('empty');
      var k = Math.min(1, MAX_SIDE / Math.max(nw, nh));
      var w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
      photo.width = w; photo.height = h;
      pctx.imageSmoothingEnabled = true; pctx.imageSmoothingQuality = 'high';
      pctx.drawImage(src.image, 0, 0, w, h);
      if (src.close) src.close();
      var data = pctx.getImageData(0, 0, w, h).data;
      S.img = { w: w, h: h, data: data, brightY: E.brightReference(data, w, h) };
      S.whitePt = S.white = S.calib = S.fabricPt = S.fabric = S.fabricLab = S.result = S.kbd = null;
      S.level = 'uncalibrated';
      S.screen = 'work'; S.mode = 'calibrate';
      photo.setAttribute('aria-label', 'Your photo. Tap, or use the arrow keys and Enter, to sample a colour.');
      pushNav();
      render();
    }).catch(function () {
      toast("This browser can't open that file. Try a JPG or PNG" + (/heic|heif/i.test((file.type || '') + (file.name || '')) ? ' (HEIC photos open in Safari).' : '.'));
    });
  }

  // Decode straight from the file (no URL, so the pixels are always readable), with a fallback
  function decode(file) {
    function viaBitmap(opts) {
      return createImageBitmap(file, opts).then(function (bmp) {
        return { image: bmp, width: bmp.width, height: bmp.height, close: function () { bmp.close && bmp.close(); } };
      });
    }
    function viaImage() {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () { resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight, close: function () { URL.revokeObjectURL(url); } }); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
      });
    }
    if (typeof createImageBitmap !== 'function') return viaImage();
    return viaBitmap({ imageOrientation: 'from-image' })
      .catch(function () { return viaBitmap(undefined); })
      .catch(viaImage);
  }
  pickCamera.addEventListener('change', function () { loadFile(pickCamera.files[0]); pickCamera.value = ''; });
  pickFile.addEventListener('change', function () { loadFile(pickFile.files[0]); pickFile.value = ''; });

  // Drag & drop and paste (desktop)
  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) { e.preventDefault(); dragDepth++; var dz = main.querySelector('.dropzone'); if (dz) dz.classList.add('over'); });
  window.addEventListener('dragleave', function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { var dz = main.querySelector('.dropzone'); if (dz) dz.classList.remove('over'); } });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault(); dragDepth = 0;
    var dz = main.querySelector('.dropzone'); if (dz) dz.classList.remove('over');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  window.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.files;
    if (items && items[0] && /^image\//.test(items[0].type)) loadFile(items[0]);
  });

  /* ---------------------------------------------------------------- */
  /* Navigation (Android back button support when top-level)          */
  /* ---------------------------------------------------------------- */
  var canHistory = false;
  try { canHistory = window.top === window && !!window.history.pushState; } catch (err) { canHistory = false; }
  function pushNav() { if (canHistory) { try { history.pushState({ cc: 1 }, ''); } catch (err) { /* ignore */ } } }
  function goBack() {
    if (canHistory && history.state && history.state.cc) { try { history.back(); return; } catch (err) { /* fall through */ } }
    stepBack();
  }
  function stepBack() {
    hideLoupe();
    if (S.screen === 'score') { S.screen = 'work'; S.mode = 'pick'; }
    else if (S.screen === 'work') {
      if (S.mode === 'result') S.mode = 'pick';
      else if (S.mode === 'pick') S.mode = 'calibrate';
      else { S.screen = 'start'; }
    }
    render();
  }
  window.addEventListener('popstate', function () { if (S.screen !== 'start') stepBack(); });

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */
  var ACTIONS = {
    camera: function () { pickCamera.click(); },
    gallery: function () { pickFile.click(); },
    file: function () { pickFile.click(); },
    back: function () { goBack(); },
    restart: function () {
      hideLoupe();
      S.screen = 'start'; S.img = null; S.result = null;
      if (canHistory) { try { history.replaceState(null, ''); } catch (err) { /* ignore */ } }
      render();
    },
    ref: function (el) {
      S.refType = el.getAttribute('data-ref') === 'grey' ? 'grey' : 'white';
      if (S.whitePt) S.white = E.analyseWhite(sampleAt(S.whitePt, 'white'), S.refType, S.img.brightY);
      render();
    },
    useWhite: function () {
      if (!S.white || !S.white.ok) return;
      S.calib = E.makeCalibration(S.white);
      S.level = S.white.level === 'good' ? 'calibrated' : 'partial';
      if (S.fabric) S.fabricLab = E.correctSample(S.fabric.lin, S.calib);
      S.mode = 'pick'; pushNav(); render();
    },
    skip: function () {
      S.calib = null; S.level = 'uncalibrated';
      if (S.fabric) S.fabricLab = E.correctSample(S.fabric.lin, null);
      S.mode = 'pick'; pushNav(); render();
    },
    recalibrate: function () { S.mode = 'calibrate'; S.screen = 'work'; render(); },
    continue: function (el) {
      if (!S.fabricLab) return;
      el.disabled = true;
      setTimeout(function () {
        evaluateNow();
        if (isDesktop()) { S.mode = 'result'; } else { S.screen = 'score'; }
        pushNav(); render();
      }, 16);
    },
    copy: function () {
      if (!S.result) return;
      var hex = S.result.hex;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(hex).then(function () { toast('Copied ' + hex); }, function () { toast(hex); });
      } else toast(hex);
    }
  };
  main.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var fn = ACTIONS[el.getAttribute('data-act')];
    if (fn) fn(el);
  });

  /* ---------------------------------------------------------------- */
  /* Templates                                                        */
  /* ---------------------------------------------------------------- */
  function startMobile() {
    return '<section class="m-start">' +
      '<div class="brand">Colour Check</div>' +
      '<div class="m-start-actions">' +
      '<button class="big-primary" data-act="camera">' + I.camera() + '<span class="t">Take photo</span><span class="s">Daylight or bright light. Include a white price tag or receipt next to the fabric.</span></button>' +
      '<button class="big-secondary" data-act="gallery">' + I.gallery() + 'Choose from gallery</button>' +
      '</div>' +
      '<p class="m-foot">' + I.lock() + 'Photos never leave your phone</p>' +
      '</section>';
  }
  function startDesktop() {
    return '<section class="d-start"><div class="dropzone">' + I.upload() +
      '<h1>Drop a fabric photo here</h1><p class="or">or</p>' +
      '<button class="btn-primary" data-act="file">' + I.clip() + 'Choose file</button>' +
      '<p class="hint">JPG, PNG or WebP. Include something white (a price tag or receipt) next to the fabric for accurate colour. The photo never leaves your browser.</p>' +
      '</div></section>';
  }

  function refCard() {
    var w = S.white, cls = '', title, sub, sw = '';
    if (!w) {
      title = S.refType === 'grey' ? 'Tap the grey card' : 'No white picked yet';
      sub = S.refType === 'grey' ? 'Hold it in the same light as the fabric.' : 'A price tag, receipt or white card in the same photo works best.';
    } else {
      sw = ' style="background:' + w.hex + '"';
      if (!w.ok) { cls = ' error'; title = "Can't use this spot"; sub = w.message; }
      else if (w.level === 'warn') { cls = ' warn'; title = w.cast.label; sub = w.message; }
      else { title = w.cast.label; sub = 'Looks good. Tap “Use this white”.'; }
    }
    return '<div class="ref-card' + cls + '"><div class="sw" data-live-sw' + sw + '></div><div class="tx"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div></div>';
  }

  function refToggle() {
    return '<div class="seg" role="group" aria-label="Reference type">' +
      '<button data-act="ref" data-ref="white" aria-pressed="' + (S.refType === 'white') + '">White</button>' +
      '<button data-act="ref" data-ref="grey" aria-pressed="' + (S.refType === 'grey') + '">Grey card</button></div>';
  }

  function calStatus() {
    if (S.level === 'calibrated') return { tone: 'good', text: 'Calibrated · ' + castShort(S.calib.cast), pill: 'Calibrated' };
    if (S.level === 'partial') return { tone: 'warn', text: 'Partly calibrated · white was overexposed', pill: 'Partly calibrated' };
    return { tone: 'warn', text: 'Not calibrated · lighting may shift colours', pill: 'Not calibrated' };
  }

  function colourBar(hex, rgb, inner, emptyText) {
    var swStyle = hex ? ' style="background:' + hex + '"' : '';
    var hx = hex ? '<b>' + hex + '</b><small>' + rgbDots(rgb) + '</small>' : '<span class="empty">' + esc(emptyText || 'Tap the photo') + '</span>';
    return '<div class="colour-bar"><div class="cb-sw" data-live-sw' + swStyle + '>' + (inner || '') + '</div><div class="cb-hex" data-live-hex>' + hx + '</div></div>';
  }

  function workMobile() {
    var head, panel;
    if (S.mode === 'calibrate') {
      head = '<button class="icon-btn" data-act="back" aria-label="Back">' + I.back() + '</button>' +
        '<div class="m-title"><span class="k">Step 1 of 2 · Calibrate</span><span class="t">' + (S.refType === 'grey' ? 'Tap the grey card' : 'Tap something white') + '</span></div>' +
        '<span class="head-spacer" aria-hidden="true"></span>';
      panel = '<div class="status-line"><span class="st">Reference</span>' + refToggle() + '</div>' + refCard() +
        '<button class="btn-primary block" data-act="useWhite"' + (S.white && S.white.ok ? '' : ' disabled') + '>' + I.check() + 'Use this white</button>' +
        '<button class="btn-text" data-act="skip">Skip for now (less accurate)</button>';
    } else {
      var st = calStatus();
      head = '<button class="icon-btn" data-act="back" aria-label="Back">' + I.back() + '</button>' +
        '<div class="m-title center"><span class="t">Tap the fabric to sample</span></div>' +
        '<button class="icon-btn" data-act="recalibrate" aria-label="Calibrate white point">' + I.target() + '</button>';
      var hex = S.fabricLab ? hexOfLab(S.fabricLab) : null, rgb = S.fabricLab ? E.labToRgb8(S.fabricLab) : null;
      var right = (S.fabric && S.level !== 'uncalibrated') ? '<span class="raw"><i class="chip-sw" style="background:' + S.fabric.rawHex + '"></i>Camera <span class="mono">' + S.fabric.rawHex + '</span></span>' : '';
      var left = S.level === 'uncalibrated'
        ? '<span class="st warn">' + I.alert() + 'Not calibrated · <button class="link-btn" data-act="recalibrate">Calibrate</button></span>'
        : '<span class="st ' + st.tone + '">' + (st.tone === 'good' ? I.check(13) : I.alert()) + esc(st.text) + '</span>';
      var inner = S.fabric && S.fabric.mixed ? '<span class="pill glass warn">Mixed colours here</span>' : '';
      panel = '<div class="status-line">' + left + right + '</div>' + colourBar(hex, rgb, inner, 'Tap the fabric') +
        '<button class="btn-primary block" data-act="continue"' + (S.fabricLab ? '' : ' disabled') + '>Continue' + I.next() + '</button>';
    }
    return '<section class="work"><div class="m-head">' + head + '</div>' +
      '<div class="stage-wrap"><div class="stage-box"></div></div>' +
      '<div class="panel">' + panel + '</div></section>';
  }

  function guide(step, heading, tips, extra) {
    return '<div class="guide-card"><div class="row"><span class="pill ink">' + step + '</span>' + (extra || '') + '</div><h2>' + heading + '</h2></div>' +
      '<div class="tips3">' + tips.map(function (t, i) { return '<div class="tipcard"><span class="num">' + (i + 1) + '</span><span>' + t + '</span></div>'; }).join('') + '</div>';
  }

  function workDesktop() {
    var panel, cls = 'panel';
    if (S.mode === 'calibrate') {
      var w = S.white, inner = '', msg = '';
      if (w) {
        inner = w.ok ? '<span class="pill glass' + (w.level === 'warn' ? ' warn' : '') + '">' + esc(w.cast.label) + '</span>' : '<span class="pill bad">Not usable</span>';
        if (!w.ok) msg = '<div class="msg error">' + esc(w.message) + '</div>';
        else if (w.level === 'warn') msg = '<div class="msg warn">' + esc(w.message) + '</div>';
      }
      panel = guide('Step 1 of 2', S.refType === 'grey' ? 'Click the grey card in the photo' : 'Click something white in the photo',
        S.refType === 'grey' ? ['Hold the card in the same light', 'Click its flat middle', 'Set again for each photo'] : ['Find a price tag or receipt', 'Click its flat, plain part', 'Set again for each photo'], refToggle()) +
        colourBar(w ? w.hex : null, w ? E.hexToRgb8(w.hex) : null, inner, 'Click the photo') + msg +
        '<div class="grow"></div>' +
        '<button class="btn-primary block" data-act="useWhite"' + (w && w.ok ? '' : ' disabled') + '>' + I.check() + 'Use this white</button>' +
        '<button class="btn-text" data-act="skip">Skip for now (less accurate)</button>';
    } else if (S.mode === 'pick') {
      var st = calStatus();
      var hex = S.fabricLab ? hexOfLab(S.fabricLab) : null, rgb = S.fabricLab ? E.labToRgb8(S.fabricLab) : null;
      var pills = '<span class="pill ' + st.tone + '">' + (st.tone === 'good' ? I.check(12) : I.alert(12)) + esc(st.pill) + '</span>' +
        '<button class="pill glass" data-act="recalibrate" style="border:0;cursor:pointer">' + (S.level === 'uncalibrated' ? 'Calibrate' : 'Reset') + '</button>' +
        (S.fabric && S.fabric.mixed ? '<span class="pill glass warn">Mixed colours here</span>' : '');
      var note = S.level === 'uncalibrated' ? '<div class="msg warn">Without a white reference, store lighting can shift the colour. The score will be shown as an estimate.</div>' : '';
      panel = guide('Step 2 of 2', 'Click the shirt to pick its colour', ['Pick a flat, even area', 'Stay off folds and shine', 'Check the preview matches']) +
        colourBar(hex, rgb, pills, 'Click the fabric') + note +
        '<div class="grow"></div>' +
        '<button class="btn-primary block" data-act="continue"' + (S.fabricLab ? '' : ' disabled') + '>Continue' + I.next() + '</button>' +
        '<button class="btn-text" data-act="restart">Check another photo</button>';
    } else {
      cls = 'panel result';
      panel = resultDesktop();
    }
    return '<section class="work"><div class="stage-wrap"><div class="stage-box"></div></div><div class="' + cls + '">' + panel + '</div></section>';
  }

  /* ---------- result pieces ---------- */
  function ring(r) {
    var C = 326.73, est = r.level === 'uncalibrated';
    var t = est ? 'warn' : tone(r.score), col = toneColour(t);
    var track = t === 'good' ? '#E6EFE9' : t === 'warn' ? '#F7E6CC' : '#F6DAD7';
    var arcs = '<circle cx="60" cy="60" r="52" fill="none" stroke="' + (est ? '#EDEDED' : track) + '" stroke-width="12"></circle>';
    if (est) arcs += '<circle cx="60" cy="60" r="52" fill="none" stroke="#F3D9B0" stroke-width="12" stroke-dasharray="' + (r.range.hi / 100 * C).toFixed(1) + ' ' + C + '" transform="rotate(-90 60 60)"></circle>';
    arcs += '<circle cx="60" cy="60" r="52" fill="none" stroke="' + col + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (Math.max(1, (est ? r.range.lo : r.score)) / 100 * C).toFixed(1) + ' ' + C + '" transform="rotate(-90 60 60)"></circle>';
    var label = est ? 'Estimated score ' + r.score + ', plus or minus ' + r.range.half : 'Score ' + r.score + ' out of 100';
    return '<div class="ring"><svg viewBox="0 0 120 120" role="img" aria-label="' + label + '">' + arcs + '</svg>' +
      '<div class="val"><span class="num">' + (est ? '~' : '') + r.score + '</span><span class="of">' + (est ? '± ' + r.range.half + ' / 100' : '/ 100') + '</span></div></div>';
  }

  function headline(r) {
    if (r.level !== 'uncalibrated') return r.verdict.title;
    var lo = E.verdictFor(r.range.lo), hi = E.verdictFor(r.range.hi);
    if (lo.band === hi.band) return 'Likely ' + (/^[aeiou]/i.test(lo.title) ? 'an ' : 'a ') + lo.title.toLowerCase();
    return lo.title.replace(' match', '') + ' to ' + hi.title.replace(' match', '').toLowerCase() + ' match';
  }

  function chip(r) {
    if (r.mixed) return '<span class="pill warn">' + I.alert(11) + 'Mixed reading</span>';
    if (r.level === 'uncalibrated') return '<span class="pill warn">Estimate</span>';
    var t = r.verdict.tone;
    return '<span class="pill ' + t + '">' + (t === 'good' ? I.check(13) : I.alert()) + esc(r.verdict.chip) + '</span>';
  }

  function scoreCard(r, withSummary, withStatus) {
    var pills = chip(r);
    if (withStatus) {
      var st = calStatus();
      if (S.level !== 'uncalibrated') pills += '<span class="pill ' + st.tone + '">' + (st.tone === 'good' ? I.check(11) : I.alert(11)) + esc(st.pill) + '</span>';
      else pills += '<span class="pill warn">' + I.alert(11) + 'Not calibrated</span>';
    }
    return '<section class="score-card">' + ring(r) + '<div class="score-text"><div class="pills">' + pills + '</div><h2>' + esc(headline(r)) + '</h2>' +
      (withSummary ? '<p>' + esc(r.summary) + '</p>' : '') + '</div></section>';
  }

  function colouring(r) {
    function sw(hex, label, me) { return '<div class="sw' + (me ? ' me' : '') + '"><i style="background:' + hex + '"></i><span>' + label + '</span></div>'; }
    return '<section class="colouring"><div class="label">Next to your colouring</div><div class="row">' +
      sw(r.hex, 'Fabric', true) + '<div class="line"></div>' + sw(person.skinHex, 'Skin') + sw(person.hairHex, 'Hair') + sw(person.eyesHex, 'Eyes') +
      '</div></section>';
  }

  function factors(r, long) {
    var est = r.level === 'uncalibrated';
    return '<section class="factor-grid">' + r.factors.map(function (f) {
      var neutral = f.key === 'harmony' && f.text === 'Neutral';
      var col = est || neutral ? 'var(--grey)' : toneColour(f.score >= 75 ? 'good' : f.score >= 45 ? 'warn' : 'bad');
      return '<div class="factor"><div class="top"><span>' + esc(long ? f.label : f.short) + '</span><b>' + f.score + '</b></div>' +
        '<div class="bar"><i style="width:' + Math.max(2, f.score) + '%;background:' + col + '"></i></div><span class="txt">' + esc(f.text) + '</span></div>';
    }).join('') + '</section>';
  }

  function tipBlock(r) {
    if (r.mixed) {
      return '<div class="tip"><div class="tl">' + I.alert(18) + '<span>This spot mixes several colours (a print or stripe), so the score is for their average. Tap a single colour for a reliable result.</span></div></div>';
    }
    if (r.level === 'uncalibrated') {
      return '<div class="tip"><div class="tl">' + I.bulb() + '<span>Tap a white tag to firm up this score.</span>' +
        '<button class="btn-primary" data-act="recalibrate">Calibrate</button></div></div>';
    }
    var s = r.suggestion;
    var sug = s ? '<div class="sugg"><div class="s-sw" style="background:' + s.hex + '"><span class="pill glass">Scores ~' + s.score + '</span></div>' +
      '<div class="s-hex"><b>' + s.hex + '</b><small>' + rgbDots(s.rgb) + '</small></div></div>' : '';
    return '<div class="tip"><div class="tl">' + I.bulb() + '<span>' + esc(r.tip) + '</span></div>' + sug + '</div>';
  }

  function scoreMobile() {
    var r = S.result, st = calStatus();
    var raw = S.level === 'uncalibrated'
      ? '<span class="raw st-warn">' + I.alert(10) + 'Not calibrated · raw camera colour</span>'
      : '<span class="raw st-' + st.tone + '">' + (st.tone === 'good' ? I.check(10) : I.alert(10)) + esc(st.pill) + ' · <i class="chip-sw" style="width:10px;height:10px;background:' + S.fabric.rawHex + '"></i><span class="mono">' + S.fabric.rawHex + '</span></span>';
    return '<section class="m-score">' +
      '<div class="band" style="background:' + r.hex + '"><div class="left">' +
      '<button class="icon-btn glass" data-act="back" aria-label="Back to photo">' + I.back() + '</button></div>' +
      '<div class="hex-chip"><b>' + r.hex + '</b><small>RGB ' + r.rgb.join(', ') + '</small>' + raw + '</div></div>' +
      '<div class="m-score-body">' + scoreCard(r, true, false) + colouring(r) + factors(r, false) + tipBlock(r) +
      '<div class="grow"></div><button class="btn-primary block" data-act="restart">' + I.again() + 'Check another</button></div></section>';
  }

  function resultDesktop() {
    var r = S.result, st = calStatus();
    var raw = S.level === 'uncalibrated' ? '' : '<span class="sep"></span><span class="raw"><i class="chip-sw" style="width:14px;height:14px;background:' + S.fabric.rawHex + '"></i>Camera <span class="mono">' + S.fabric.rawHex + '</span></span>';
    var pill = '<span class="pill ' + st.tone + '">' + (st.tone === 'good' ? I.check(12) : I.alert(12)) + (S.level === 'calibrated' ? 'Calibrated colour' : esc(st.pill)) + '</span>';
    return '<div class="colour-block" style="background:' + r.hex + '"><div class="left">' + pill +
      '<div class="hexrow"><b>' + r.hex + '</b><small>RGB ' + r.rgb.join(', ') + '</small>' + raw + '</div></div>' +
      '<button class="icon-btn copy-btn" data-act="copy" aria-label="Copy hex code">' + I.copy() + '</button></div>' +
      '<div class="row2">' + scoreCard(r, false) + colouring(r) + '</div>' +
      '<div class="explain"><p>' + esc(r.explanation) + '</p>' + tipBlock(r) + '</div>' +
      factors(r, true) +
      '<div class="grow"></div>' +
      '<div class="actions-right"><button class="btn-primary" data-act="restart">' + I.again() + 'Check another</button></div>';
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */
  function render() {
    var desk = isDesktop();
    // keep the flow consistent when the layout changes (rotate / resize)
    if (desk && S.screen === 'score') { S.screen = 'work'; S.mode = 'result'; }
    if (!desk && S.screen === 'work' && S.mode === 'result') { S.screen = 'score'; }
    if (!S.img && S.screen !== 'start') S.screen = 'start';

    app.setAttribute('data-layout', desk ? 'desktop' : 'mobile');
    app.setAttribute('data-screen', S.screen);
    app.setAttribute('data-mode', S.mode);

    var html;
    if (S.screen === 'start') html = desk ? startDesktop() : startMobile();
    else if (S.screen === 'score') html = scoreMobile();
    else html = desk ? workDesktop() : workMobile();
    main.innerHTML = html;

    var box = main.querySelector('.stage-box');
    if (box) { box.appendChild(stage); fitStage(); }
    hideLoupe();
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var desk = isDesktop();
      if (desk !== (app.getAttribute('data-layout') === 'desktop')) render(); else fitStage();
    }, 60);
  });
  if (DESKTOP.addEventListener) DESKTOP.addEventListener('change', render);

  /* ---------------------------------------------------------------- */
  /* Offline support (only when served over https as a normal page)   */
  /* ---------------------------------------------------------------- */
  if (!window.__SINGLE_FILE__ && 'serviceWorker' in navigator && canHistory &&
      (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline cache is optional */ });
    });
  }

  // Small hook for automated tests
  window.__colourCheck = { state: S, render: render, loadFile: loadFile, commit: commit, actions: ACTIONS };

  render();
})();
