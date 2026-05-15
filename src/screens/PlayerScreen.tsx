import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
  ActivityIndicator, StatusBar, ScrollView, Dimensions,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../../App';
import { usePlaylist } from '../context/PlaylistContext';
import {
  fetchEPG, getCurrentAndNext, epgProgress, fmtTime,
  EPGProgram,
} from '../utils/epg';

type Variant = { label: string; url: string; id: string };

type Props = {
  navigation: StackNavigationProp<RootStackParamList, 'Player'>;
  route: RouteProp<RootStackParamList, 'Player'>;
};

const QUALITY_RES: Record<string, string> = {
  '+HD': '4K/UHD', 'UHD': '4K/UHD', '4K': '4K/UHD',
  'FHD': '1080p', 'HD²': '720p', 'HD2': '720p', 'HD': '720p',
  'H265': 'HEVC', 'HEVC': 'HEVC', 'SD': '480p', 'Padrão': 'Auto',
};
function getRes(label: string): string {
  for (const [k, v] of Object.entries(QUALITY_RES)) {
    if (label.toUpperCase().includes(k.toUpperCase())) return v;
  }
  return '';
}
function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function getQualityIcon(label: string): string {
  const u = label.toUpperCase();
  if (u.includes('4K') || u.includes('UHD') || u.includes('+HD')) return '★';
  if (u.includes('FHD')) return '◈';
  if (u.includes('HD')) return '▣';
  if (u.includes('H265') || u.includes('HEVC')) return '⊛';
  if (u.includes('SD')) return '◻';
  return '○';
}

