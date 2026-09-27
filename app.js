(() => {
  'use strict';

  const TOTAL = 36;
  const MUSIC_VOLUME = 0.07; // deliberately low: the book remains the focus
  const PAPER_VOLUME = 0.14;

  const bookEl = document.getElementById('book');
  const pageStatus = document.getElementById('pageStatus');
  const loadStatus = document.getElementById('loadStatus');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const soundBtn = document.getElementById('soundBtn');
  const paperSound = document.getElementById('paperSound');
  const ambientMusic = document.getElementById('ambientMusic');
  const hint = document.getElementById('hint');

  let pageFlip = null;
  let current = 0;
  let audioEnabled = true;
  let musicStarted = false;
  let fadeFrame = 0;
  let hintHidden = false;

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
      // Browser autoplay rules can block audio until another user gesture.
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
      maxWidth: 1000,
      minHeight: 260,
      maxHeight: 1000,
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

    // Start the soundtrack only after a real user gesture; this complies with browser autoplay rules.
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

    updateStatus(0);
  }

  window.addEventListener('load', init, { once: true });
})();
