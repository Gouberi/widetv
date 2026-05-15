/* ===================================================
   WideTV — Storage (localStorage manager)
   =================================================== */
const Storage = (() => {
  const KEYS = {
    PROGRESS: 'wtv_progress',
    M3U: 'wtv_m3u',
    CAT_CONFIG: 'wtv_cat_config',
  };

  function _get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function _set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  /* ---------- M3U Cache ---------- */
  function saveM3U(source, content, valid) {
    _set(KEYS.M3U, { source, content, savedAt: Date.now(), valid: !!valid });
  }

  function getM3U() {
    return _get(KEYS.M3U);
  }

  function clearM3U() {
    localStorage.removeItem(KEYS.M3U);
  }

  /* ---------- Progress ---------- */
  function getProgress(id) {
    const all = _get(KEYS.PROGRESS) || {};
    return all[id] || null;
  }

  function saveProgress(id, position, duration, meta) {
    const all = _get(KEYS.PROGRESS) || {};
    const percent = duration > 0 ? (position / duration) * 100 : 0;
    all[id] = {
      position: Math.floor(position),
      duration: Math.floor(duration),
      percent: Math.round(percent * 10) / 10,
      lastWatched: Date.now(),
      name: meta.name || '',
      logo: meta.logo || '',
      type: meta.type || 'movie',
      url: meta.url || '',
      showName: meta.showName || null,
      season: meta.season || null,
      episode: meta.episode || null,
      group: meta.group || '',
    };
    _set(KEYS.PROGRESS, all);
  }

  function removeProgress(id) {
    const all = _get(KEYS.PROGRESS) || {};
    delete all[id];
    _set(KEYS.PROGRESS, all);
  }

  function clearAllProgress() {
    localStorage.removeItem(KEYS.PROGRESS);
  }

  /* Returns items that are in progress (2% – 93%) sorted by recency */
  function getContinueWatching() {
    const all = _get(KEYS.PROGRESS) || {};
    return Object.entries(all)
      .filter(([, v]) => v.percent >= 2 && v.percent <= 93)
      .sort((a, b) => b[1].lastWatched - a[1].lastWatched)
      .map(([id, v]) => ({ id, ...v }));
  }

  function formatTime(secs) {
    if (!secs || isNaN(secs)) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /* ---------- Category Config ---------- */
  function saveCatConfig(config) { _set(KEYS.CAT_CONFIG, config); }
  function getCatConfig()        { return _get(KEYS.CAT_CONFIG) || {}; }
  function clearCatConfig()      { localStorage.removeItem(KEYS.CAT_CONFIG); }

  return { saveM3U, getM3U, clearM3U, getProgress, saveProgress, removeProgress, clearAllProgress, getContinueWatching, formatTime, saveCatConfig, getCatConfig, clearCatConfig };
})();