// ─── EPG Card ─────────────────────────────────────────────────────────────────
function EPGCard({ programs, tvgId }: { programs: EPGProgram[]; tvgId?: string }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(iv);
  }, []);

  if (!tvgId || programs.length === 0) return null;
  const { current, next } = getCurrentAndNext(programs, tvgId);
  if (!current) return null;

  const progress = epgProgress(current);

  return (
    <View style={epgStyles.card}>
      {/* Programa atual */}
      <View style={epgStyles.nowSection}>
        <Text style={epgStyles.time}>{fmtTime(current.start)}</Text>
        <View style={epgStyles.info}>
          <Text style={epgStyles.title} numberOfLines={1}>{current.title}</Text>
          {current.description ? (
            <Text style={epgStyles.desc} numberOfLines={2}>{current.description}</Text>
          ) : null}
          <View style={epgStyles.progressBg}>
            <View style={[epgStyles.progressFill, { width: `${progress}%` as any }]} />
          </View>
        </View>
      </View>
      {/* Próximo programa */}
      {next ? (
        <View style={epgStyles.nextSection}>
          <Text style={epgStyles.nextLabel}>A SEGUIR</Text>
          <View style={epgStyles.nextRow}>
            <Text style={epgStyles.nextTime}>{fmtTime(next.start)}</Text>
            <Text style={epgStyles.nextTitle} numberOfLines={1}>{next.title}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ─── Player ───────────────────────────────────────────────────────────────────
export default function PlayerScreen({ navigation, route }: Props) {
  const { url, title, subtitle, channelId, isLive, variants = [] } = route.params;
  const { saveProgress, getProgress, epgUrl } = usePlaylist();
  const insets = useSafeAreaInsets();

  // Busca tvgId nos params — pode vir via route se expandirmos o tipo
  // Por ora, channelId serve como fallback para EPG matching
  const tvgId = (route.params as any).tvgId as string | undefined ?? channelId;

  const allVariants: Variant[] = variants.length > 0
    ? variants
    : [{ label: 'Padrão', url, id: channelId }];

  const [currentVariant, setCurrentVariant] = useState<Variant>(allVariants[0]);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLandscape, setIsLandscape] = useState(false);
  const [epgPrograms, setEpgPrograms] = useState<EPGProgram[]>([]);

  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const controlsTimer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(true); // evita setState em componente desmontado
  const screenH = Dimensions.get('window').height;
  const VIDEO_H = Math.round(screenH * 0.36);

  const player = useVideoPlayer(currentVariant.url, p => { p.loop = false; p.play(); });

  // ── Cleanup global ao desmontar ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      mounted.current = false;
      clearTimeout(controlsTimer.current);
      // Parar o player imediatamente para liberar recursos
      try { player.pause(); } catch (_) {}
    };
  }, []);

  // ── EPG ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLive || !epgUrl) return;
    let cancelled = false;
    const update = () => fetchEPG(epgUrl).then(programs => {
      if (!cancelled && mounted.current) setEpgPrograms(programs);
    }).catch(() => {});
    update();
    const iv = setInterval(update, 60 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [epgUrl, isLive]);

  // ── Orientação ────────────────────────────────────────────────────────────
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    StatusBar.setHidden(true);
    const sub = ScreenOrientation.addOrientationChangeListener(evt => {
      if (!mounted.current) return;
      const o = evt.orientationInfo.orientation;
      setIsLandscape(
        o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT,
      );
    });
    return () => {
      ScreenOrientation.removeOrientationChangeListener(sub);
      // Não bloqueante: dispara e esquece (sem await)
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      StatusBar.setHidden(false);
    };
  }, []);

  // ── Sync player ───────────────────────────────────────────────────────────
  useEffect(() => { paused ? player.pause() : player.play(); }, [paused]);
  useEffect(() => { player.muted = muted; }, [muted]);

  // ── Trocar qualidade ──────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    try { player.replace({ uri: currentVariant.url }); } catch (_) {}
    player.play();
  }, [currentVariant.url]);

  // ── Progresso polling ─────────────────────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      if (!mounted.current) return;
      try {
        const pos = player.currentTime ?? 0;
        const dur = player.duration ?? 0;
        setCurrentTime(pos);
        if (dur > 0) setDuration(dur);
        if (loading && pos > 0) setLoading(false);
      } catch (_) {}
    }, 1000);
    return () => clearInterval(iv);
  }, [player, loading]);

  // ── Salvar progresso ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isLive || duration === 0) return;
    const iv = setInterval(() => saveProgress(currentVariant.id, currentTime, duration), 10000);
    return () => clearInterval(iv);
  }, [currentTime, duration, isLive, currentVariant.id]);

  // ── Retomar ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLive) {
      const saved = getProgress(channelId);
      if (saved && saved.position > 10 && saved.duration > 0 && saved.position / saved.duration < 0.95) {
        setTimeout(() => { try { player.currentTime = saved.position; } catch (_) {} }, 1500);
      }
    }
  }, []);

  // ── Controles auto-hide ───────────────────────────────────────────────────
  const showControlsFor3s = useCallback(() => {
    clearTimeout(controlsTimer.current);
    setShowControls(true);
    Animated.timing(controlsOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    controlsTimer.current = setTimeout(() => {
      if (!paused) {
        Animated.timing(controlsOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(
          () => setShowControls(false),
        );
      }
    }, 3000);
  }, [paused, controlsOpacity]);

  useEffect(() => {
    showControlsFor3s();
    return () => clearTimeout(controlsTimer.current);
  }, []);

  const handleTap = useCallback(() => showControlsFor3s(), [showControlsFor3s]);

  const toggleOrientation = useCallback(async () => {
    try {
      if (isLandscape) await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      else await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      if (mounted.current) showControlsFor3s();
    } catch (_) {}
  }, [isLandscape, showControlsFor3s]);

  const seek = useCallback((delta: number) => {
    const target = Math.max(0, Math.min(currentTime + delta, duration));
    try { player.currentTime = target; } catch (_) {}
    showControlsFor3s();
  }, [currentTime, duration, player, showControlsFor3s]);

  const selectVariant = useCallback((v: Variant) => {
    setCurrentVariant(v);
    showControlsFor3s();
  }, [showControlsFor3s]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasVariants = allVariants.length > 1;

  // ── Overlay de controles ──────────────────────────────────────────────────
  const ControlsOverlay = (
    <Animated.View style={[StyleSheet.absoluteFill, styles.controlsLayer, { opacity: controlsOpacity }]} pointerEvents="box-none">
      {/* Top: canal + dot AO VIVO */}
      <View style={styles.ctrlTop}>
        <View style={styles.channelTag}>
          {isLive && <View style={styles.liveDot} />}
          <Text style={styles.channelTagText} numberOfLines={1}>{title}</Text>
        </View>
        {/* Em landscape: botões fechar/rotacionar no overlay */}
        {isLandscape && (
          <View style={styles.topActions}>
            <TouchableOpacity style={styles.iconBtn} onPress={toggleOrientation}>
              <Text style={styles.iconBtnTxt}>📱</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.iconBtnTxt}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Centro: retroceder / play / avançar */}
      <View style={styles.ctrlCenter}>
        {!isLive && (
          <TouchableOpacity onPress={() => seek(-10)} style={styles.sideBtn}>
            <Text style={styles.sideBtnTxt}>⟪</Text>
            <Text style={styles.sideBtnSub}>10s</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.playBtn} onPress={() => { setPaused(p => !p); showControlsFor3s(); }}>
          <Text style={styles.playBtnTxt}>{paused ? '▶' : '⏸'}</Text>
        </TouchableOpacity>
        {!isLive && (
          <TouchableOpacity onPress={() => seek(10)} style={styles.sideBtn}>
            <Text style={styles.sideBtnTxt}>⟫</Text>
            <Text style={styles.sideBtnSub}>10s</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Rodapé do vídeo: qualidade + volume + fullscreen */}
      <View style={styles.ctrlBottom}>
        <View style={styles.bottomLeft}>
          {hasVariants && (
            <View style={styles.qualityTag}>
              <Text style={styles.qualityTagTxt}>⚙️ {currentVariant.label}</Text>
            </View>
          )}
        </View>
        <View style={styles.bottomRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => { setMuted(m => !m); showControlsFor3s(); }}>
            <Text style={styles.iconBtnTxt}>{muted ? '🔇' : '🔊'}</Text>
          </TouchableOpacity>
          {/* Fullscreen: quadrado arredondado (não círculo) */}
          <TouchableOpacity style={styles.fsBtn} onPress={toggleOrientation}>
            <Text style={styles.iconBtnTxt}>{isLandscape ? '⊡' : '⛶'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Barra de progresso VOD em landscape */}
      {isLandscape && !isLive && duration > 0 && (
        <View style={styles.lsProgressRow}>
          <Text style={styles.progressTime}>{formatTime(currentTime)}</Text>
          <View style={styles.progressTrack}>
            <View style={styles.progressBg} />
            <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
          </View>
          <Text style={styles.progressTime}>{formatTime(duration)}</Text>
        </View>
      )}
    </Animated.View>
  );

  // ── LANDSCAPE: fullscreen ─────────────────────────────────────────────────
  if (isLandscape) {
    return (
      <View style={styles.root}>
        <StatusBar hidden />
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleTap} activeOpacity={1} />
        {loading && (
          <View style={styles.spinner} pointerEvents="none">
            <ActivityIndicator size="large" color="#00C8E8" />
          </View>
        )}
        {showControls && ControlsOverlay}
      </View>
    );
  }

  // ── PORTRAIT: header fixo + vídeo (36%) + painel scrollável ──────────────
  return (
    <View style={[styles.root, { backgroundColor: '#0d1325' }]}>
      <StatusBar hidden />

      {/* Header permanente — só ← e título, sem botão fullscreen */}
      <View style={[styles.permanentHeader, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnTxt}>←</Text>
        </TouchableOpacity>
        <Text style={styles.permanentTitle} numberOfLines={1}>{title}</Text>
      </View>

      {/* Área do vídeo */}
      <View style={[styles.videoArea, { height: VIDEO_H }]}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleTap} activeOpacity={1} />
        {loading && (
          <View style={styles.spinner} pointerEvents="none">
            <ActivityIndicator size="large" color="#00C8E8" />
            <Text style={styles.loadingTxt}>Carregando...</Text>
          </View>
        )}
        {showControls && ControlsOverlay}
      </View>

      {/* Painel de informações */}
      <ScrollView style={styles.infoPanel} contentContainerStyle={styles.infoPanelContent} showsVerticalScrollIndicator={false}>
        {/* Nome + badge */}
        <Text style={styles.chName}>{title}</Text>
        <View style={styles.chSubRow}>
          {isLive && <View style={styles.livePill}><Text style={styles.livePillTxt}>AO VIVO</Text></View>}
          <Text style={styles.chSubTxt} numberOfLines={1}>{subtitle ?? (isLive ? 'Transmissão ao vivo' : '')}</Text>
        </View>

        {/* EPG */}
        <EPGCard programs={epgPrograms} tvgId={tvgId} />

        {/* Progress bar VOD */}
        {!isLive && duration > 0 && (
          <View style={styles.vodProgress}>
            <Text style={styles.progressTime}>{formatTime(currentTime)}</Text>
            <View style={styles.progressTrack}>
              <View style={styles.progressBg} />
              <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
            </View>
            <Text style={styles.progressTime}>{formatTime(duration)}</Text>
          </View>
        )}

        {/* Seletor de qualidade */}
        {hasVariants && (
          <>
            <Text style={styles.sectionLabel}>Qualidade de vídeo</Text>
            <View style={styles.qualityCard}>
              {allVariants.map((v, i) => {
                const isActive = currentVariant.id === v.id;
                return (
                  <React.Fragment key={v.id}>
                    {i > 0 && <View style={styles.qualitySep} />}
                    <TouchableOpacity
                      style={[styles.qualityOption, isActive && styles.qualityOptionActive]}
                      onPress={() => selectVariant(v)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.qualityLeft}>
                        <Text style={[styles.qualityIcon, isActive && styles.qualityIconActive]}>
                          {isActive ? '✓' : getQualityIcon(v.label)}
                        </Text>
                        <Text style={[styles.qualityLabel, isActive && styles.qualityLabelActive]}>{v.label}</Text>
                      </View>
                      <View style={styles.qualityRight}>
                        {getRes(v.label) ? <Text style={[styles.qualityRes, isActive && styles.qualityResActive]}>{getRes(v.label)}</Text> : null}
                        {isActive && <View style={styles.activeIndicator} />}
                      </View>
                    </TouchableOpacity>
                  </React.Fragment>
                );
              })}
            </View>
          </>
        )}

        <View style={{ height: 28 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  // Header portrait — sem botão fullscreen
  permanentHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0d1325', paddingHorizontal: 12, paddingBottom: 8, gap: 10 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backBtnTxt: { fontSize: 22, color: '#e8eef8', fontWeight: '300' },
  permanentTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: '#e8eef8' },
  // Video area
  videoArea: { backgroundColor: '#000', position: 'relative' },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingTxt: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  // Controls overlay
  controlsLayer: { justifyContent: 'space-between' },
  ctrlTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
  channelTag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, maxWidth: '70%' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#e8392a' },
  channelTagTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  topActions: { flexDirection: 'row', gap: 6 },
  iconBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  // Fullscreen: quadrado arredondado (não círculo)
  fsBtn: { width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  iconBtnTxt: { fontSize: 12, color: '#e0eaff' },
  ctrlCenter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  sideBtn: { alignItems: 'center', padding: 8 },
  sideBtnTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 18 },
  sideBtnSub: { color: 'rgba(255,255,255,0.5)', fontSize: 9, marginTop: -2 },
  playBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  playBtnTxt: { fontSize: 20, color: '#fff' },
  ctrlBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
  bottomLeft: {},
  bottomRight: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  qualityTag: { backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  qualityTagTxt: { color: '#a8c0ee', fontSize: 11, fontWeight: '600' },
  lsProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  vodProgress: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 4 },
  progressTime: { color: 'rgba(255,255,255,0.6)', fontSize: 11, minWidth: 32, textAlign: 'center' },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, position: 'relative', justifyContent: 'center' },
  progressBg: { height: 3, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2 },
  progressFill: { position: 'absolute', left: 0, height: 3, backgroundColor: '#4f8ff7', borderRadius: 2 },
  // Info panel
  infoPanel: { flex: 1, backgroundColor: '#0d1325' },
  infoPanelContent: { padding: 14 },
  chName: { fontSize: 16, fontWeight: '700', color: '#e8eef8', marginBottom: 5 },
  chSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  livePill: { backgroundColor: '#e8392a', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  livePillTxt: { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  chSubTxt: { fontSize: 12, color: '#4a5a7a', flex: 1 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#e8eef8', marginTop: 14, marginBottom: 7 },
  // Quality card
  qualityCard: { backgroundColor: '#141d32', borderRadius: 10, borderWidth: 1, borderColor: '#1e2a45', overflow: 'hidden' },
  qualityOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  qualityOptionActive: { backgroundColor: 'rgba(79,143,247,0.08)' },
  qualityLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qualityIcon: { fontSize: 14, color: '#4a5a7a', width: 18, textAlign: 'center' },
  qualityIconActive: { color: '#4f8ff7' },
  qualityLabel: { fontSize: 14, color: '#cdd8f0', fontWeight: '500' },
  qualityLabelActive: { color: '#4f8ff7', fontWeight: '700' },
  qualityRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qualityRes: { fontSize: 11, color: '#4a5a7a' },
  qualityResActive: { color: '#4f8ff7' },
  activeIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4f8ff7' },
  qualitySep: { height: 1, backgroundColor: '#111827' },
});

// ─── EPG styles ───────────────────────────────────────────────────────────────
const epgStyles = StyleSheet.create({
  card: { backgroundColor: '#141d32', borderRadius: 8, borderWidth: 1, borderColor: '#1e2a45', overflow: 'hidden', marginBottom: 4 },
  nowSection: { flexDirection: 'row', padding: 10, gap: 8, alignItems: 'flex-start' },
  time: { fontSize: 11, fontWeight: '700', color: '#4f8ff7', minWidth: 36, paddingTop: 2 },
  info: { flex: 1 },
  title: { fontSize: 13, fontWeight: '700', color: '#e8eef8', marginBottom: 3 },
  desc: { fontSize: 11, color: '#4a5a7a', lineHeight: 16, marginBottom: 6 },
  progressBg: { height: 3, backgroundColor: '#0d1325', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: '#4f8ff7', borderRadius: 2 },
  nextSection: { backgroundColor: '#111827', paddingHorizontal: 10, paddingVertical: 8 },
  nextLabel: { fontSize: 9, fontWeight: '700', color: '#4a5a7a', letterSpacing: 0.5, marginBottom: 4 },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nextTime: { fontSize: 11, color: '#6b7fa3', fontWeight: '600', minWidth: 36 },
  nextTitle: { flex: 1, fontSize: 12, color: '#9ab0d0' },
});
