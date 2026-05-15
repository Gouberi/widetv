/* ===================================================
   WideTV — Video Player
   HLS.js + custom controls + progress tracking
   =================================================== */
const Player = (() => {
  let hls = null;
  let video = null;
  let currentItem = null;
  let nextEpisodeFn = null;
  let progressTimer = null;
  let hideTimer = null;
  let isDragging = false;
  let isFullscreen = false;

  const overlay  = () => document.getElementById('player-overlay');
  const playerUI = () => document.getElementById('player-ui');
  const ppBtn    = () => document.getElementById('pp-btn');

  /* ---------- Init ---------- */
  function init() {
    video = document.getElementById('video-el');
    _bindControls();
    _bindKeyboard();
  }

  /* ---------- Public: play item ---------- */
  function play(item, onNextEpisode) {
    currentItem  = item;
    nextEpisodeFn = onNextEpisode || null;

    overlay().classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    _showSpinner(true);
    _setTitle(item);
    _resetUI();

    // Destroy previous HLS instance
    if (hls) { hls.destroy(); hls = null; }
    video.src = '';

    const url = item.url;
    const isHLS = url.includes('.m3u8') || url.includes('m3u8') || item.isLive;

    if (typeof Hls !== 'undefined' && Hls.isSupported() && isHLS) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: !!item.isLive,
        backBufferLength: item.isLive ? 0 : 90,
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => _startPlay());
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) _handleError(data); });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      _startPlay();
    } else {
      video.src = url;
      _startPlay();
    }

    // Show/hide next-ep button
    const nextBtn = document.getElementById('next-episode-btn');
    if (nextEpisodeFn) nextBtn.classList.remove('hidden');
    else nextBtn.classList.add('hidden');
  }

  function _startPlay() {
    video.play().then(() => {
      _showSpinner(false);
      if (!currentItem.isLive) {
        const saved = Storage.getProgress(currentItem.id);
        if (saved && saved.position > 10 && saved.percent < 93) {
          _showResumePrompt(saved.position);
        }
      }
    }).catch(() => _showSpinner(false));
  }

  function _handleError(data) {
    _showSpinner(false);
    App.showToast(`Erro ao reproduzir: ${data.type || 'falha na conexão'}`, 'error');
  }

  /* ---------- Progress tracking ---------- */
  function _startTracking() {
    if (progressTimer) clearInterval(progressTimer);
    if (currentItem.isLive) return;

    progressTimer = setInterval(() => {
      if (!video.paused && video.duration && !isNaN(video.duration)) {
        Storage.saveProgress(currentItem.id, video.currentTime, video.duration, {
          name: currentItem.name,
          logo: currentItem.logo,
          type: currentItem.showName ? 'series' : 'movie',
          url: currentItem.url,
          showName: currentItem.showName || null,
          season: currentItem.season || null,
          episode: currentItem.episode || null,
          group: currentItem.group || '',
        });
        App.refreshContinueBadge();
      }
    }, 8000);
  }

  function _stopTracking() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  }

  /* ---------- Close player ---------- */
  function close() {
    _stopTracking();
    video.pause();
    if (hls) { hls.destroy(); hls = null; }
    video.src = '';
    overlay().classList.add('hidden');
    document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    isFullscreen = false;
    App.refreshAll();
  }

  /* ---------- Controls binding ---------- */
  function _bindControls() {
    // Play/Pause
    ppBtn().addEventListener('click', _togglePP);
    document.getElementById('player-mid').addEventListener('click', _onMidClick);

    // Rewind / Forward
    document.getElementById('rewind-btn').addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); _flashSeek('‹‹ 10s'); });
    document.getElementById('forward-btn').addEventListener('click', () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); _flashSeek('10s ››'); });

    // Volume
    document.getElementById('vol-btn').addEventListener('click', _toggleMute);
    document.getElementById('vol-slider').addEventListener('input', e => { video.volume = e.target.value; _updateVolIcon(); });

    // Fullscreen
    document.getElementById('fs-btn').addEventListener('click', _toggleFS);

    // PiP
    document.getElementById('pip-btn').addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch {}
    });

    // Back
    document.getElementById('player-back-btn').addEventListener('click', close);

    // Next episode
    document.getElementById('next-episode-btn').addEventListener('click', () => {
      if (nextEpisodeFn) nextEpisodeFn();
    });

    // Resume
    document.getElementById('resume-yes-btn').addEventListener('click', () => {
      const saved = Storage.getProgress(currentItem.id);
      if (saved) video.currentTime = saved.position;
      document.getElementById('resume-prompt').classList.add('hidden');
      video.play();
    });
    document.getElementById('resume-no-btn').addEventListener('click', () => {
      document.getElementById('resume-prompt').classList.add('hidden');
      video.currentTime = 0;
      video.play();
    });

    // Progress track
    const track = document.getElementById('progress-track');
    track.addEventListener('mousedown', e => { isDragging = true; _seekFromEvent(e); });
    track.addEventListener('mousemove', e => { if (isDragging) _seekFromEvent(e); });
    document.addEventListener('mouseup', () => { isDragging = false; });
    track.addEventListener('click', _seekFromEvent);

    // Video events
    video.addEventListener('play', () => { _setPPIcon(true); _startTracking(); _autoHideControls(); });
    video.addEventListener('pause', () => { _setPPIcon(false); _stopTracking(); _showControls(); });
    video.addEventListener('ended', _onEnded);
    video.addEventListener('waiting', () => _showSpinner(true));
    video.addEventListener('playing', () => _showSpinner(false));
    video.addEventListener('timeupdate', _updateProgress);
    video.addEventListener('progress', _updateBuffer);
    video.addEventListener('durationchange', () => {
      document.getElementById('dur-time').textContent = Storage.formatTime(video.duration);
    });
    video.addEventListener('volumechange', () => {
      document.getElementById('vol-slider').value = video.muted ? 0 : video.volume;
      _updateVolIcon();
    });

    // Fullscreen change
    document.addEventListener('fullscreenchange', () => {
      isFullscreen = !!document.fullscreenElement;
      document.querySelector('.icon-expand').classList.toggle('hidden', isFullscreen);
      document.querySelector('.icon-compress').classList.toggle('hidden', !isFullscreen);
    });

    // Auto-hide controls on mouse move
    overlay().addEventListener('mousemove', () => {
      _showControls();
      _autoHideControls();
    });
  }

  function _bindKeyboard() {
    document.addEventListener('keydown', e => {
      if (overlay().classList.contains('hidden')) return;
      switch(e.code) {
        case 'Space': case 'KeyK': e.preventDefault(); _togglePP(); break;
        case 'KeyF': _toggleFS(); break;
        case 'ArrowRight': video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); _flashSeek('10s ››'); break;
        case 'ArrowLeft': video.currentTime = Math.max(0, video.currentTime - 10); _flashSeek('‹‹ 10s'); break;
        case 'ArrowUp': video.volume = Math.min(1, video.volume + 0.1); break;
        case 'ArrowDown': video.volume = Math.max(0, video.volume - 0.1); break;
        case 'KeyM': _toggleMute(); break;
        case 'Escape': if (!document.fullscreenElement) close(); break;
      }
    });
  }

  /* ---------- Helpers ---------- */
  function _togglePP() {
    if (video.paused) video.play();
    else video.pause();
    _flashCenter();
  }

  function _onMidClick(e) {
    if (e.target.closest('#resume-prompt')) return;
    _togglePP();
  }

  function _flashCenter() {
    const btn = document.getElementById('play-center-btn');
    const icon = btn.querySelector('svg');
    // Update icon
    if (video.paused) {
      icon.innerHTML = '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>';
    } else {
      icon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>';
    }
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 500);
  }

  function _toggleMute() {
    video.muted = !video.muted;
    _updateVolIcon();
  }

  function _updateVolIcon() {
    const muted = video.muted || video.volume === 0;
    document.querySelector('.icon-vol').classList.toggle('hidden', muted);
    document.querySelector('.icon-mute').classList.toggle('hidden', !muted);
  }

  function _toggleFS() {
    if (!document.fullscreenElement) overlay().requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  function _setPPIcon(playing) {
    document.querySelector('#pp-btn .icon-play').classList.toggle('hidden', playing);
    document.querySelector('#pp-btn .icon-pause').classList.toggle('hidden', !playing);
  }

  function _showSpinner(show) {
    document.getElementById('player-spinner').classList.toggle('hidden', !show);
  }

  function _showResumePrompt(pos) {
    document.getElementById('resume-pos-text').textContent = `Você parou em ${Storage.formatTime(pos)}`;
    document.getElementById('resume-prompt').classList.remove('hidden');
    video.pause();
  }

  function _setTitle(item) {
    document.getElementById('player-title').textContent = item.showName || item.name;
    if (item.showName) {
      document.getElementById('player-subtitle').textContent = `T${item.season} · Ep ${item.episode} — ${item.name}`;
    } else {
      document.getElementById('player-subtitle').textContent = item.group || '';
    }
  }

  function _resetUI() {
    _setPPIcon(false);
    document.getElementById('cur-time').textContent = '0:00';
    document.getElementById('dur-time').textContent = '--:--';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-buf').style.width = '0%';
    document.getElementById('progress-thumb').style.left = '0%';
    document.getElementById('resume-prompt').classList.add('hidden');
  }

  function _updateProgress() {
    if (!video.duration || isNaN(video.duration)) return;
    const pct = (video.currentTime / video.duration) * 100;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-thumb').style.left = pct + '%';
    document.getElementById('cur-time').textContent = Storage.formatTime(video.currentTime);
  }

  function _updateBuffer() {
    if (!video.duration || !video.buffered.length) return;
    const pct = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100;
    document.getElementById('progress-buf').style.width = pct + '%';
  }

  function _seekFromEvent(e) {
    const track = document.getElementById('progress-track');
    const rect  = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (video.duration) video.currentTime = ratio * video.duration;
  }

  function _onEnded() {
    _stopTracking();
    if (currentItem && !currentItem.isLive) {
      Storage.removeProgress(currentItem.id);
    }
    if (nextEpisodeFn) {
      App.showToast('Reproduzindo próximo episódio...', 'info');
      setTimeout(nextEpisodeFn, 1200);
    }
    App.refreshContinueBadge();
  }

  function _showControls() {
    playerUI().classList.remove('hidden-controls');
  }

  function _autoHideControls() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!video.paused) playerUI().classList.add('hidden-controls');
    }, 3500);
  }

  function _flashSeek(text) {
    // small visual flash
    const btn = document.getElementById('play-center-btn');
    const icon = btn.querySelector('svg');
    icon.innerHTML = `<text x="12" y="16" text-anchor="middle" font-family="Inter" font-weight="700" font-size="7" fill="white">${text}</text>`;
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 400);
  }

  return { init, play, close };
})();
