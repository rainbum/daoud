(() => {
  'use strict';

  const TOTAL = 36;
  const MUSIC_VOLUME = 0.05; // softer background level
  const PAPER_VOLUME = 0.14;

  const readerEl = document.getElementById('reader');
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
    if (!audioEnabled) return;
    try {
      paperSound.pause();
      paperSound.currentTime = 0;
      paperSound.volume = PAPER_VOLUME;
      paperSound.playbackRate = 0.97 + Math.random() * 0.05;
      paperSound.play().catch(() => {});
    } catch (_) {}
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
    window.addEventListener('orientationchange', () => scheduleLayoutRefresh(220), { passive: true });

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
