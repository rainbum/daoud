(() => {
  'use strict';

  const TOTAL = 36;
  const MUSIC_VOLUME = 0.05; // softer background level
  const MUSIC_DUCK_VOLUME = 0.012;
  const PAPER_VOLUME = 0.58;
  const DAOUD_AUTO_DELAY = 3000;

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
  const daoudMessageBtn = document.getElementById('daoudMessageBtn');
  const downloadMessage = document.getElementById('downloadMessage');
  const paperSound = document.getElementById('paperSound');
  const ambientMusic = document.getElementById('ambientMusic');
  const daoudMessage = document.getElementById('daoudMessage');
  const hint = document.getElementById('hint');

  let pageFlip = null;
  let current = 0;
  let audioEnabled = true;
  let musicStarted = false;
  let fadeFrame = 0;
  let hintHidden = false;
  let layoutTimer = 0;
  let immersiveFallback = false;
  let zoomScale = 1;
  let zoomX = 0;
  let zoomY = 0;
  let pinchState = null;
  let panState = null;
  let touchSequenceLocked = false;
  let safariGestureState = null;
  let firstInteractionSeen = false;
  let autoMessageTimer = 0;
  let autoMessageConsumed = false;
  let messageHasPlayed = false;
  let messageWasPausedManually = false;
  let primingDaoudMessage = false;

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

  function playPaper() {
    if (!audioEnabled || (daoudMessage && !daoudMessage.paused && !daoudMessage.ended)) return;
    try {
      paperSound.pause();
      paperSound.currentTime = 0;
      paperSound.volume = PAPER_VOLUME;
      paperSound.playbackRate = 1;
      paperSound.play().catch(() => {});
    } catch (_) {}
  }

  function syncDaoudMessageButton() {
    if (!daoudMessageBtn || !daoudMessage) return;
    const playing = !daoudMessage.paused && !daoudMessage.ended;
    daoudMessageBtn.classList.toggle('is-playing', playing);
    daoudMessageBtn.setAttribute('aria-pressed', String(playing));

    if (playing) {
      daoudMessageBtn.textContent = '❚❚ Pause Daoud’s To Y’all';
      daoudMessageBtn.title = 'Pause Daoud’s message';
    } else if (daoudMessage.ended || (messageHasPlayed && daoudMessage.currentTime < 0.05)) {
      daoudMessageBtn.textContent = '↻ Replay Daoud’s To Y’all';
      daoudMessageBtn.title = 'Replay Daoud’s message';
    } else if (messageWasPausedManually && daoudMessage.currentTime > 0) {
      daoudMessageBtn.textContent = '▶ Resume Daoud’s To Y’all';
      daoudMessageBtn.title = 'Resume Daoud’s message';
    } else {
      daoudMessageBtn.textContent = '▶ Daoud’s To Y’all';
      daoudMessageBtn.title = 'Play Daoud’s message';
    }
  }

  function restoreMusicAfterMessage() {
    if (!audioEnabled || !musicStarted) return;
    ambientMusic.play().then(() => fadeMusic(MUSIC_VOLUME, 1200)).catch(() => {});
  }

  function duckMusicForMessage() {
    if (!audioEnabled || !musicStarted) return;
    fadeMusic(MUSIC_DUCK_VOLUME, 650);
  }

  function cancelAutoMessage() {
    if (autoMessageTimer) {
      clearTimeout(autoMessageTimer);
      autoMessageTimer = 0;
    }
    autoMessageConsumed = true;
  }

  function primeDaoudMessage() {
    if (!daoudMessage) return;
    const previousVolume = daoudMessage.volume;
    primingDaoudMessage = true;
    daoudMessage.volume = 0;
    try {
      const p = daoudMessage.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          daoudMessage.pause();
          daoudMessage.currentTime = 0;
          daoudMessage.volume = previousVolume || 1;
          primingDaoudMessage = false;
          syncDaoudMessageButton();
        }).catch(() => {
          daoudMessage.volume = previousVolume || 1;
          primingDaoudMessage = false;
        });
      } else {
        daoudMessage.pause();
        daoudMessage.currentTime = 0;
        daoudMessage.volume = previousVolume || 1;
        primingDaoudMessage = false;
      }
    } catch (_) {
      daoudMessage.volume = previousVolume || 1;
      primingDaoudMessage = false;
    }
  }

  function playDaoudMessage({ fromAuto = false, restart = false } = {}) {
    if (!daoudMessage) return;

    if (!fromAuto) cancelAutoMessage();

    if (restart || daoudMessage.ended) {
      try { daoudMessage.currentTime = 0; } catch (_) {}
    }

    daoudMessage.volume = 1;
    messageWasPausedManually = false;
    duckMusicForMessage();

    const p = daoudMessage.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        messageHasPlayed = true;
        syncDaoudMessageButton();
      }).catch(() => {
        restoreMusicAfterMessage();
        syncDaoudMessageButton();
      });
    } else {
      messageHasPlayed = true;
      syncDaoudMessageButton();
    }
  }

  function toggleDaoudMessage() {
    if (!daoudMessage) return;

    if (!daoudMessage.paused && !daoudMessage.ended) {
      daoudMessage.pause();
      messageWasPausedManually = true;
      restoreMusicAfterMessage();
      syncDaoudMessageButton();
      return;
    }

    const shouldRestart = daoudMessage.ended || (messageHasPlayed && daoudMessage.currentTime < 0.05);
    playDaoudMessage({ fromAuto: false, restart: shouldRestart });
  }

  function armDaoudAutoMessage() {
    if (firstInteractionSeen) return;
    firstInteractionSeen = true;

    ensureMusic();
    primeDaoudMessage();

    autoMessageTimer = window.setTimeout(() => {
      autoMessageTimer = 0;
      if (autoMessageConsumed || !daoudMessage) return;
      autoMessageConsumed = true;
      playDaoudMessage({ fromAuto: true, restart: true });
    }, DAOUD_AUTO_DELAY);
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
        const targetVolume = daoudMessage && !daoudMessage.paused && !daoudMessage.ended
          ? MUSIC_DUCK_VOLUME
          : MUSIC_VOLUME;
        ambientMusic.play().then(() => fadeMusic(targetVolume, 1500)).catch(() => {});
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

    // Safari/iOS exposes dedicated pinch gesture events. Handle them directly so
    // the book itself scales while the surrounding memorial UI stays fixed.
    readerEl.addEventListener('gesturestart', (e) => {
      if (!sceneEl.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      hideHint();
      ensureMusic();

      const viewportCenter = sceneCenter();
      const gx = Number.isFinite(e.clientX) ? e.clientX : viewportCenter.x;
      const gy = Number.isFinite(e.clientY) ? e.clientY : viewportCenter.y;

      safariGestureState = {
        scale: zoomScale,
        localX: (gx - viewportCenter.x - zoomX) / zoomScale,
        localY: (gy - viewportCenter.y - zoomY) / zoomScale
      };
      touchSequenceLocked = true;
      bookViewportEl.classList.add('zooming');
    }, { passive: false, capture: true });

    readerEl.addEventListener('gesturechange', (e) => {
      if (!safariGestureState || !sceneEl.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      const viewportCenter = sceneCenter();
      const gx = Number.isFinite(e.clientX) ? e.clientX : viewportCenter.x;
      const gy = Number.isFinite(e.clientY) ? e.clientY : viewportCenter.y;
      const nextScale = clamp(safariGestureState.scale * e.scale, ZOOM_MIN, ZOOM_MAX);

      zoomScale = nextScale;
      zoomX = gx - viewportCenter.x - safariGestureState.localX * nextScale;
      zoomY = gy - viewportCenter.y - safariGestureState.localY * nextScale;
      clampZoomPan();
      applyBookZoom(false);
    }, { passive: false, capture: true });

    readerEl.addEventListener('gestureend', (e) => {
      if (!safariGestureState) return;
      e.preventDefault();
      e.stopPropagation();
      safariGestureState = null;
      touchSequenceLocked = false;

      if (zoomScale <= 1.04) {
        resetBookZoom(true);
      } else {
        clampZoomPan();
        applyBookZoom(true);
      }
      bookViewportEl.classList.remove('zooming');
    }, { passive: false, capture: true });

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
    ambientMusic.preload = 'auto';
    ambientMusic.load();
    if (daoudMessage) {
      daoudMessage.volume = 1;
      daoudMessage.preload = 'auto';
      daoudMessage.load();
    }
    setAudioEnabled(true);
    syncDaoudMessageButton();

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
      armDaoudAutoMessage();
    }, { passive: true });

    prevBtn.addEventListener('click', () => {
      hideHint();
      ensureMusic();
      armDaoudAutoMessage();
      pageFlip.flipPrev('bottom');
    });
    nextBtn.addEventListener('click', () => {
      hideHint();
      ensureMusic();
      armDaoudAutoMessage();
      pageFlip.flipNext('bottom');
    });

    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => {
        hideHint();
        ensureMusic();
        armDaoudAutoMessage();
        toggleFullscreen();
      });
    }

    soundBtn.addEventListener('click', () => {
      armDaoudAutoMessage();
      setAudioEnabled(!audioEnabled);
    });

    if (daoudMessageBtn && daoudMessage) {
      daoudMessageBtn.addEventListener('click', () => {
        firstInteractionSeen = true;
        toggleDaoudMessage();
      });

      daoudMessage.addEventListener('play', () => {
        if (primingDaoudMessage) return;
        messageHasPlayed = true;
        duckMusicForMessage();
        syncDaoudMessageButton();
      });

      daoudMessage.addEventListener('pause', () => {
        if (primingDaoudMessage) return;
        if (!daoudMessage.ended) syncDaoudMessageButton();
      });

      daoudMessage.addEventListener('ended', () => {
        messageHasPlayed = true;
        messageWasPausedManually = false;
        try { daoudMessage.currentTime = 0; } catch (_) {}
        restoreMusicAfterMessage();
        syncDaoudMessageButton();
      });
    }

    if (downloadMessage) {
      downloadMessage.addEventListener('click', () => {
        firstInteractionSeen = true;
        cancelAutoMessage();
      });
    }

    document.addEventListener('pointerdown', armDaoudAutoMessage, { once: true, passive: true, capture: true });
    document.addEventListener('keydown', armDaoudAutoMessage, { once: true, capture: true });

    bookEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        hideHint();
        ensureMusic();
        armDaoudAutoMessage();
        pageFlip.flipNext('bottom');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        hideHint();
        ensureMusic();
        armDaoudAutoMessage();
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
