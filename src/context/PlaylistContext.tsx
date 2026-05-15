import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  ReactNode,
} from 'react';
import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Channel {
  id: string;
  name: string;
  url: string;
  group: string;
  logo?: string;
  type: 'live' | 'movie' | 'series' | 'unknown';
  tvgId?: string;
}

export interface WatchProgress {
  channelId: string;
  position: number;
  duration: number;
  updatedAt: number;
}

export interface PlaylistSource {
  type: 'url' | 'text';
  value: string;
  loadedAt: number;
  channelCount: number;
}

interface PlaylistContextType {
  channels: Channel[];
  groups: string[];
  playlistSource: PlaylistSource | null;
  epgUrl: string | null;
  parseProgress: number;
  isLoaded: boolean;
  isLoading: boolean;
  loadError: string | null;
  categoryMap: Record<string, 'live' | 'movie' | 'series'>;
  watchHistory: Record<string, WatchProgress>;
  loadFromUrl: (url: string, useProxy?: boolean) => Promise<void>;
  loadFromText: (text: string) => Promise<void>;
  clearPlaylist: () => Promise<void>;
  setCategoryType: (group: string, type: 'live' | 'movie' | 'series') => void;
  saveCategoryMap: () => Promise<void>;
  saveProgress: (channelId: string, position: number, duration: number) => void;
  getProgress: (channelId: string) => WatchProgress | null;
  clearHistory: () => Promise<void>;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────
const SK = {
  SOURCE:    '@widetv_playlist_source',
  CAT_MAP:   '@widetv_category_map',
  HISTORY:   '@widetv_watch_history',
  CACHE_META: '@widetv_meta_v3',
  ETAG:      '@widetv_etag',
};
const CACHE_CHUNK_KEY = (i: number) => `@widetv_ch_${i}`;

// Performance constants
const CACHE_TTL_MS    = 6 * 60 * 60 * 1000; // 6 horas
const PARSE_YIELD_LNS = 2000;               // linhas entre cada yield ao event loop

// ─── Normalize ────────────────────────────────────────────────────────────────
const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ─── Nome: última vírgula fora de aspas ───────────────────────────────────────
function extractName(line: string): string {
  let inQuote = false;
  let lastComma = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    if (line[i] === ',' && !inQuote) lastComma = i;
  }
  return lastComma >= 0 ? line.slice(lastComma + 1).trim() : '';
}

// ─── Tipo por prefixo do grupo ────────────────────────────────────────────────
function detectType(group: string): Channel['type'] {
  const g = normalize(group);
  if (g.startsWith('filme') || g.startsWith('film')) return 'movie';
  if (g.startsWith('serie') || g.startsWith('ser ') || g.startsWith('season')) return 'series';
  if (g.startsWith('cana') || g.startsWith('tv |') || g.startsWith('live ') || g.startsWith('canal ')) return 'live';
  if (g.includes('vivo') || g.includes(' live') || g.includes('news') ||
      g.includes('sport') || g.includes('esport') || g.includes('radio') ||
      g.includes('tv ')) return 'live';
  if (g.includes('film') || g.includes('movie') || g.includes('cine') ||
      g.includes('lanca') || g.includes('acao') || g.includes('comedia') ||
      g.includes('drama') || g.includes('terror') || g.includes('document') ||
      g.includes('animac') || g.includes('faroeste') || g.includes('classico') ||
      g.includes('familia') || g.includes('fantasia') || g.includes('guerra') ||
      g.includes('crime') || g.includes('romance')) return 'movie';
  // 'show' removido: keyword genérico demais (matcheia grupos de música como "Shows")
  if (g.includes('serie') || g.includes('series') ||
      g.includes('temporada') || g.includes('episod') || g.includes('novela')) return 'series';
  return 'unknown';
}

// ─── Parser M3U: parse completo, yield periódico, SEM setChannels intermediário ──
// onProgress: apenas % de conclusão (não os canais) — evita re-renders durante parse
// Cap por tipo: evita OOM quando a playlist tem centenas de milhares de itens mal-classificados
const TYPE_CAPS: Record<string, number> = {
  live:    10_000,
  movie:   30_000,
  series:  30_000,
  unknown:  5_000,
};

