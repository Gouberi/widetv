/* ===================================================
   WideTV — M3U Parser v2
   Categorizes: live, movies, series + groups/categories
   =================================================== */
const M3UParser = (() => {

  const EPISODE_PATTERN = /[Ss](\d{1,3})\s*[Ee](\d{1,3})/;
  const SHOW_CLEAN      = /\s*[Ss]\d{1,3}\s*[Ee]\d{1,3}.*/;

  // Normalized (no accents) keyword sets
  const SERIES_KW = [
    'serie','series','seriado','temporada','season','novela','minisserie',
    'telenovela','animacao','animacoes','anime','cartoon','documentary',
    'documentario','docuseries','sitcom','reality','show','especial'
  ];
  const MOVIE_KW = [
    'filme','filmes','movie','movies','vod','cinema','lancamento',
    'lancamentos','pelicula','peliculas','estreia','estreias'
  ];
  const LIVE_KW = [
    'ao vivo','live','radio','noticias','news','esporte','sport',
    'futebol','infantil','kids','adulto','adult','xxx'
  ];

  /* ---------- Helpers ---------- */
  function norm(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip diacritics: é→e, ç→c, etc.
      .trim();
  }

  function slugify(str) {
    return norm(str).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  }

  function safeDecode(str) {
    try { return decodeURIComponent(str); } catch { return str; }
  }

  /* ---------- Parse #EXTINF line ---------- */
  function parseExtInf(line) {
    const item = { duration: -1, name: '', logo: '', group: '', tvgId: '', tvgName: '' };

    const dur = line.match(/#EXTINF:\s*(-?\d+)/);
    if (dur) item.duration = parseInt(dur[1]);

    // Support both double and single quotes for attribute values
    const attrMap = { 'tvg-id': 'tvgId', 'tvg-name': 'tvgName', 'tvg-logo': 'logo', 'group-title': 'group' };
    for (const [attr, key] of Object.entries(attrMap)) {
      const m = line.match(new RegExp(`${attr}=["']([^"']*)["']`, 'i'));
      if (m) item[key] = safeDecode(m[1]).trim();
    }

    // Display name is everything after the last comma
    const nameM = line.match(/,(.+)$/);
    if (nameM) item.name = nameM[1].trim();
    if (!item.name && item.tvgName) item.name = item.tvgName;

    return item;
  }

  /* ---------- Detect type ---------- */
  function detectType(item, groupFlags, catConfig) {
    // 0. Manual user configuration wins over everything
    if (catConfig && catConfig[item.group]) return catConfig[item.group];

    const n  = norm(item.name);
    const g  = norm(item.group);

    // 1. Episode pattern in name → series (strongest signal)
    if (EPISODE_PATTERN.test(item.name)) return 'series';

    // 2. If another item in the same group was already identified as series → series
    if (groupFlags[item.group] === 'series') return 'series';

    // 3. Keyword match in group title
    if (SERIES_KW.some(k => g.includes(k))) return 'series';
    if (MOVIE_KW.some(k => g.includes(k))) return 'movie';

    // 4. Live indicators in group
    if (LIVE_KW.some(k => g.includes(k))) return 'live';

    // 5. Duration clue
    if (item.duration > 0) return 'movie';
    if (groupFlags[item.group] === 'movie') return 'movie';

    return 'live';
  }

  /* ---------- First pass: flag groups that have episodes ---------- */
  function prepassGroupFlags(rawItems) {
    const flags = {};
    for (const item of rawItems) {
      if (EPISODE_PATTERN.test(item.name)) flags[item.group] = 'series';
    }
    return flags;
  }

  /* ---------- Episode processing ---------- */
  function processEpisode(item) {
    const m = EPISODE_PATTERN.exec(item.name);
    let showName = item.name.replace(SHOW_CLEAN, '').trim() || item.group || item.name;
    let season = 1, episode = 1;

    if (m) {
      season  = parseInt(m[1]);
      episode = parseInt(m[2]);
    }

    // Strip group prefix like "Séries | Breaking Bad" → "Breaking Bad"
    try {
      showName = showName.replace(/^[^|>]+[|>]\s*/, '').trim() || showName;
    } catch (_) {}

    return {
      ...item,
      showName: showName || item.name || 'Desconhecido',
      season,
      episode,
      id: `ep-${slugify(showName)}-s${season}e${episode}`,
    };
  }

  /* ---------- Group episodes into shows ---------- */
  function groupSeries(episodes) {
    const map = {};
    for (const ep of episodes) {
      const key = slugify(ep.showName);
      if (!key) continue;
      if (!map[key]) {
        map[key] = { id: `show-${key}`, name: ep.showName, logo: ep.logo, group: ep.group, seasons: {} };
      }
      const show = map[key];
      if (!show.logo && ep.logo) show.logo = ep.logo;
      if (!show.seasons[ep.season]) show.seasons[ep.season] = [];
      show.seasons[ep.season].push(ep);
    }

    for (const show of Object.values(map)) {
      for (const eps of Object.values(show.seasons)) {
        eps.sort((a, b) => a.episode - b.episode);
      }
    }

    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }

  /* ---------- Build categories map ---------- */
  function buildCategories(live, movies, series) {
    const map = {};

    const add = (type, items) => {
      for (const item of items) {
        const g = item.group || '(Sem categoria)';
        if (!map[g]) map[g] = { name: g, type, items: [], logo: '' };
        map[g].items.push(item);
        if (!map[g].logo && item.logo) map[g].logo = item.logo;
      }
    };

    add('live', live);
    add('movie', movies);

    // For series, use the show cards as items
    for (const show of series) {
      const g = show.group || '(Sem categoria)';
      if (!map[g]) map[g] = { name: g, type: 'series', items: [], logo: '' };
      map[g].items.push(show);
      if (!map[g].logo && show.logo) map[g].logo = show.logo;
    }

    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }

  /* ---------- Main parse ---------- */
  function parse(content, catConfig) {
    if (!content || typeof content !== 'string') throw new Error('Conteúdo vazio ou inválido');

    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    // First collect raw items
    const rawItems = [];
    let currentMeta = null;
    const URL_RE = /^(https?|rtmps?|rtsps?|udp|rtp|mmsh):\/\//i;

    for (let i = 0; i < lines.length; i++) {
      try {
        const line = lines[i].trim();
        if (!line || /^#EXTM3U|^#EXTVLCOPT|^#PLAYLIST/i.test(line)) continue;

        if (/^#EXTINF:/i.test(line)) {
          currentMeta = parseExtInf(line);
          continue;
        }

        if (URL_RE.test(line)) {
          if (currentMeta) {
            currentMeta.url = line;
            rawItems.push(currentMeta);
          } else {
            rawItems.push({ id: '', url: line, name: `Canal ${rawItems.length + 1}`, logo: '', group: '', duration: -1 });
          }
          currentMeta = null;
        }
      } catch (_) {
        currentMeta = null;
      }
    }

    // Pre-pass to mark groups that contain episodes
    const groupFlags = prepassGroupFlags(rawItems);

    const live = [], movies = [], rawEpisodes = [];

    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i];
      try {
        const type = detectType(item, groupFlags, catConfig);
        if (type === 'series') {
          rawEpisodes.push(processEpisode(item));
        } else if (type === 'movie') {
          item.id = `movie-${slugify(item.name)}-${movies.length}`;
          movies.push(item);
        } else {
          item.id = `live-${item.tvgId || slugify(item.name)}-${live.length}`;
          item.isLive = true;
          live.push(item);
        }
      } catch (_) {}
    }

    const series = groupSeries(rawEpisodes);
    const categories = buildCategories(live, movies, series);

    return { live, movies, series, categories };
  }

  return { parse };
})();
