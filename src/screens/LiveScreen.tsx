import React, { useMemo, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Image, Dimensions, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePlaylist, Channel } from '../context/PlaylistContext';
import { RootStackParamList } from '../../App';

const { width } = Dimensions.get('window');
const NUM_COLS = 3;
const CARD_W = (width - 16 * 2 - 8 * (NUM_COLS - 1)) / NUM_COLS;
const CARD_H = Math.round(CARD_W * 1.35);
const NAME_H = 36;
const ROW_H = CARD_H + NAME_H + 8; // card + name + gap

type Nav = StackNavigationProp<RootStackParamList>;
type Variant = { label: string; url: string; id: string };

// ─── Quality grouping ─────────────────────────────────────────────────────────
const QUALITY_RE = /[\s\-–_]*((\[|\()?(\+?(?:FHD|UHD|4K|H\.?265|HEVC|HD[²2]?|\+?HD|SD))(\]|\))?)+\s*$/gi;

function baseName(n: string): string {
  let b = n;
  for (let i = 0; i < 5; i++) {
    const p = b;
    b = b
      .replace(/[\s\-–_]*\[H\.?265\]\s*$/i, '')
      .replace(/[\s\-–_]*\(H\.?265\)\s*$/i, '')
      .replace(/[\s\-–_]+(\+?(?:FHD|UHD|4K|H\.?265|HEVC|HD[²2]?|\+?HD|SD))\s*$/i, '')
      .trim();
    if (b === p) break;
  }
  return b;
}

function qLabel(name: string, base: string): string {
  if (name === base) return 'Padrão';
  return name.slice(base.length).trim().replace(/^[\s\-–_\[(]+|[\])\s]+$/g, '').trim() || 'Padrão';
}

const Q_ORDER = ['4K', 'UHD', '+HD', 'FHD', 'H265', 'HEVC', 'HD²', 'HD2', 'HD', 'SD', 'Padrão'];
function sortVariants(vs: Variant[]): Variant[] {
  return [...vs].sort((a, b) => {
    const ia = Q_ORDER.findIndex(q => a.label.toUpperCase().includes(q.replace('²', '2')));
    const ib = Q_ORDER.findIndex(q => b.label.toUpperCase().includes(q.replace('²', '2')));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

interface GChannel extends Channel { variants: Variant[] }

function groupByQuality(channels: Channel[]): GChannel[] {
  const map = new Map<string, Channel[]>();
  for (const ch of channels) {
    const key = baseName(ch.name).toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ch);
  }
  return Array.from(map.values()).map(group => {
    const base = baseName(group[0].name);
    const vs: Variant[] = group.map(ch => ({ label: qLabel(ch.name, base), url: ch.url, id: ch.id }));
    const sorted = sortVariants(vs);
    const best = group.find(ch => qLabel(ch.name, base) === sorted[0].label) ?? group[0];
    return { ...best, name: base, variants: sorted };
  });
}

function chunkArray<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ─── Category icon ────────────────────────────────────────────────────────────
function catIcon(group: string): string {
  const g = group.toLowerCase();
  if (g.includes('sport') || g.includes('esport') || g.includes('futebol') || g.includes('olimp')) return '⚽';
  if (g.includes('radio') || g.includes('rádio') || g.includes(' fm') || g.includes(' am')) return '📻';
  if (g.includes('notici') || g.includes('news') || g.includes('jornal')) return '📰';
  if (g.includes('film') || g.includes('cine') || g.includes('movie')) return '🎬';
  if (g.includes('serie') || g.includes('hbo') || g.includes('tnt') || g.includes('amc')) return '🎭';
  if (g.includes('music') || g.includes('clip') || g.includes('mtv')) return '🎵';
  if (g.includes('kids') || g.includes('infantil') || g.includes('cartoon')) return '🧒';
  if (g.includes('document') || g.includes('discovery') || g.includes('natgeo')) return '🔭';
  if (g.includes('adult') || g.includes('+18')) return '🔞';
  if (g.includes('abertos') || g.includes('globo') || g.includes('record') || g.includes('sbt')) return '📺';
  if (g.includes('test') || g.includes('zap')) return '🧪';
  return '📡';
}

function catDisplayName(group: string): string {
  return group.replace(/^canais?\s*[|\/]\s*/i, '').trim() || group;
}

// ─── useDebounce ──────────────────────────────────────────────────────────────
function useDebounced(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  React.useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer.current);
  }, [value, delay]);
  return debounced;
}