async function parseM3UFull(
  text: string,
  onEpgUrl?: (url: string) => void,
  onProgress?: (pct: number) => void,
): Promise<Channel[]> {
  const lines = text.split('\n');
  const totalLines = lines.length;
  const all: Channel[] = [];
  const typeCnt: Record<string, number> = { live: 0, movie: 0, series: 0, unknown: 0 };
  let current: Partial<Channel> | null = null;
  let idx = 0;
  let epgExtracted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (!epgExtracted && line.startsWith('#EXTM3U')) {
      epgExtracted = true;
      const m = line.match(/(?:url-tvg|x-tvg-url)="([^"]+)"/i);
      if (m?.[1]) onEpgUrl?.(m[1].trim());
    }

    if (line.startsWith('#EXTINF')) {
      const name = extractName(line);
      const gm = line.match(/group-title="([^"]*)"/i);
      const lm = line.match(/tvg-logo="([^"]*)"/i);
      const group = gm ? gm[1].trim() : 'Sem Categoria';
      current = {
        id: `ch_${idx++}`,
        name: name || 'Canal sem nome',
        group,
        logo: lm?.[1] || undefined,
        type: detectType(group),
        tvgId: line.match(/tvg-id="([^"]*)"/i)?.[1]?.trim() || undefined,
      };
    } else if (/^(https?|rtmp|rtsp|rtp)/.test(line)) {
      if (current) {
        const t = (current.type ?? 'unknown') as string;
        const cap = TYPE_CAPS[t] ?? 5_000;
        if ((typeCnt[t] ?? 0) < cap) {
          all.push({ ...current, url: line } as Channel);
          typeCnt[t] = (typeCnt[t] ?? 0) + 1;
        }
        current = null;
      }
    }

    // Yield ao event loop a cada PARSE_YIELD_LNS linhas
    if (i > 0 && i % PARSE_YIELD_LNS === 0) {
      onProgress?.(Math.min(99, Math.round((i / totalLines) * 100)));
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  onProgress?.(100);
  return all;
}

// ─── Cache leve proporcional (cold-start only) ────────────────────────────────
// Guarda amostra de CADA tipo (live, movie, series) para que todas as abas
// mostrem conteúdo imediatamente, mesmo antes do re-fetch completar.
// SQLite/AsyncStorage: ~500 por tipo × 3 = 1500 itens ≈ 450KB, seguro.
const PER_TYPE_LIMIT = 500;

function buildCacheSample(channels: Channel[]): Channel[] {
  const live: Channel[] = [];
  const movie: Channel[] = [];
  const series: Channel[] = [];
  const other: Channel[] = [];

  for (const ch of channels) {
    if ((ch.type === 'live' || ch.type === 'unknown') && live.length < PER_TYPE_LIMIT) live.push(ch);
    else if (ch.type === 'movie' && movie.length < PER_TYPE_LIMIT) movie.push(ch);
    else if (ch.type === 'series' && series.length < PER_TYPE_LIMIT) series.push(ch);
    else if (other.length < 100) other.push(ch);
    if (live.length >= PER_TYPE_LIMIT && movie.length >= PER_TYPE_LIMIT && series.length >= PER_TYPE_LIMIT) break;
  }

  return [...live, ...movie, ...series, ...other];
}

interface CacheResult {
  channels: Channel[];
  meta: { total: number; fetchedAt: number; sourceUrl: string; isSample: boolean };
  isFresh: boolean;
}

async function saveFullCache(channels: Channel[], sourceUrl: string): Promise<void> {
  try {
    const sample = buildCacheSample(channels);
    const isSample = sample.length < channels.length;
    const meta = { total: channels.length, fetchedAt: Date.now(), sourceUrl, isSample };
    await Promise.all([
      AsyncStorage.setItem(CACHE_CHUNK_KEY(0), JSON.stringify(sample)),
      AsyncStorage.setItem(SK.CACHE_META, JSON.stringify(meta)),
    ]);
  } catch (e) {
    console.warn('saveFullCache: storage full, salvando apenas metadados', e);
    try {
      await AsyncStorage.setItem(
        SK.CACHE_META,
        JSON.stringify({ total: channels.length, fetchedAt: Date.now(), sourceUrl, isSample: true }),
      );
    } catch (_) {}
  }
}

async function loadFullCache(): Promise<CacheResult | null> {
  const metaRaw = await AsyncStorage.getItem(SK.CACHE_META);
  if (!metaRaw) return null;

  const meta = JSON.parse(metaRaw);
  const chunkRaw = await AsyncStorage.getItem(CACHE_CHUNK_KEY(0));
  const channels: Channel[] = chunkRaw ? (JSON.parse(chunkRaw) as Channel[]) : [];

  if (channels.length === 0 && !meta.total) return null;

  return {
    channels,
    meta,
    // isSample === false (explícito) = cache completo → respeita TTL
    // isSample === true ou undefined (cache antigo) = força re-fetch sempre
    isFresh: meta.isSample === false && Date.now() - meta.fetchedAt < CACHE_TTL_MS,
  };
}

