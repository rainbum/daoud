(() => {
  'use strict';

  const TOTAL = 36;
  const MUSIC_VOLUME = 0.05; // softer background level
  const PAPER_VOLUME = 0.14;

  const readerEl = document.getElementById('reader');
  const sceneEl = document.getElementById('scene');
  const bookViewportEl = document.querySelector('.book-viewport');
  const bookEl = document.getElementById('book');
  const pageStatus = document.getElementById('pageStatus');
  const loadStatus = document.getElementById('loadStatus');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const soundBtn = document.getElementById('soundBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const paperSound = document.getElementById('paperSound');
  const ambientMusic = document.getElementById('ambientMusic');
  const hint = document.getElementById('hint');

  let pageFlip = null;
  let current = 0;
  let audioEnabled = true;
  let musicStarted = false;
  let fadeFrame = 0;
  let hintHidden = false;
  let layoutTimer = 0;
  let immersiveFallback = false;
  let paperCtx = null;
  let premiumPaperBuffer = null;
  let zoomScale = 1;
  let zoomX = 0;
  let zoomY = 0;
  let pinchState = null;
  let panState = null;
  let touchSequenceLocked = false;

  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;

  const pageUrl = (n) => `assets/pages/page-${String(n).padStart(3, '0')}.webp`;

  function buildPages() {
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= TOTAL; i += 1) {
      const page = document.createElement('div');
      page.className = 'page';
      page.dataset.page = String(i);
      if (i === 1 || i === TOTAL) page.dataset.density = 'hard';

      const img = document.createElement('img');
      img.src = pageUrl(i);
      img.alt = i === 1 ? 'In Loving Memory of Mohammad Daoud — cover' : `Memorial book page ${i}`;
      img.decoding = 'async';
      img.loading = i <= 6 ? 'eager' : 'lazy';
      img.draggable = false;
      page.appendChild(img);
      frag.appendChild(page);
    }
    bookEl.appendChild(frag);
  }

  function hideHint() {
    if (hintHidden) return;
    hintHidden = true;
    hint.classList.add('hide');
  }

  function fadeMusic(target, duration = 1200, pauseWhenDone = false) {
    cancelAnimationFrame(fadeFrame);
    const start = ambientMusic.volume;
    const startedAt = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - startedAt) / Math.max(1, duration));
      const eased = 1 - Math.pow(1 - p, 3);
      ambientMusic.volume = start + (target - start) * eased;
      if (p < 1) {
        fadeFrame = requestAnimationFrame(step);
      } else if (pauseWhenDone && target === 0) {
        ambientMusic.pause();
      }
    };
    fadeFrame = requestAnimationFrame(step);
  }

  function ensureMusic() {
    if (!audioEnabled || musicStarted) return;
    ambientMusic.volume = 0;
    ambientMusic.loop = true;
    ambientMusic.play().then(() => {
      musicStarted = true;
      fadeMusic(MUSIC_VOLUME, 4800);
    }).catch(() => {
      musicStarted = false;
    });
  }

  function getPaperAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!paperCtx) paperCtx = new AudioCtx({ latencyHint: 'interactive' });
    if (paperCtx.state === 'suspended') paperCtx.resume().catch(() => {});
    return paperCtx;
  }

  function envelopeAt(t, points) {
    for (let i = 1; i < points.length; i += 1) {
      if (t <= points[i][0]) {
        const a = points[i - 1];
        const b = points[i];
        const p = (t - a[0]) / Math.max(0.0001, b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, p));
      }
    }
    return points[points.length - 1][1];
  }

  function buildPremiumPaperBuffer(ctx) {
    const duration = 1.02;
    const sr = ctx.sampleRate;
    const length = Math.ceil(duration * sr);
    const buffer = ctx.createBuffer(2, length, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const bodyPts = [[0,0],[0.06,0.05],[0.17,0.30],[0.32,0.90],[0.50,1],[0.67,0.48],[0.86,0.12],[1.02,0]];
    const crinklePts = [[0,0],[0.10,0.08],[0.21,0.33],[0.36,0.18],[0.55,0.28],[0.73,0.06],[1.02,0]];
    const flexPts = [[0,0],[0.20,0.08],[0.42,0.28],[0.63,0.13],[1.02,0]];

    let low = 0;
    let mid = 0;
    let landingLow = 0;
    let peak = 0;

    for (let i = 0; i < length; i += 1) {
      const t = i / sr;
      const white = Math.random() * 2 - 1;
      low += 0.018 * (white - low);
      mid += 0.12 * (white - mid);

      const high = white - mid;
      const texture = white - low;
      let mono =
        high * envelopeAt(t, bodyPts) * 0.48 +
        texture * envelopeAt(t, crinklePts) * 0.16 +
        low * envelopeAt(t, flexPts) * 1.8;

      if (t >= 0.76) {
        const landingWhite = Math.random() * 2 - 1;
        landingLow += 0.08 * (landingWhite - landingLow);
        mono += landingLow * Math.exp(-(t - 0.76) / 0.055) * 1.25;
      }

      const pan = -0.55 + (0.97 * (t / duration));
      const angle = (pan + 1) * Math.PI / 4;
      const l = mono * Math.cos(angle);
      const r = mono * Math.sin(angle);
      left[i] = l;
      right[i] = r;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
    }

    const scale = peak > 0 ? 0.70 / peak : 1;
    for (let i = 0; i < length; i += 1) {
      left[i] *= scale;
      right[i] *= scale;
    }

    return buffer;
  }

  function playPaperFallback() {
    try {
      paperSound.pause();
      paperSound.currentTime = 0;
      paperSound.volume = PAPER_VOLUME;
      paperSound.playbackRate = 0.98 + Math.random() * 0.03;
      paperSound.play().catch(() => {});
    } catch (_) {}
  }

  function playPaper() {
    if (!audioEnabled) return;
    try {
      const ctx = getPaperAudioContext();
      if (!ctx) {
        playPaperFallback();
        return;
      }
      if (!premiumPaperBuffer) premiumPaperBuffer = buildPremiumPaperBuffer(ctx);

      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = premiumPaperBuffer;
      source.playbackRate.value = 0.985 + Math.random() * 0.03;
      gain.gain.value = PAPER_VOLUME;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    } catch (_) {
      playPaperFallback();
    }
  }

  function setAudioEnabled(next) {
    audioEnabled = Boolean(next);
    soundBtn.setAttribute('aria-pressed', String(audioEnabled));
    soundBtn.textContent = audioEnabled ? '♫ Music on' : '♫ Music off';
    soundBtn.title = audioEnabled
      ? 'Soft background music is on. It starts after your first page interaction.'
      : 'Background music and page sounds are muted.';

    if (audioEnabled) {
      if (musicStarted) {
        ambientMusic.play().then(() => fadeMusic(MUSIC_VOLUME, 1500)).catch(() => {});
      } else {
        ensureMusic();
      }
    } else {
      fadeMusic(0, 700, true);
    }
  }

  function scheduleLayoutRefresh(delay = 100) {
    clearTimeout(layoutTimer);
    layoutTimer = window.setTimeout(() => {
      if (pageFlip && typeof pageFlip.update === 'function') {
        pageFlip.update();
      }
    }, delay);
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function setFallbackFullscreen(active) {
    immersiveFallback = Boolean(active);
    if (readerEl) readerEl.classList.toggle('immersive-fallback', immersiveFallback);
    syncFullscreenButton();
    scheduleLayoutRefresh(120);
  }

  function syncFullscreenButton() {
    if (!fullscreenBtn) return;
    const active = Boolean(fullscreenElement()) || immersiveFallback;
    fullscreenBtn.hidden = false;
    fullscreenBtn.textContent = active ? '⤢' : '⛶';
    fullscreenBtn.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen');
    fullscreenBtn.title = active ? 'Exit full screen' : 'Full screen';
  }

  function toggleFullscreen() {
    if (!readerEl) return;

    if (fullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        try {
          const result = exit.call(document);
          if (result && typeof result.catch === 'function') result.catch(() => setFallbackFullscreen(false));
        } catch (_) {
          setFallbackFullscreen(false);
        }
      } else {
        setFallbackFullscreen(false);
      }
      return;
    }

    if (immersiveFallback) {
      setFallbackFullscreen(false);
      return;
    }

    const enter = readerEl.requestFullscreen || readerEl.webkitRequestFullscreen;
    if (!enter) {
      setFallbackFullscreen(true);
      return;
    }

    try {
      const result = enter.call(readerEl);
      if (result && typeof result.then === 'function') {
        result.then(() => {
          immersiveFallback = false;
          syncFullscreenButton();
          scheduleLayoutRefresh(160);
        }).catch(() => setFallbackFullscreen(true));
      } else {
        immersiveFallback = false;
        syncFullscreenButton();
        scheduleLayoutRefresh(160);
      }
    } catch (_) {
      setFallbackFullscreen(true);
    }
  }


  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function touchDistance(a, b) {
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }

  function touchCenter(a, b) {
    return {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2
    };
  }

  function sceneCenter() {
    const r = sceneEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function clampZoomPan() {
    if (zoomScale <= 1.01) {
      zoomScale = 1;
      zoomX = 0;
      zoomY = 0;
      return;
    }

    const scaledW = Math.max(1, bookViewportEl.offsetWidth) * zoomScale;
    const scaledH = Math.max(1, bookViewportEl.offsetHeight) * zoomScale;
    const maxX = Math.max(36, (scaledW - sceneEl.clientWidth) / 2 + 36);
    const maxY = Math.max(36, (scaledH - sceneEl.clientHeight) / 2 + 36);

    zoomX = clamp(zoomX, -maxX, maxX);
    zoomY = clamp(zoomY, -maxY, maxY);
  }

  function applyBookZoom(animate = false) {
    if (!bookViewportEl) return;
    bookViewportEl.classList.toggle('zooming', !animate);
    bookViewportEl.style.transform =
      `translate3d(${zoomX.toFixed(2)}px,${zoomY.toFixed(2)}px,0) scale(${zoomScale.toFixed(4)})`;
    readerEl.classList.toggle('zoomed', zoomScale > 1.01);

    if (animate) {
      window.setTimeout(() => {
        if (!pinchState && !panState) bookViewportEl.classList.add('zooming');
      }, 180);
    }
  }

  function resetBookZoom(animate = true) {
    zoomScale = 1;
    zoomX = 0;
    zoomY = 0;
    pinchState = null;
    panState = null;
    applyBookZoom(animate);
  }

  function startPinch(touches) {
    if (!bookViewportEl || touches.length < 2) return;
    const a = touches[0];
    const b = touches[1];
    const center = touchCenter(a, b);
    const viewportCenter = sceneCenter();

    pinchState = {
      distance: Math.max(1, touchDistance(a, b)),
      scale: zoomScale,
      localX: (center.x - viewportCenter.x - zoomX) / zoomScale,
      localY: (center.y - viewportCenter.y - zoomY) / zoomScale
    };
    panState = null;
    touchSequenceLocked = true;
    bookViewportEl.classList.add('zooming');
  }

  function setupTouchZoom() {
    if (!readerEl || !sceneEl || !bookViewportEl) return;

    readerEl.addEventListener('touchstart', (e) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        e.stopPropagation();
        hideHint();
        ensureMusic();
        startPinch(e.touches);
        return;
      }

      if (zoomScale > 1.01 && e.touches.length === 1) {
        e.preventDefault();
        e.stopPropagation();
        const t = e.touches[0];
        panState = {
          clientX: t.clientX,
          clientY: t.clientY,
          zoomX,
          zoomY
        };
        touchSequenceLocked = true;
        bookViewportEl.classList.add('zooming');
      }
    }, { passive: false, capture: true });

    readerEl.addEventListener('touchmove', (e) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        e.stopPropagation();

        if (!pinchState) startPinch(e.touches);
        if (!pinchState) return;

        const a = e.touches[0];
        const b = e.touches[1];
        const center = touchCenter(a, b);
        const viewportCenter = sceneCenter();
        const nextScale = clamp(
          pinchState.scale * (touchDistance(a, b) / pinchState.distance),
          ZOOM_MIN,
          ZOOM_MAX
        );

        zoomScale = nextScale;
        zoomX = center.x - viewportCenter.x - pinchState.localX * nextScale;
        zoomY = center.y - viewportCenter.y - pinchState.localY * nextScale;
        clampZoomPan();
        applyBookZoom(false);
        return;
      }

      if (zoomScale > 1.01 && panState && e.touches.length === 1) {
        e.preventDefault();
        e.stopPropagation();
        const t = e.touches[0];
        zoomX = panState.zoomX + (t.clientX - panState.clientX);
        zoomY = panState.zoomY + (t.clientY - panState.clientY);
        clampZoomPan();
        applyBookZoom(false);
        return;
      }

      if (touchSequenceLocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false, capture: true });

    const endTouchGesture = (e) => {
      if (touchSequenceLocked) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (e.touches.length >= 2) {
        startPinch(e.touches);
        return;
      }

      if (pinchState) {
        pinchState = null;
        if (zoomScale <= 1.04) {
          resetBookZoom(true);
        } else {
          clampZoomPan();
          applyBookZoom(true);
        }
      }

      if (zoomScale > 1.01 && e.touches.length === 1) {
        const t = e.touches[0];
        panState = {
          clientX: t.clientX,
          clientY: t.clientY,
          zoomX,
          zoomY
        };
      } else if (e.touches.length === 0) {
        panState = null;
        touchSequenceLocked = false;
        bookViewportEl.classList.remove('zooming');
      }
    };

    readerEl.addEventListener('touchend', endTouchGesture, { passive: false, capture: true });
    readerEl.addEventListener('touchcancel', (e) => {
      if (touchSequenceLocked) {
        e.preventDefault();
        e.stopPropagation();
      }
      pinchState = null;
      panState = null;
      touchSequenceLocked = false;
      clampZoomPan();
      applyBookZoom(true);
      bookViewportEl.classList.remove('zooming');
    }, { passive: false, capture: true });
  }

  function statusFor(index) {
    if (index <= 0) return 'Cover';
    if (index >= TOTAL - 1) return 'Back cover';
    const isLandscape = pageFlip && pageFlip.getOrientation && pageFlip.getOrientation() === 'landscape';
    if (isLandscape) {
      const left = index;
      const right = Math.min(TOTAL - 1, index + 1);
      return `${String(left + 1).padStart(2, '0')}–${String(right + 1).padStart(2, '0')} / ${TOTAL}`;
    }
    return `${String(index + 1).padStart(2, '0')} / ${TOTAL}`;
  }

  function updateStatus(index) {
    current = Math.max(0, Math.min(TOTAL - 1, Number(index) || 0));
    pageStatus.textContent = statusFor(current);
    prevBtn.disabled = current <= 0;
    nextBtn.disabled = current >= TOTAL - 1;
    for (let d = -2; d <= 4; d += 1) {
      const i = current + d;
      if (i < 0 || i >= TOTAL) continue;
      const im = new Image();
      im.decoding = 'async';
      im.src = pageUrl(i + 1);
    }
  }

  function init() {
    buildPages();
    ambientMusic.volume = 0;
    setAudioEnabled(true);

    if (!window.St || !window.St.PageFlip) {
      loadStatus.textContent = 'Could not load the page-turn engine. Please check your internet connection.';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    pageFlip = new window.St.PageFlip(bookEl, {
      width: 1200,
      height: 1200,
      size: 'stretch',
      minWidth: 260,
      maxWidth: 1200,
      minHeight: 260,
      maxHeight: 1200,
      drawShadow: true,
      maxShadowOpacity: 0.48,
      flippingTime: 1080,
      usePortrait: true,
      startZIndex: 10,
      autoSize: true,
      showCover: true,
      mobileScrollSupport: false,
      clickEventForward: false,
      useMouseEvents: true,
      swipeDistance: 34,
      showPageCorners: true,
      disableFlipByClick: true
    });

    pageFlip.on('init', (e) => {
      updateStatus(e.data.page);
      loadStatus.textContent = 'Ready';
      loadStatus.classList.add('ready');
    });

    pageFlip.on('flip', (e) => {
      hideHint();
      updateStatus(e.data);
      playPaper();
    });

    pageFlip.on('changeOrientation', () => updateStatus(pageFlip.getCurrentPageIndex()));
    pageFlip.on('changeState', (e) => {
      if (e.data === 'user_fold' || e.data === 'flipping') hideHint();
    });

    pageFlip.loadFromHTML(document.querySelectorAll('.page'));
    setupTouchZoom();

    bookEl.addEventListener('pointerdown', () => {
      hideHint();
      ensureMusic();
    }, { passive: true });

    prevBtn.addEventListener('click', () => {
      hideHint();
      ensureMusic();
      pageFlip.flipPrev('bottom');
    });
    nextBtn.addEventListener('click', () => {
      hideHint();
      ensureMusic();
      pageFlip.flipNext('bottom');
    });

    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => {
        hideHint();
        ensureMusic();
        toggleFullscreen();
      });
    }

    soundBtn.addEventListener('click', () => {
      setAudioEnabled(!audioEnabled);
    });

    bookEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        hideHint();
        ensureMusic();
        pageFlip.flipNext('bottom');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        hideHint();
        ensureMusic();
        pageFlip.flipPrev('bottom');
      }
    });

    syncFullscreenButton();
    window.addEventListener('resize', () => scheduleLayoutRefresh(100), { passive: true });
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => {
        clampZoomPan();
        applyBookZoom(true);
        scheduleLayoutRefresh(120);
      }, 220);
    }, { passive: true });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => scheduleLayoutRefresh(120), { passive: true });
    }

    document.addEventListener('fullscreenchange', () => {
      immersiveFallback = false;
      if (readerEl) readerEl.classList.remove('immersive-fallback');
      syncFullscreenButton();
      scheduleLayoutRefresh(140);
    });

    document.addEventListener('webkitfullscreenchange', () => {
      immersiveFallback = false;
      if (readerEl) readerEl.classList.remove('immersive-fallback');
      syncFullscreenButton();
      scheduleLayoutRefresh(140);
    });

    document.addEventListener('fullscreenerror', () => setFallbackFullscreen(true));
    document.addEventListener('webkitfullscreenerror', () => setFallbackFullscreen(true));

    updateStatus(0);
  }

  window.addEventListener('load', init, { once: true });
})();