// ─── SearchBar ────────────────────────────────────────────────────────────────
function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={styles.searchRow}>
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder={placeholder}
          placeholderTextColor="rgba(143,163,192,0.5)"
          value={value}
          onChangeText={onChange}
          autoCorrect={false}
          returnKeyType="search"
        />
        {value.length > 0 && (
          <TouchableOpacity onPress={() => onChange('')}>
            <Text style={styles.clearBtn}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── ETAPA 1: Grade de categorias ────────────────────────────────────────────
function CategoryView({ type, onSelect }: { type: 'live' | 'movie' | 'series'; onSelect: (g: string) => void }) {
  const { channels, categoryMap, isLoading } = usePlaylist();
  const [search, setSearch] = useState('');
  const dSearch = useDebounced(search);

  const categories = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const ch of channels) {
      const mt = categoryMap[ch.group];
      const ok = mt ? mt === type : (type === 'live' ? ch.type === 'live' || ch.type === 'unknown' : ch.type === type);
      if (!ok) continue;
      if (!map.has(ch.group)) map.set(ch.group, new Set());
      map.get(ch.group)!.add(baseName(ch.name).toLowerCase());
    }
    let arr = Array.from(map.entries()).map(([group, names]) => ({ group, count: names.size }));
    if (dSearch.trim()) {
      const q = dSearch.toLowerCase();
      arr = arr.filter(c => c.group.toLowerCase().includes(q) || catDisplayName(c.group).toLowerCase().includes(q));
    }
    return arr.sort((a, b) => b.count - a.count);
  }, [channels, categoryMap, type, dSearch]);

  const title = type === 'live' ? 'Ao Vivo' : type === 'movie' ? 'Filmes' : 'Séries';
  const icon = type === 'live' ? '📡' : type === 'movie' ? '🎬' : '📺';

  const renderCatCard = ({ item }: { item: { group: string; count: number } }) => (
    <TouchableOpacity style={styles.catCard} onPress={() => onSelect(item.group)} activeOpacity={0.8}>
      <Text style={styles.catIcon}>{catIcon(item.group)}</Text>
      <Text style={styles.catName} numberOfLines={3}>{catDisplayName(item.group)}</Text>
      <View style={styles.catCountBadge}>
        <Text style={styles.catCountText}>{item.count} canais</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{icon} {title}</Text>
          <Text style={styles.headerCount}>{categories.length} categorias</Text>
        </View>
        <SearchBar value={search} onChange={setSearch} placeholder="Buscar categoria..." />
        {isLoading && channels.length === 0 ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#00C8E8" />
            <Text style={styles.loadingText}>Carregando playlist...</Text>
          </View>
        ) : categories.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{icon}</Text>
            <Text style={styles.emptyTitle}>Nenhuma categoria encontrada</Text>
          </View>
        ) : (
          <FlatList
            data={categories}
            renderItem={renderCatCard}
            keyExtractor={item => item.group}
            numColumns={2}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.catGrid}
            columnWrapperStyle={styles.catRow}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={5}
            ListHeaderComponent={isLoading ? (
              <View style={styles.loadingBanner}>
                <ActivityIndicator size="small" color="#00C8E8" />
                <Text style={styles.loadingBannerText}>Atualizando playlist em background...</Text>
              </View>
            ) : null}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── ETAPA 2: Canais de uma categoria ────────────────────────────────────────