// ─── Fetch com ETag (evita download desnecessário) ────────────────────────────
interface FetchResult { text: string }

// skipEtag=true quando o cache é amostra parcial — precisamos do conteúdo completo,
// então ignoramos o ETag para não receber um 304 sem os dados que faltam
async function fetchPlaylist(url: string, skipEtag = false): Promise<FetchResult | null> {
  const headers: Record<string, string> = { 'User-Agent': 'WideTV/1.0' };

  if (!skipEtag) {
    const storedEtag = await AsyncStorage.getItem(SK.ETAG).catch(() => null);
    if (storedEtag) {
      headers['If-None-Match'] = storedEtag;
      headers['If-Modified-Since'] = storedEtag;
    }
  }

  const res = await fetch(url, { headers });

  // 304 Not Modified — só aceitamos 304 quando skipEtag=false (cache completo)
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();

  const etag = res.headers.get('etag') || res.headers.get('last-modified') || '';
  if (etag) AsyncStorage.setItem(SK.ETAG, etag).catch(() => {});

  return { text };
}

// ─── Context ──────────────────────────────────────────────────────────────────
const PlaylistContext = createContext<PlaylistContextType | null>(null);

export function PlaylistProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [playlistSource, setPlaylistSource] = useState<PlaylistSource | null>(null);
  const [epgUrl, setEpgUrl] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryMap, setCategoryMap] = useState<Record<string, 'live' | 'movie' | 'series'>>({});
  const [watchHistory, setWatchHistory] = useState<Record<string, WatchProgress>>({});

  // useMemo para groups — não recalcula a cada render do Provider
  const groups = useMemo(
    () => Array.from(new Set(channels.map(c => c.group))).sort(),
    [channels],
  );

  useEffect(() => { restoreSession(); }, []);

  // ── Background refresh: parse completo, setChannels APENAS 1x ao final ──────
  // reportProgress=true apenas quando não há cache (splash precisa mostrar progresso)
  // skipEtag=true → não manda If-None-Match (cache parcial ou ausente)
  // reportProgress=true → atualiza barra na splash (sem cache)
  const backgroundRefresh = useCallback(async (url: string, reportProgress = false, skipEtag = false) => {
    setIsLoading(true);
    if (reportProgress) setParseProgress(0);
    try {
      const result = await fetchPlaylist(url, skipEtag);
      if (!result) {
        // 304 Not Modified — conteúdo não mudou no servidor
        // Apenas atualiza o timestamp; isSample permanece inalterado
        // (não marcamos isSample:false pois só temos a amostra em disco)
        const metaRaw = await AsyncStorage.getItem(SK.CACHE_META).catch(() => null);
        if (metaRaw) {
          const meta = JSON.parse(metaRaw);
          await AsyncStorage.setItem(SK.CACHE_META, JSON.stringify({ ...meta, fetchedAt: Date.now() }));
        }
        if (reportProgress) { setParseProgress(100); setIsLoaded(true); }
        return;
      }

      if (!result.text.includes('#EXTINF')) return;

      // reportProgress=true: splash exibe progresso real durante parse
      // reportProgress=false: parse silencioso, zero re-renders extras
      const parsed = await parseM3UFull(
        result.text,
        setEpgUrl,
        reportProgress ? setParseProgress : undefined,
      );

      if (parsed.length > 0) {
        setChannels(parsed);           // ← UMA única atualização de estado
        setIsLoaded(true);
        setPlaylistSource(prev =>
          prev ? { ...prev, channelCount: parsed.length, loadedAt: Date.now() } : null,
        );
        await saveFullCache(parsed, url);
      }
    } catch (e) {
      console.warn('Background refresh failed:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const restoreSession = async () => {
    try {
      // Carregar tudo em paralelo (settings + cache)
      const [sourceRaw, catMapRaw, historyRaw, cache] = await Promise.all([
        AsyncStorage.getItem(SK.SOURCE),
        AsyncStorage.getItem(SK.CAT_MAP),
        AsyncStorage.getItem(SK.HISTORY),
        loadFullCache(),
      ]);

      if (catMapRaw) setCategoryMap(JSON.parse(catMapRaw));
      if (historyRaw) setWatchHistory(JSON.parse(historyRaw));
      if (!sourceRaw) return;

      const source: PlaylistSource = JSON.parse(sourceRaw);
      setPlaylistSource(source);

      // Exibir cache imediatamente (< 300ms)
      if (cache && cache.channels.length > 0) {
        setChannels(cache.channels);
        setIsLoaded(true);

        // Cache fresco (< 6h): não fazer nenhum request de rede
        if (cache.isFresh) return;
      }

      // Cache desatualizado ou ausente: refresh após animações de navegação concluírem
      if (source.type === 'url') {
        const noCache   = !cache || cache.channels.length === 0;
        // Pula ETag quando o cache é parcial/ausente — precisamos do arquivo completo,
        // não de um 304 que nos deixaria com apenas a amostra de canais ao vivo
        const isSample  = !cache || cache.meta?.isSample !== false;
        InteractionManager.runAfterInteractions(() => {
          backgroundRefresh(source.value, noCache, isSample).catch(() => {});
        });
      }
    } catch (e) {
      console.warn('Restore session error:', e);
    }
  };

  // ── Primeira carga (SetupScreen): mostra progresso no splash ─────────────────
  const processAndSave = async (
    text: string,
    source: Omit<PlaylistSource, 'loadedAt' | 'channelCount'>,
  ) => {
    setChannels([]);
    setParseProgress(0);

    // Parse com progresso (para a splash screen) mas sem setChannels intermediário
    const parsed = await parseM3UFull(text, setEpgUrl, setParseProgress);

    if (parsed.length === 0) throw new Error('Nenhum canal encontrado na playlist');

    setChannels(parsed);  // ← uma única atualização
    setIsLoaded(true);

    const fullSource: PlaylistSource = {
      ...source,
      loadedAt: Date.now(),
      channelCount: parsed.length,
    };
    setPlaylistSource(fullSource);

    // Salvar em paralelo
    await Promise.all([
      AsyncStorage.setItem(SK.SOURCE, JSON.stringify(fullSource)),
      saveFullCache(parsed, source.type === 'url' ? source.value : ''),
    ]);
  };

  const loadFromUrl = useCallback(async (url: string, useProxy = false) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const fetchUrl = useProxy
        ? `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
        : url;
      const res = await fetch(fetchUrl, { headers: { 'User-Agent': 'WideTV/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes('#EXTINF')) throw new Error('Arquivo não é uma playlist M3U válida');
      const etag = res.headers.get('etag') || res.headers.get('last-modified') || '';
      if (etag) AsyncStorage.setItem(SK.ETAG, etag).catch(() => {});
      await processAndSave(text, { type: 'url', value: url });
    } catch (e: any) {
      setLoadError(e.message || 'Erro ao carregar a playlist');
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadFromText = useCallback(async (text: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      if (!text.includes('#EXTINF')) throw new Error('Texto não parece ser uma playlist M3U válida');
      await processAndSave(text, { type: 'text', value: text });
    } catch (e: any) {
      setLoadError(e.message || 'Erro ao processar a playlist');
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearPlaylist = async () => {
    setChannels([]);
    setPlaylistSource(null);
    setIsLoaded(false);
    await Promise.all([
      AsyncStorage.removeItem(SK.SOURCE),
      AsyncStorage.removeItem(SK.CACHE_META),
      AsyncStorage.removeItem(SK.ETAG),
      AsyncStorage.removeItem(CACHE_CHUNK_KEY(0)),
    ]);
  };

  const setCategoryType = (group: string, type: 'live' | 'movie' | 'series') =>
    setCategoryMap(prev => ({ ...prev, [group]: type }));

  const saveCategoryMap = async () =>
    AsyncStorage.setItem(SK.CAT_MAP, JSON.stringify(categoryMap));

  const saveProgress = useCallback((channelId: string, position: number, duration: number) => {
    const progress: WatchProgress = { channelId, position, duration, updatedAt: Date.now() };
    setWatchHistory(prev => {
      const updated = { ...prev, [channelId]: progress };
      AsyncStorage.setItem(SK.HISTORY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const getProgress = useCallback(
    (channelId: string): WatchProgress | null => watchHistory[channelId] || null,
    [watchHistory],
  );

  const clearHistory = async () => {
    setWatchHistory({});
    await AsyncStorage.removeItem(SK.HISTORY);
  };

  return (
    <PlaylistContext.Provider value={{
      channels, groups, playlistSource, epgUrl, parseProgress,
      isLoaded, isLoading, loadError, categoryMap, watchHistory,
      loadFromUrl, loadFromText, clearPlaylist,
      setCategoryType, saveCategoryMap, saveProgress, getProgress, clearHistory,
    }}>
      {children}
    </PlaylistContext.Provider>
  );
}

export function usePlaylist(): PlaylistContextType {
  const ctx = useContext(PlaylistContext);
  if (!ctx) throw new Error('usePlaylist must be used inside PlaylistProvider');
  return ctx;
}
