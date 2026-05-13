/* ===================================================
   WideTV — Main App Controller
   =================================================== */
const App = (() => {

  /* ===== STATE ===== */
  let data = { live: [], movies: [], series: [], categories: [] };
  let currentView = 'home';
  let currentSeries = null;
  let currentSeason = 1;
  let droppedFile = null;    // file stored from drag-and-drop
  let _rawM3UText = null;    // raw M3U text for re-parse after config change
  let _catConfigDraft = {};  // working draft inside config modal

  // Pagination state
  const PAGE = 60;
  const pages = { live: 0, movies: 0, series: 0 };
  const filtered = { live: [], movies: [], series: [] };

  /* ===== INIT ===== */
  function init() {
    Player.init();
    _bindSetup();
    _bindNav();
    _bindSearch();
    _bindSidebar();
    _bindSeriesModal();
    _bindContinue();
    _bindCatConfig();

    // Auto-load saved playlist (only if previously validated successfully)
    const saved = Storage.getM3U();
    if (saved && saved.content) {
      if (saved.valid) {
        _loadContent(saved.content, null, false);
      } else {
        // Cache exists but was never confirmed valid — discard it
        Storage.clearM3U();
      }
    }
  }

  /* ===================================================
     SETUP / LOADING
     =================================================== */
  function _bindSetup() {
    // Tab switcher
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      });
    });

    // Load URL
    document.getElementById('load-url-btn').addEventListener('click', _handleURLLoad);
    document.getElementById('m3u-url').addEventListener('keydown', e => { if (e.key === 'Enter') _handleURLLoad(); });

    // Load file
    const fileInput = document.getElementById('m3u-file-input');
    const dropZone  = document.getElementById('file-drop-zone');

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) {
        droppedFile = null;
        document.getElementById('file-name-display').textContent = file.name;
        document.getElementById('load-file-btn').disabled = false;
      }
    });

    dropZone.addEventListener('click', e => {
      // Don't trigger file picker if clicking the label (it already does that)
      if (e.target.tagName !== 'LABEL') fileInput.click();
    });
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) {
        droppedFile = file; // store directly — fileInput.files is read-only
        document.getElementById('file-name-display').textContent = file.name;
        document.getElementById('load-file-btn').disabled = false;
        // Auto-load on drop
        _readAndLoadFile(file);
      }
    });

    document.getElementById('load-file-btn').addEventListener('click', _handleFileLoad);

    // Load paste
    document.getElementById('load-paste-btn').addEventListener('click', () => {
      const content = document.getElementById('m3u-paste').value.trim();
      if (!content) { _showSetupError('Cole o conteúdo M3U no campo acima.'); return; }
      _loadContent(content, 'paste', true);
    });

    // Change list button (inside app)
    document.getElementById('change-list-btn').addEventListener('click', _showSetup);
  }

  async function _handleURLLoad() {
    let rawUrl = document.getElementById('m3u-url').value.trim();
    if (!rawUrl) { _showSetupError('Digite uma URL válida.'); return; }
    if (!rawUrl.startsWith('http')) { _showSetupError('A URL deve começar com http:// ou https://'); return; }

    const useProxy = document.getElementById('use-proxy').checked;
    const fetchUrl = useProxy ? `https://corsproxy.io/?${encodeURIComponent(rawUrl)}` : rawUrl;

    _showLoadingOverlay('Baixando lista M3U...');
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error(`O servidor retornou HTTP ${res.status}`);
      const text = await res.text();

      if (!text.includes('#EXTINF') && !text.includes('#EXTM3U')) {
        // Might be CORS redirect to HTML — suggest proxy
        throw new Error(
          'O conteúdo recebido não é um arquivo M3U. ' +
          (useProxy ? 'Verifique a URL.' : 'Tente ativar "Usar proxy CORS automático" ou use a opção Arquivo.')
        );
      }
      _loadContent(text, rawUrl, true);
    } catch (err) {
      _hideLoadingOverlay();
      const isCors = err.message.includes('Failed to fetch') || err.message.includes('NetworkError');
      _showSetupError(
        isCors
          ? 'Bloqueio CORS: ative "Usar proxy CORS automático" ou baixe o arquivo .m3u e use a aba "Arquivo".'
          : `Erro: ${err.message}`
      );
    }
  }

  function _handleFileLoad() {
    const file = droppedFile || document.getElementById('m3u-file-input').files[0];
    if (!file) { _showSetupError('Selecione ou arraste um arquivo M3U primeiro.'); return; }
    _readAndLoadFile(file);
  }

  function _readAndLoadFile(file) {
    _showLoadingOverlay('Lendo arquivo...');
    const reader = new FileReader();
    reader.onload = e => {
      let text = e.target.result;
      if (!text.includes('#EXTINF') && !text.includes('#EXTM3U')) {
        // Try again with Latin-1 encoding (common in Windows IPTV lists)
        const r2 = new FileReader();
        r2.onload = e2 => {
          const text2 = e2.target.result;
          if (!text2.includes('#EXTINF') && !text2.includes('#EXTM3U')) {
            _hideLoadingOverlay();
            _showSetupError('Arquivo inválido. Certifique-se que é um arquivo .m3u ou .m3u8.');
            return;
          }
          _loadContent(text2, file.name, true);
        };
        r2.onerror = () => { _hideLoadingOverlay(); _showSetupError('Erro ao ler o arquivo.'); };
        r2.readAsText(file, 'latin1');
        return;
      }
      _loadContent(text, file.name, true);
    };
    reader.onerror = () => { _hideLoadingOverlay(); _showSetupError('Erro ao ler o arquivo.'); };
    reader.readAsText(file, 'utf-8');
  }

  // source: URL string or filename (for caching); save: whether to persist to localStorage
  function _loadContent(m3uText, source, save) {
    _showLoadingOverlay('Analisando lista...');

    // Store raw text for re-parse when user changes cat config
    _rawM3UText = m3uText;

    setTimeout(() => {
      const catConfig = Storage.getCatConfig();
      let parsed;
      try {
        parsed = M3UParser.parse(m3uText, catConfig);
      } catch (err) {
        _hideLoadingOverlay();
        Storage.clearM3U();
        _showSetupError(`Erro ao interpretar a lista: ${err.message || err}`);
        console.error('[WideTV parser]', err);
        return;
      }

      data = parsed;
      const total = data.live.length + data.movies.length + data.series.length;
      if (total === 0) {
        _hideLoadingOverlay();
        Storage.clearM3U();
        _showSetupError('A lista foi lida mas não contém canais. Verifique o formato do arquivo.');
        return;
      }

      if (save && source) {
        Storage.saveM3U(source, m3uText, true);
      }

      _updateLoadingText(
        `${data.live.length} canais · ${data.movies.length} filmes · ${data.series.length} séries`
      );

      setTimeout(() => {
        try {
          _hideLoadingOverlay();
          _showApp();
          _renderAll();
          refreshContinueBadge();

          // Auto-open config if movies AND series are empty (categorization likely failed)
          if (data.movies.length === 0 && data.series.length === 0 && data.live.length > 0) {
            setTimeout(() => {
              showToast('Filmes e séries não detectados automaticamente. Configure as categorias!', 'info');
            }, 800);
          }
        } catch (renderErr) {
          console.error('[WideTV render]', renderErr);
        }
      }, 500);
    }, 80);
  }

  // Re-parse with current cat config (called after user saves config)
  function _reparse() {
    if (!_rawM3UText) return;
    _loadContent(_rawM3UText, null, false);
  }

  function _showLoadingOverlay(text) {
    document.getElementById('loading-text').textContent = text || 'Carregando...';
    document.getElementById('loading-sub').textContent = '';
    document.getElementById('loading-overlay').classList.remove('hidden');
  }

  function _updateLoadingText(sub) {
    document.getElementById('loading-sub').textContent = sub;
  }

  function _hideLoadingOverlay() {
    document.getElementById('loading-overlay').classList.add('hidden');
  }

  function _showSetupError(msg) {
    const el = document.getElementById('setup-error');
    document.getElementById('setup-error-text').textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 6000);
  }

  function _showSetup() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('setup-screen').style.display = 'flex';
    Storage.clearM3U();
    droppedFile = null;
    document.getElementById('file-name-display').textContent = 'Nenhum arquivo selecionado';
    document.getElementById('load-file-btn').disabled = true;
    document.getElementById('setup-error').classList.add('hidden');
  }

  function _showApp() {
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('app').classList.remove('hidden');
    // Ensure home view is active and visible on first load
    _navigate('home');
  }

  /* ===================================================
     RENDER
     =================================================== */
  function _renderAll() {
    _renderHome();
    _renderLiveView();
    _renderMoviesView();
    _renderSeriesView();
    _renderCategoriesView();
    _renderContinue();
  }

  /* ---------- HOME ---------- */
  function _renderHome() {
    // Hero
    const heroPool = [...data.movies, ...data.series].filter(i => i.logo);
    if (heroPool.length) {
      const item = heroPool[Math.floor(Math.random() * Math.min(heroPool.length, 30))];
      _setHero(item);
    }

    // Sections
    _renderRow('home-live-row', data.live.slice(0, 20), 'live');
    _renderRow('home-movies-row', data.movies.slice(0, 20), 'movie');
    _renderRow('home-series-row', data.series.slice(0, 20), 'series');

    // Show/hide sections
    _toggleSection('home-live-section', data.live.length > 0);
    _toggleSection('home-movies-section', data.movies.length > 0);
    _toggleSection('home-series-section', data.series.length > 0);

    // Row scroll buttons
    document.querySelectorAll('.row-scroll-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const rowId = btn.dataset.row + '-row';
        const row = document.getElementById(rowId);
        if (!row) return;
        const dir = btn.classList.contains('row-scroll-right') ? 1 : -1;
        row.scrollBy({ left: dir * 400, behavior: 'smooth' });
      });
    });

    // See all buttons
    document.querySelectorAll('.section-see-all').forEach(btn => {
      btn.addEventListener('click', () => _navigate(btn.dataset.view));
    });
  }

  function _setHero(item) {
    const bg = document.getElementById('hero-bg');
    bg.style.backgroundImage = item.logo ? `url(${item.logo})` : 'linear-gradient(135deg, #1565D4, #00C8E8)';
    document.getElementById('hero-title').textContent = item.showName || item.name || 'WideTV';
    document.getElementById('hero-desc').textContent = item.group ? `Categoria: ${item.group}` : 'Clique para assistir';
    document.getElementById('hero-badge').textContent = item.showName ? 'SÉRIE' : (item.isLive ? 'AO VIVO' : 'FILME');

    const heroItem = item.seasons ? { ...Object.values(item.seasons)[0][0], showName: item.name } : item;
    document.getElementById('hero-play-btn').onclick = () => _playItem(heroItem);
    document.getElementById('hero-info-btn').onclick = () => {
      if (item.seasons) _openSeriesModal(item);
    };
  }

  function _toggleSection(id, show) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
  }

  /* ---------- ROW ---------- */
  function _renderRow(containerId, items, type) {
    const row = document.getElementById(containerId);
    if (!row) return;
    row.innerHTML = '';
    items.forEach(item => row.appendChild(_createCard(item, type)));
  }

  /* ---------- LIVE VIEW ---------- */
  function _renderLiveView() {
    const empty = data.live.length === 0;
    document.getElementById('live-empty').classList.toggle('hidden', !empty);

    const groups = [...new Set(data.live.map(i => i.group).filter(Boolean))].sort();
    const sel = document.getElementById('live-group-filter');
    sel.innerHTML = '<option value="">Todos os Grupos</option>';
    groups.forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o); });
    sel.onchange = () => _filterAndRenderGrid('live');

    filtered.live = [...data.live];
    document.getElementById('live-count').textContent = `${data.live.length} canal${data.live.length !== 1 ? 'is' : ''}`;
    pages.live = 0;
    _renderGrid('live-grid', filtered.live, 'live', pages.live);
    _setupLoadMore('live');
  }

  /* ---------- MOVIES VIEW ---------- */
  function _renderMoviesView() {
    const empty = data.movies.length === 0;
    document.getElementById('movies-empty').classList.toggle('hidden', !empty);
    document.getElementById('movies-count').textContent = `${data.movies.length} filme${data.movies.length !== 1 ? 's' : ''}`;

    _buildCatSidebar('movies-cat-sidebar', data.movies, filterGroup => {
      filtered.movies = filterGroup ? data.movies.filter(i => i.group === filterGroup) : [...data.movies];
      pages.movies = 0;
      document.getElementById('movies-grid').innerHTML = '';
      _renderGrid('movies-grid', filtered.movies, 'movie', 0);
      const n = filtered.movies.length;
      document.getElementById('movies-count').textContent = filterGroup
        ? `${n} filme${n !== 1 ? 's' : ''} · ${filterGroup}`
        : `${n} filme${n !== 1 ? 's' : ''}`;
      const btn = document.getElementById('movies-load-more');
      if (btn) btn.classList.toggle('hidden', n <= PAGE);
    });

    filtered.movies = [...data.movies];
    pages.movies = 0;
    _renderGrid('movies-grid', filtered.movies, 'movie', 0);
    _setupLoadMore('movies');
  }

  /* ---------- SERIES VIEW ---------- */
  function _renderSeriesView() {
    const empty = data.series.length === 0;
    document.getElementById('series-empty').classList.toggle('hidden', !empty);
    document.getElementById('series-count').textContent = `${data.series.length} série${data.series.length !== 1 ? 's' : ''}`;

    _buildCatSidebar('series-cat-sidebar', data.series, filterGroup => {
      filtered.series = filterGroup ? data.series.filter(i => i.group === filterGroup) : [...data.series];
      pages.series = 0;
      document.getElementById('series-grid').innerHTML = '';
      _renderGrid('series-grid', filtered.series, 'series', 0);
      const n = filtered.series.length;
      document.getElementById('series-count').textContent = filterGroup
        ? `${n} série${n !== 1 ? 's' : ''} · ${filterGroup}`
        : `${n} série${n !== 1 ? 's' : ''}`;
      const btn = document.getElementById('series-load-more');
      if (btn) btn.classList.toggle('hidden', n <= PAGE);
    });

    filtered.series = [...data.series];
    pages.series = 0;
    _renderGrid('series-grid', filtered.series, 'series', 0);
    _setupLoadMore('series');
  }

  /* ---------- SIDEBAR CATEGORY BUILDER ---------- */
  function _buildCatSidebar(containerId, sourceItems, onFilter) {
    const sidebar = document.getElementById(containerId);
    if (!sidebar) return;
    sidebar.innerHTML = '<div class="cat-sidebar-header">GÊNEROS</div>';

    // Count per group
    const groupMap = {};
    sourceItems.forEach(item => {
      const g = item.group || 'Outros';
      groupMap[g] = (groupMap[g] || 0) + 1;
    });

    const setActive = activeEl => {
      sidebar.querySelectorAll('.cat-sidebar-item').forEach(i => i.classList.remove('active'));
      activeEl.classList.add('active');
    };

    // "Todos" item
    const allEl = _makeSidebarItem('Todos', sourceItems.length, true);
    allEl.addEventListener('click', () => { setActive(allEl); onFilter(null); });
    sidebar.appendChild(allEl);

    // Group items sorted alphabetically
    Object.entries(groupMap)
      .sort((a, b) => a[0].localeCompare(b[0], 'pt'))
      .forEach(([group, count]) => {
        const el = _makeSidebarItem(group, count, false);
        el.addEventListener('click', () => { setActive(el); onFilter(group); });
        sidebar.appendChild(el);
      });
  }

  function _makeSidebarItem(name, count, active) {
    const el = document.createElement('div');
    el.className = 'cat-sidebar-item' + (active ? ' active' : '');
    el.innerHTML = `<span class="cat-sidebar-name">${_esc(name)}</span><span class="cat-sidebar-count">${count}</span>`;
    return el;
  }

  /* ---------- GRID ---------- */
  function _renderGrid(containerId, items, type, page) {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    if (page === 0) grid.innerHTML = '';
    const slice = items.slice(page * PAGE, (page + 1) * PAGE);
    slice.forEach(item => grid.appendChild(_createCard(item, type)));
  }

  function _filterAndRenderGrid(category) {
    const filterVal = document.getElementById(`${category}-group-filter`).value;
    const source = category === 'live' ? data.live : category === 'movies' ? data.movies : data.series;
    filtered[category] = filterVal ? source.filter(i => i.group === filterVal) : [...source];
    pages[category] = 0;
    _renderGrid(`${category}-grid`, filtered[category], category === 'movies' ? 'movie' : category === 'live' ? 'live' : 'series', 0);
    const lmBtn = document.getElementById(`${category}-load-more`);
    if (lmBtn) lmBtn.classList.toggle('hidden', filtered[category].length <= PAGE);
  }

  function _setupLoadMore(category) {
    const btn = document.getElementById(`${category}-load-more`);
    if (!btn) return;
    const src = category === 'live' ? data.live : category === 'movies' ? data.movies : data.series;
    btn.classList.toggle('hidden', src.length <= PAGE);
    btn.onclick = () => {
      pages[category]++;
      const type = category === 'movies' ? 'movie' : category === 'live' ? 'live' : 'series';
      _renderGrid(`${category}-grid`, filtered[category], type, pages[category]);
      if ((pages[category] + 1) * PAGE >= filtered[category].length) btn.classList.add('hidden');
    };
  }

  /* ---------- CATEGORIES VIEW ---------- */
  let catFilter = 'all';
  let currentCatDetail = null;
  let catDetailPage = 0;

  function _renderCategoriesView() {
    const cats = data.categories || [];
    document.getElementById('categories-count').textContent =
      `${cats.length} categorias · ${data.live.length + data.movies.length + data.series.length} itens no total`;

    // Bind filter tabs (only once)
    document.querySelectorAll('.cat-tab').forEach(btn => {
      btn.onclick = () => {
        catFilter = btn.dataset.filter;
        document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _drawCategoryGrid();
      };
    });

    _drawCategoryGrid();
  }

  function _drawCategoryGrid() {
    const cats = (data.categories || []).filter(c => catFilter === 'all' || c.type === catFilter);
    const grid = document.getElementById('categories-grid');
    grid.innerHTML = '';
    cats.forEach(cat => grid.appendChild(_createCategoryCard(cat)));
  }

  function _createCategoryCard(cat) {
    const card = document.createElement('div');
    card.className = 'category-card';

    const typeLabel = cat.type === 'live' ? 'AO VIVO' : cat.type === 'movie' ? 'FILMES' : 'SÉRIES';
    const typeCls   = cat.type === 'live' ? 'type-live'  : cat.type === 'movie' ? 'type-movie' : 'type-series';
    const emoji     = cat.type === 'live' ? '📡' : cat.type === 'movie' ? '🎬' : '📺';

    // Mosaic: up to 4 logos
    const logos = cat.items.map(i => i.logo).filter(Boolean).slice(0, 4);
    let imgHtml = '';

    if (logos.length >= 4) {
      imgHtml = `<div class="category-card-mosaic">
        ${logos.map(l => `<img src="${_esc(l)}" onerror="this.style.display='none'" loading="lazy">`).join('')}
      </div>`;
    } else if (logos.length > 0) {
      imgHtml = `<div class="category-card-mosaic-single">
        <img src="${_esc(logos[0])}" onerror="this.style.display='none'" loading="lazy">
      </div>`;
    } else {
      imgHtml = `<div class="category-card-no-img">${emoji}</div>`;
    }

    card.innerHTML = `
      ${imgHtml}
      <div class="category-card-overlay"></div>
      <div class="category-card-body">
        <div class="category-card-name">${_esc(cat.name)}</div>
        <div class="category-card-meta">
          <span class="category-card-count">${cat.items.length} item${cat.items.length !== 1 ? 's' : ''}</span>
          <span class="category-card-type ${typeCls}">${typeLabel}</span>
        </div>
      </div>`;

    card.addEventListener('click', () => _openCategoryDetail(cat));
    return card;
  }

  function _openCategoryDetail(cat) {
    currentCatDetail = cat;
    catDetailPage = 0;

    document.getElementById('cat-detail-title').textContent = cat.name;
    document.getElementById('cat-detail-count').textContent =
      `${cat.items.length} item${cat.items.length !== 1 ? 's' : ''}`;

    const grid = document.getElementById('cat-detail-grid');
    grid.innerHTML = '';

    _renderCatDetailPage();
    _navigate('category-detail');
  }

  function _renderCatDetailPage() {
    if (!currentCatDetail) return;
    const { items, type } = currentCatDetail;
    const cardType = type === 'live' ? 'live' : type === 'movie' ? 'movie' : 'series';
    const slice = items.slice(catDetailPage * PAGE, (catDetailPage + 1) * PAGE);
    const grid = document.getElementById('cat-detail-grid');
    slice.forEach(item => grid.appendChild(_createCard(item, cardType)));

    const lmBtn = document.getElementById('cat-detail-load-more');
    lmBtn.classList.toggle('hidden', (catDetailPage + 1) * PAGE >= items.length);
    lmBtn.onclick = () => { catDetailPage++; _renderCatDetailPage(); };
  }

  /* ---------- CONTINUE WATCHING ---------- */
  function _renderContinue() {
    const items = Storage.getContinueWatching();
    document.getElementById('continue-count-sub').textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'}`;

    const grid = document.getElementById('continue-grid');
    const homeRow = document.getElementById('home-continue-row');
    grid.innerHTML = '';
    if (homeRow) homeRow.innerHTML = '';

    if (items.length === 0) {
      document.getElementById('continue-empty').classList.remove('hidden');
      _toggleSection('home-continue-section', false);
      document.getElementById('continue-badge').style.display = 'none';
    } else {
      document.getElementById('continue-empty').classList.add('hidden');
      _toggleSection('home-continue-section', true);
      document.getElementById('continue-badge').style.display = '';
      document.getElementById('continue-badge').textContent = items.length;

      items.forEach(item => {
        grid.appendChild(_createContinueCard(item));
        if (homeRow) homeRow.appendChild(_createContinueCard(item));
      });
    }
  }

  function _bindContinue() {
    document.getElementById('clear-history-btn').addEventListener('click', () => {
      if (confirm('Limpar todo o histórico de continue assistindo?')) {
        Storage.clearAllProgress();
        _renderContinue();
        showToast('Histórico limpo', 'success');
      }
    });
  }

  /* ===================================================
     CATEGORY CONFIGURATOR
     =================================================== */
  function _bindCatConfig() {
    // Configurar accessible from the Categories page only
    ['open-cat-config-cats']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', _openCatConfig);
      });

    document.getElementById('cat-config-close').addEventListener('click', _closeCatConfig);
    document.getElementById('cat-config-cancel').addEventListener('click', _closeCatConfig);
    document.getElementById('cat-config-backdrop').addEventListener('click', _closeCatConfig);
    document.getElementById('cat-config-save').addEventListener('click', _saveCatConfig);

    // Search filter
    document.getElementById('cat-config-search-input').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.cat-config-row').forEach(row => {
        row.style.display = row.dataset.group.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  function _openCatConfig() {
    // Collect ALL unique groups from the entire parsed data (live + movies + series raw)
    const groupMap = {};

    const addItems = (items, defaultType) => {
      for (const item of items) {
        const g = item.group || '(Sem grupo)';
        if (!groupMap[g]) groupMap[g] = { name: g, count: 0, logo: '', type: defaultType };
        groupMap[g].count++;
        if (!groupMap[g].logo && item.logo) groupMap[g].logo = item.logo;
      }
    };

    addItems(data.live,   'live');
    addItems(data.movies, 'movie');

    // For series, use episode items
    for (const show of data.series) {
      const g = show.group || '(Sem grupo)';
      if (!groupMap[g]) groupMap[g] = { name: g, count: 0, logo: '', type: 'series' };
      const epCount = Object.values(show.seasons).reduce((s, e) => s + e.length, 0);
      groupMap[g].count += epCount;
      if (!groupMap[g].logo && show.logo) groupMap[g].logo = show.logo;
    }

    // Apply saved config overrides
    const saved = Storage.getCatConfig();
    for (const [g, t] of Object.entries(saved)) {
      if (groupMap[g]) groupMap[g].type = t;
    }

    _catConfigDraft = {};
    for (const [g, info] of Object.entries(groupMap)) {
      _catConfigDraft[g] = info.type;
    }

    // Render rows
    const list = document.getElementById('cat-config-list');
    list.innerHTML = '';
    document.getElementById('cat-config-search-input').value = '';

    Object.values(groupMap)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'))
      .forEach(info => {
        list.appendChild(_createCatConfigRow(info));
      });

    document.getElementById('cat-config-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function _createCatConfigRow(info) {
    const row = document.createElement('div');
    row.className = 'cat-config-row';
    row.dataset.group = info.name;

    const typeLabels = { live: 'AO VIVO', movie: 'FILMES', series: 'SÉRIES' };
    const typeCls    = { live: 'type-live', movie: 'type-movie', series: 'type-series' };
    let curType = _catConfigDraft[info.name] || 'live';

    const logoHtml = info.logo
      ? `<img class="cat-config-logo" src="${_esc(info.logo)}" onerror="this.style.display='none'" loading="lazy">`
      : `<div class="cat-config-logo" style="display:flex;align-items:center;justify-content:center;font-size:0.9rem">📡</div>`;

    row.innerHTML = `
      ${logoHtml}
      <div class="cat-config-name">${_esc(info.name)}</div>
      <div class="cat-config-count">${info.count} itens</div>
      <button class="cat-config-type-btn ${typeCls[curType]}">${typeLabels[curType]}</button>`;

    const typeBtn = row.querySelector('.cat-config-type-btn');
    const cycle   = ['live', 'movie', 'series'];

    typeBtn.addEventListener('click', e => {
      e.stopPropagation();
      const next = cycle[(cycle.indexOf(curType) + 1) % cycle.length];
      curType = next;
      _catConfigDraft[info.name] = next;
      typeBtn.className = `cat-config-type-btn ${typeCls[next]}`;
      typeBtn.textContent = typeLabels[next];
    });

    row.addEventListener('click', () => typeBtn.click());

    return row;
  }

  function _closeCatConfig() {
    document.getElementById('cat-config-modal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function _saveCatConfig() {
    Storage.saveCatConfig(_catConfigDraft);
    _closeCatConfig();
    showToast('Categorias salvas! Recarregando conteúdo...', 'success');
    setTimeout(_reparse, 400);
  }

  /* ===================================================
     CARD FACTORY
     =================================================== */
  function _createCard(item, type) {
    const card = document.createElement('div');

    if (type === 'live') {
      card.className = 'card card-live';
      const logo = item.logo
        ? `<img class="card-live-logo" src="${_esc(item.logo)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="">`
        : '';
      const fallback = `<div class="no-logo" style="width:64px;height:40px;font-size:1rem">${(item.name||'?').slice(0,2).toUpperCase()}</div>`;
      card.innerHTML = `
        ${logo}${fallback}
        <div class="card-live-name">${_esc(item.name)}</div>
        <span class="card-live-badge">AO VIVO</span>
        <div class="card-play-overlay">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>`;
      if (!item.logo) card.querySelector('.no-logo').style.display = 'flex';
      else card.querySelector('.no-logo').style.display = 'none';
      card.addEventListener('click', () => _playItem({ ...item, isLive: true }));

    } else if (type === 'movie') {
      card.className = 'card card-poster';
      const saved = Storage.getProgress(item.id);
      const progressBar = saved && saved.percent > 2
        ? `<div class="card-progress"><div class="card-progress-fill" style="width:${saved.percent}%"></div></div>`
        : '';
      card.innerHTML = `
        <img src="${_esc(item.logo || '')}" alt="${_esc(item.name)}" loading="lazy"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22240%22><rect fill=%22%23101929%22 width=%22160%22 height=%22240%22/><text x=%2280%22 y=%22120%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-family=%22sans-serif%22 fill=%22%235a7090%22 font-size=%2240%22>🎬</text></svg>'">
        <div class="card-poster-info">
          <div class="card-poster-name">${_esc(item.name)}</div>
          ${item.group ? `<div class="card-poster-group">${_esc(item.group)}</div>` : ''}
        </div>
        <div class="card-play-overlay">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
        ${progressBar}`;
      card.addEventListener('click', () => _playItem(item));

    } else if (type === 'series') {
      card.className = 'card card-poster';
      const seasonCount = Object.keys(item.seasons || {}).length;
      const epCount = Object.values(item.seasons || {}).reduce((s, eps) => s + eps.length, 0);
      card.innerHTML = `
        <img src="${_esc(item.logo || '')}" alt="${_esc(item.name)}" loading="lazy"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22240%22><rect fill=%22%23101929%22 width=%22160%22 height=%22240%22/><text x=%2280%22 y=%22110%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-family=%22sans-serif%22 fill=%22%235a7090%22 font-size=%2240%22>📺</text></svg>'">
        <div class="card-poster-info">
          <div class="card-poster-name">${_esc(item.name)}</div>
          <div class="card-poster-group">${seasonCount} temp · ${epCount} ep</div>
        </div>
        <div class="card-play-overlay">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>`;
      card.addEventListener('click', () => _openSeriesModal(item));
    }

    return card;
  }

  function _createContinueCard(item) {
    const card = document.createElement('div');
    card.className = 'card card-poster';
    const logo = item.logo || '';
    card.innerHTML = `
      <img src="${_esc(logo)}" alt="${_esc(item.name)}" loading="lazy"
        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22300%22><rect fill=%22%23101929%22 width=%22200%22 height=%22300%22/><text x=%22100%22 y=%22150%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-family=%22sans-serif%22 fill=%22%235a7090%22 font-size=%2250%22>▶</text></svg>'">
      <div class="card-continue-label">${item.showName ? 'SÉRIE' : 'FILME'}</div>
      <div class="card-poster-info">
        <div class="card-poster-name">${_esc(item.showName || item.name)}</div>
        ${item.season ? `<div class="card-poster-group">T${item.season} · Ep ${item.episode}</div>` : ''}
      </div>
      <div class="card-play-overlay">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>
      <div class="card-progress"><div class="card-progress-fill" style="width:${item.percent || 0}%"></div></div>`;
    card.addEventListener('click', () => _playItem({ ...item, isLive: false }));
    return card;
  }

  /* ===================================================
     SERIES MODAL
     =================================================== */
  function _openSeriesModal(show) {
    currentSeries = show;
    const seasonNums = Object.keys(show.seasons).map(Number).sort((a, b) => a - b);
    currentSeason = seasonNums[0];

    document.getElementById('modal-poster').src = show.logo || '';
    document.getElementById('modal-title').textContent = show.name;

    const totalEps = Object.values(show.seasons).reduce((s, e) => s + e.length, 0);
    document.getElementById('modal-meta').innerHTML =
      `<span>${seasonNums.length} temporada${seasonNums.length > 1 ? 's' : ''}</span><span>${totalEps} episódios</span>`;

    // Season tabs
    const tabs = document.getElementById('season-tabs');
    tabs.innerHTML = '';
    seasonNums.forEach(n => {
      const btn = document.createElement('button');
      btn.className = 'season-tab' + (n === currentSeason ? ' active' : '');
      btn.textContent = `Temporada ${n}`;
      btn.addEventListener('click', () => {
        currentSeason = n;
        tabs.querySelectorAll('.season-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _renderEpisodes();
      });
      tabs.appendChild(btn);
    });

    _renderEpisodes();
    document.getElementById('series-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function _renderEpisodes() {
    const episodes = (currentSeries.seasons[currentSeason] || []);
    const list = document.getElementById('episodes-list');
    list.innerHTML = '';

    episodes.forEach(ep => {
      const saved = Storage.getProgress(ep.id);
      const pct = saved ? saved.percent : 0;

      const item = document.createElement('div');
      item.className = 'episode-item';
      item.innerHTML = `
        <div class="episode-num">${ep.episode}</div>
        <div class="episode-info">
          <div class="episode-name">${_esc(ep.name)}</div>
          <div class="episode-meta">
            ${saved && pct > 2 ? `<span style="color:var(--cyan)">▶ ${Storage.formatTime(saved.position)} assistido</span>` : 'Episódio ' + ep.episode}
          </div>
        </div>
        <div class="episode-play">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
        ${pct > 2 ? `<div class="episode-progress" style="width:${pct}%"></div>` : ''}`;
      item.addEventListener('click', () => _playEpisode(ep));
      list.appendChild(item);
    });
  }

  function _playEpisode(ep) {
    document.getElementById('series-modal').classList.add('hidden');
    document.body.style.overflow = '';

    const allEps = Object.values(currentSeries.seasons)
      .flat()
      .sort((a, b) => a.season !== b.season ? a.season - b.season : a.episode - b.episode);

    const idx = allEps.findIndex(e => e.id === ep.id);

    const onNext = idx < allEps.length - 1 ? () => _playEpisode(allEps[idx + 1]) : null;

    Player.play({ ...ep, showName: currentSeries.name }, onNext);
  }

  function _bindSeriesModal() {
    document.getElementById('modal-close').addEventListener('click', _closeModal);
    document.getElementById('modal-backdrop').addEventListener('click', _closeModal);
  }

  function _closeModal() {
    document.getElementById('series-modal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  /* ===================================================
     PLAY ITEM (live / movie / direct episode)
     =================================================== */
  function _playItem(item) {
    if (!item.url) return;
    Player.play(item, null);
  }

  /* ===================================================
     NAVIGATION
     =================================================== */
  function _bindNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        _navigate(link.dataset.view);
      });
    });

    // Back button in category detail
    document.getElementById('cat-detail-back').addEventListener('click', () => {
      _navigate('categories');
    });
  }

  function _navigate(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const viewEl = document.getElementById(`view-${view}`);
    if (viewEl) {
      viewEl.classList.remove('hidden'); // remove hidden (has !important, overrides .view.active)
      viewEl.classList.add('active');
    }

    // For category-detail, keep 'categories' nav highlighted
    const navView = view === 'category-detail' ? 'categories' : view;
    const navEl = document.querySelector(`.nav-item[data-view="${navView}"]`);
    if (navEl) navEl.classList.add('active');

    if (view === 'continue') _renderContinue();
    if (view === 'search') document.getElementById('global-search').focus();

    // Scroll content to top on navigation
    const main = document.getElementById('main-content');
    if (main) main.scrollTo(0, 0);
  }

  /* ===================================================
     SIDEBAR TOGGLE
     =================================================== */
  function _bindSidebar() {
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      document.getElementById('app').classList.toggle('sidebar-collapsed');
      document.getElementById('sidebar').classList.toggle('collapsed');
    });
  }

  /* ===================================================
     SEARCH
     =================================================== */
  function _bindSearch() {
    const input = document.getElementById('global-search');
    const clearBtn = document.getElementById('search-clear');
    let searchTimer;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearBtn.classList.toggle('hidden', !q);
      if (q.length < 2) { if (currentView === 'search') _navigate('home'); return; }
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => _doSearch(q), 300);
    });

    input.addEventListener('focus', () => {
      if (input.value.trim().length >= 2) _navigate('search');
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.add('hidden');
      _navigate('home');
    });
  }

  /* ─── Search helpers ─────────────────────────────── */

  function _normSearch(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  // Split into meaningful tokens (letters/digits runs only)
  function _tokenize(s) {
    return _normSearch(s).match(/[a-z0-9]+/g) || [];
  }

  /**
   * Returns a relevance score for how well `rawQuery` matches `item`.
   *
   * Key rules:
   *  - Numeric / leading-zero queries (like "007") ONLY match when the
   *    number appears as a standalone token — never as a substring of a
   *    larger number ("2007" does NOT count as a "007" match).
   *  - Prefix / fuzzy matches score lower than exact word matches.
   *  - Score 0 means: exclude from results entirely.
   */
  function _scoreItem(rawQuery, item) {
    const q       = _normSearch(rawQuery);
    const qToks   = _tokenize(rawQuery);
    if (!q || !qToks.length) return 0;

    const title     = _normSearch(item.showName || item.name || '');
    const group     = _normSearch(item.group || '');
    const titleToks = _tokenize(title);
    if (!title) return 0;

    // ── Detect numeric/code query: digits only or leading zeros ("007", "1917") ──
    const isCode = /^0\d+$/.test(q) || /^\d{1,4}$/.test(q);

    let score = 0;

    // 1. Exact full title
    if (title === q) return 2000;

    // 2. Title STARTS with the full query followed by a separator or end
    if (new RegExp(`^${q}(\\s|:|\\-|\\.|$)`).test(title)) score += 600;

    // 3. All query tokens found as EXACT title tokens (word-boundary match)
    const exactHits = qToks.filter(qt => titleToks.includes(qt));
    const exactRatio = exactHits.length / qToks.length;
    score += exactRatio * 300;

    // 4. Prefix match (fuzzy – query token is prefix of a title token, min 2 chars)
    if (exactRatio < 1) {
      const prefixHits = qToks.filter(qt =>
        qt.length >= 2 && titleToks.some(tt => tt !== qt && tt.startsWith(qt))
      );
      score += (prefixHits.length / qToks.length) * 80;
    }

    // 5. Substring fallback (only for text queries, not numeric/code)
    if (score === 0) {
      if (isCode) {
        // Numeric/code query: ONLY match if appears as standalone token
        // → if it only appears inside a larger number (e.g., "007" in "2007"), exclude
        return titleToks.includes(q) ? 50 : 0;
      }
      // Regular text substring
      if (title.includes(q)) score += 25;
      else if (group.includes(q)) score += 8;
    }

    // 6. For code queries: if it didn't become a word-boundary match, ensure exclusion
    if (isCode && exactHits.length === 0 && !title.startsWith(q)) {
      // Only keep if "007" appears literally as a standalone token
      if (!titleToks.includes(q)) return 0;
    }

    return score;
  }

  function _doSearch(q) {
    _navigate('search');
    if (!q || q.trim().length < 1) return;

    const scored = [];

    const scan = (items, type) => {
      items.forEach(item => {
        const s = _scoreItem(q, item);
        if (s > 0) scored.push({ ...item, _type: type, _score: s });
      });
    };

    scan(data.live,   'live');
    scan(data.movies, 'movie');
    scan(data.series, 'series');

    // Sort by relevance score descending
    scored.sort((a, b) => b._score - a._score);

    document.getElementById('search-count').textContent =
      `${scored.length} resultado${scored.length !== 1 ? 's' : ''} para "${q}"`;

    const grid = document.getElementById('search-grid');
    grid.innerHTML = '';

    if (scored.length === 0) {
      document.getElementById('search-empty').classList.remove('hidden');
      return;
    }
    document.getElementById('search-empty').classList.add('hidden');
    scored.slice(0, 120).forEach(item => grid.appendChild(_createCard(item, item._type)));
  }

  /* ===================================================
     PUBLIC UTILS
     =================================================== */
  function refreshContinueBadge() {
    const items = Storage.getContinueWatching();
    const badge = document.getElementById('continue-badge');
    badge.style.display = items.length > 0 ? '' : 'none';
    badge.textContent = items.length;
  }

  function refreshAll() {
    if (currentView === 'continue') _renderContinue();
    else refreshContinueBadge();
  }

  function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : ''}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.25s ease forwards';
      setTimeout(() => toast.remove(), 260);
    }, 3500);
  }

  function _esc(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ===== Boot ===== */
  document.addEventListener('DOMContentLoaded', init);

  return { refreshContinueBadge, refreshAll, showToast };
})();