function ChannelView({
  group, type, onBack,
}: { group: string; type: 'live' | 'movie' | 'series'; onBack: () => void }) {
  const { channels, categoryMap } = usePlaylist();
  const navigation = useNavigation<Nav>();
  const [search, setSearch] = useState('');
  const dSearch = useDebounced(search);

  const filtered = useMemo(() => {
    let list = channels.filter(c => c.group === group);
    if (dSearch.trim()) {
      const q = dSearch.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || baseName(c.name).toLowerCase().includes(q));
    }
    list.sort((a, b) => baseName(a.name).localeCompare(baseName(b.name), 'pt'));
    return list;
  }, [channels, group, dSearch]);

  const displayChannels = useMemo(() => groupByQuality(filtered), [filtered]);

  const rows = useMemo(() => chunkArray(displayChannels, NUM_COLS), [displayChannels]);

  const playChannel = useCallback((ch: GChannel) => {
    navigation.navigate('Player', {
      url: ch.variants[0].url,
      title: ch.name,
      subtitle: ch.group,
      poster: ch.logo,
      channelId: ch.variants[0].id,
      isLive: ch.type === 'live',
      tvgId: ch.tvgId,
      variants: ch.variants,
    });
  }, [navigation]);

  const renderCard = (ch: GChannel) => (
    <TouchableOpacity key={ch.id} style={styles.card} onPress={() => playChannel(ch)} activeOpacity={0.82}>
      {ch.logo
        ? <Image source={{ uri: ch.logo }} style={styles.cardImg} resizeMode="cover" fadeDuration={200} />
        : <View style={[styles.cardImg, styles.placeholder]}><Text style={styles.placeholderIcon}>📡</Text></View>
      }
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={styles.cardGrad} />
      {type === 'live' && <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>AO VIVO</Text></View>}
      {ch.variants.length > 1 && (
        <View style={styles.gearBtn}><Text style={styles.gearIcon}>⚙️</Text></View>
      )}
      <Text style={styles.cardName} numberOfLines={2}>{ch.name}</Text>
    </TouchableOpacity>
  );

  const renderRow = ({ item: row }: { item: GChannel[] }) => (
    <View style={styles.gridRow}>
      {row.map(ch => renderCard(ch))}
      {row.length < NUM_COLS && Array(NUM_COLS - row.length).fill(null).map((_, i) => (
        <View key={`pad-${i}`} style={{ width: CARD_W }} />
      ))}
    </View>
  );

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ROW_H, offset: ROW_H * index, index,
  }), []);

  const displayName = catDisplayName(group);
  const icon = catIcon(group);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitleSmall} numberOfLines={1}>{icon} {displayName}</Text>
          <Text style={styles.headerCount}>{displayChannels.length}</Text>
        </View>
        <SearchBar value={search} onChange={setSearch} placeholder={`Buscar em ${displayName}...`} />

        {displayChannels.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nenhum canal encontrado</Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            renderItem={renderRow}
            keyExtractor={(_, i) => String(i)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            initialNumToRender={5}
            maxToRenderPerBatch={5}
            windowSize={5}
            getItemLayout={getItemLayout}
            removeClippedSubviews
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── Grid genérico (Filmes e Séries) ─────────────────────────────────────────
function GenericGrid({ type, title, icon }: { type: 'movie' | 'series'; title: string; icon: string }) {
  const { channels, categoryMap } = usePlaylist();
  const navigation = useNavigation<Nav>();
  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const dSearch = useDebounced(search);

  const filtered = useMemo(() => {
    let list = channels.filter(c => {
      const mt = categoryMap[c.group];
      return mt ? mt === type : c.type === type;
    });
    if (selectedGroup) list = list.filter(c => c.group === selectedGroup);
    if (dSearch.trim()) {
      const q = dSearch.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    return list;
  }, [channels, categoryMap, type, selectedGroup, dSearch]);

  const displayChannels = useMemo(() => groupByQuality(filtered), [filtered]);
  const groups = useMemo(() => Array.from(new Set(channels
    .filter(c => { const mt = categoryMap[c.group]; return mt ? mt === type : c.type === type; })
    .map(c => c.group))).sort(), [channels, categoryMap, type]);
  const rows = useMemo(() => chunkArray(displayChannels, NUM_COLS), [displayChannels]);

  const playChannel = useCallback((ch: GChannel) => {
    navigation.navigate('Player', {
      url: ch.variants[0].url,
      title: ch.name,
      subtitle: ch.group,
      poster: ch.logo,
      channelId: ch.variants[0].id,
      isLive: false,
      variants: ch.variants,
    });
  }, [navigation]);

  const renderCard = (ch: GChannel) => (
    <TouchableOpacity key={ch.id} style={styles.card} onPress={() => playChannel(ch)} activeOpacity={0.82}>
      {ch.logo
        ? <Image source={{ uri: ch.logo }} style={styles.cardImg} resizeMode="cover" fadeDuration={200} />
        : <View style={[styles.cardImg, styles.placeholder]}><Text style={styles.placeholderIcon}>{icon}</Text></View>
      }
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={styles.cardGrad} />
      {ch.variants.length > 1 && (
        <View style={styles.gearBtn}><Text style={styles.gearIcon}>⚙️</Text></View>
      )}
      <Text style={styles.cardName} numberOfLines={2}>{ch.name}</Text>
    </TouchableOpacity>
  );

  const renderRow = ({ item: row }: { item: GChannel[] }) => (
    <View style={styles.gridRow}>
      {row.map(ch => renderCard(ch))}
      {row.length < NUM_COLS && Array(NUM_COLS - row.length).fill(null).map((_, i) => (
        <View key={`pad-${i}`} style={{ width: CARD_W }} />
      ))}
    </View>
  );

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: ROW_H, offset: ROW_H * index, index,
  }), []);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{icon} {title}</Text>
          <Text style={styles.headerCount}>{displayChannels.length} itens</Text>
        </View>
        <SearchBar value={search} onChange={setSearch} placeholder={`Buscar ${title.toLowerCase()}...`} />

        {/* Pills de categoria */}
        {groups.length > 1 && (
          <FlatList
            data={['', ...groups]}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillsRow}
            keyExtractor={g => g}
            ItemSeparatorComponent={() => <View style={{ width: 6 }} />}
            renderItem={({ item: g }) => {
              const active = selectedGroup === g;
              const count = g === '' ? displayChannels.length : channels.filter(c => c.group === g).length;
              return (
                <TouchableOpacity
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => setSelectedGroup(g)}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]} numberOfLines={1}>
                    {g ? catDisplayName(g) : 'Todos'}
                  </Text>
                  <Text style={[styles.pillCount, active && styles.pillCountActive]}>{count}</Text>
                </TouchableOpacity>
              );
            }}
          />
        )}

        {displayChannels.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{icon}</Text>
            <Text style={styles.emptyTitle}>Nenhum resultado</Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            renderItem={renderRow}
            keyExtractor={(_, i) => String(i)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            initialNumToRender={5}
            maxToRenderPerBatch={8}
            windowSize={5}
            getItemLayout={getItemLayout}
            removeClippedSubviews
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export function LiveScreen() {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  if (selectedGroup !== null) {
    return <ChannelView group={selectedGroup} type="live" onBack={() => setSelectedGroup(null)} />;
  }
  return <CategoryView type="live" onSelect={setSelectedGroup} />;
}
// Filmes e Séries usam o mesmo padrão de duas etapas que o Ao Vivo:
// CategoryView (grade de categorias) → ChannelView (canais da categoria)
export function MoviesScreen() {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  if (selectedGroup !== null) {
    return <ChannelView group={selectedGroup} type="movie" onBack={() => setSelectedGroup(null)} />;
  }
  return <CategoryView type="movie" onSelect={setSelectedGroup} />;
}
export function SeriesScreen() {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  if (selectedGroup !== null) {
    return <ChannelView group={selectedGroup} type="series" onBack={() => setSelectedGroup(null)} />;
  }
  return <CategoryView type="series" onSelect={setSelectedGroup} />;
}
export default LiveScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1325' },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#e8eef8' },
  headerTitleSmall: { flex: 1, fontSize: 15, fontWeight: '700', color: '#e8eef8' },
  headerCount: { fontSize: 13, color: '#6b7fa3' },
  backBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 22, color: '#e8eef8', fontWeight: '300' },
  // Search
  searchRow: { paddingHorizontal: 14, marginBottom: 10 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141d32', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#1e2a45', gap: 8 },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, fontSize: 13, color: '#cdd8f0' },
  clearBtn: { color: '#4a5a7a', fontSize: 14, padding: 4 },
  // Loading
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#6b7fa3', fontSize: 14 },
  loadingBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(0,200,232,0.06)', marginBottom: 4 },
  loadingBannerText: { color: '#00C8E8', fontSize: 12 },
  // Category grid
  catGrid: { paddingHorizontal: 12, paddingBottom: 32 },
  catRow: { gap: 10, marginTop: 10 },
  catCard: { flex: 1, backgroundColor: '#141d32', borderRadius: 14, borderWidth: 1, borderColor: '#1e2a45', padding: 14, gap: 6, minHeight: 110, justifyContent: 'space-between' },
  catIcon: { fontSize: 28 },
  catName: { fontSize: 13, fontWeight: '600', color: '#cdd8f0', lineHeight: 17 },
  catCountBadge: { backgroundColor: '#1e2a45', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  catCountText: { fontSize: 11, color: '#6b7fa3', fontWeight: '600' },
  // Pills (Filmes/Séries)
  pillsRow: { paddingHorizontal: 14, marginBottom: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141d32', borderRadius: 20, borderWidth: 1, borderColor: '#1e2a45', paddingLeft: 12, paddingRight: 8, paddingVertical: 7, gap: 5, maxWidth: 170 },
  pillActive: { backgroundColor: 'rgba(79,143,247,0.2)', borderColor: '#4f8ff7' },
  pillText: { fontSize: 12, color: '#6b7fa3', fontWeight: '500', flexShrink: 1 },
  pillTextActive: { color: '#ffffff', fontWeight: '700' },
  pillCount: { fontSize: 10, color: '#4a5a7a', backgroundColor: '#1e2a45', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1, minWidth: 22, textAlign: 'center', fontWeight: '600' },
  pillCountActive: { color: '#4f8ff7', backgroundColor: 'rgba(79,143,247,0.15)' },
  // Channel grid
  listContent: { paddingBottom: 32 },
  gridRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginTop: 8 },
  card: { width: CARD_W, borderRadius: 10, overflow: 'hidden', backgroundColor: '#141d32', borderWidth: 1, borderColor: '#1e2a45' },
  cardImg: { width: CARD_W, height: CARD_H },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1628' },
  placeholderIcon: { fontSize: 24, opacity: 0.3 },
  cardGrad: { position: 'absolute', bottom: NAME_H, left: 0, right: 0, height: 50 },
  liveBadge: { position: 'absolute', top: 5, left: 5, backgroundColor: '#e8392a', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  liveBadgeText: { color: '#fff', fontSize: 8, fontWeight: '700', letterSpacing: 0.4 },
  gearBtn: { position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  gearIcon: { fontSize: 10 },
  cardName: { paddingHorizontal: 6, paddingVertical: 5, fontSize: 10, fontWeight: '600', color: '#cdd8f0', lineHeight: 13, backgroundColor: '#141d32', height: NAME_H, textAlignVertical: 'center' },
  // Empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
  emptyIcon: { fontSize: 48, opacity: 0.35, marginBottom: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
});
