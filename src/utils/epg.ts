import AsyncStorage from '@react-native-async-storage/async-storage';

export interface EPGProgram {
  channelId: string;
  title: string;
  description?: string;
  start: number; // unix ms
  stop: number;  // unix ms
}

const EPG_CACHE_KEY = '@widetv_epg_v1';
const EPG_TTL = 60 * 60 * 1000; // 1 hora
const MAX_BYTES = 8 * 1024 * 1024; // 8MB limit para parse

// Parser de data XMLTV: "20230115200000 +0000" ou "20230115200000 -0300"
function parseXMLTVDate(str: string): number {
  str = str.trim();
  const dt = str.slice(0, 14);
  const tz = str.slice(14).trim();
  const year = dt.slice(0, 4);
  const month = dt.slice(4, 6);
  const day = dt.slice(6, 8);
  const h = dt.slice(8, 10);
  const m = dt.slice(10, 12);
  const s = dt.slice(12, 14);
  const tzStr = tz ? tz.replace(/^([+-])(\d{2})(\d{2})$/, '$1$2:$3') : 'Z';
  return new Date(`${year}-${month}-${day}T${h}:${m}:${s}${tzStr}`).getTime();
}

// Parse simples de XMLTV com regex (sem DOM parser)
function parseXMLTV(xml: string): EPGProgram[] {
  const programs: EPGProgram[] = [];

  // Limita tamanho para não travar
  const slice = xml.length > MAX_BYTES ? xml.slice(0, MAX_BYTES) : xml;

  const progRe = /<programme\s([^>]+)>([\s\S]*?)<\/programme>/gi;
  let m: RegExpExecArray | null;
  const now = Date.now();
  const horizon = now + 24 * 60 * 60 * 1000; // só próximas 24h

  while ((m = progRe.exec(slice)) !== null) {
    const attrs = m[1];
    const body = m[2];

    const startM = attrs.match(/start="([^"]+)"/);
    const stopM = attrs.match(/stop="([^"]+)"/);
    const chM = attrs.match(/channel="([^"]+)"/);
    const titleM = body.match(/<title[^>]*>([^<]+)<\/title>/);
    const descM = body.match(/<desc[^>]*>([^<]+)<\/desc>/);

    if (!startM || !stopM || !chM || !titleM) continue;

    try {
      const start = parseXMLTVDate(startM[1]);
      const stop = parseXMLTVDate(stopM[1]);

      // só carrega programas relevantes (passado recente + próximas 24h)
      if (stop < now - 60 * 60 * 1000 || start > horizon) continue;

      programs.push({
        channelId: chM[1].trim(),
        title: titleM[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        description: descM ? descM[1].trim().replace(/&amp;/g, '&') : undefined,
        start,
        stop,
      });
    } catch (_) {}
  }

  return programs;
}

export async function fetchEPG(epgUrl: string): Promise<EPGProgram[]> {
  if (!epgUrl) return [];
  try {
    // Checar cache
    const cacheRaw = await AsyncStorage.getItem(EPG_CACHE_KEY);
    if (cacheRaw) {
      const cache = JSON.parse(cacheRaw);
      if (cache.url === epgUrl && Date.now() - cache.fetchedAt < EPG_TTL) {
        return cache.programs as EPGProgram[];
      }
    }

    const res = await fetch(epgUrl, {
      headers: { 'User-Agent': 'WideTV/1.0' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const programs = parseXMLTV(xml);

    // Salvar cache
    await AsyncStorage.setItem(EPG_CACHE_KEY, JSON.stringify({
      url: epgUrl,
      fetchedAt: Date.now(),
      programs,
    }));

    return programs;
  } catch (_) {
    return [];
  }
}

export function getCurrentAndNext(
  programs: EPGProgram[],
  channelId: string,
): { current: EPGProgram | null; next: EPGProgram | null } {
  if (!channelId) return { current: null, next: null };

  const now = Date.now();
  const ch = programs
    .filter(p => p.channelId === channelId)
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < ch.length; i++) {
    const p = ch[i];
    if (p.start <= now && now < p.stop) {
      return { current: p, next: ch[i + 1] ?? null };
    }
  }
  return { current: null, next: null };
}

export function epgProgress(program: EPGProgram): number {
  const now = Date.now();
  const elapsed = now - program.start;
  const total = program.stop - program.start;
  return total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
