import React, { useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, FlatList, Dimensions, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePlaylist, Channel } from '../context/PlaylistContext';
import { RootStackParamList } from '../../App';

const { width } = Dimensions.get('window');
const CARD_W = 130;
const CARD_H = 180;
type Nav = StackNavigationProp<RootStackParamList>;

export default function HomeScreen() {
  const { channels, categoryMap, watchHistory, clearPlaylist } = usePlaylist();
  const navigation = useNavigation<Nav>();

  const liveChannels = useMemo(() => channels.filter(c => c.type === 'live' || categoryMap[c.group] === 'live').slice(0, 20), [channels, categoryMap]);
  const movies = useMemo(() => channels.filter(c => c.type === 'movie' || categoryMap[c.group] === 'movie').slice(0, 20), [channels, categoryMap]);
  const series = useMemo(() => channels.filter(c => c.type === 'series' || categoryMap[c.group] === 'series').slice(0, 20), [channels, categoryMap]);
  const continueWatching = useMemo(() => Object.values(watchHistory).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10).map(h => channels.find(c => c.id === h.channelId)).filter(Boolean) as Channel[], [watchHistory, channels]);

  const hero = movies[0] || liveChannels[0] || channels[0];

  const playChannel = useCallback((ch: Channel) => {
    navigation.navigate('Player', { url: ch.url, title: ch.name, subtitle: ch.group, poster: ch.logo, channelId: ch.id, isLive: ch.type === 'live' });
  }, [navigation]);

  const renderCard = ({ item }: { item: Channel }) => (
    <TouchableOpacity style={styles.card} onPress={() => playChannel(item)} activeOpacity={0.8}>
      {item.logo
        ? <Image source={{ uri: item.logo }} style={styles.cardImg} resizeMode="cover" />
        : <View style={[styles.cardImg, styles.cardPlaceholder]}><Text style={styles.cardPlaceholderText}>🎬</Text></View>
      }
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.cardGrad} />
      <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.headerLogo}>WideTV</Text>
            <TouchableOpacity onPress={() => clearPlaylist().then(() => navigation.navigate('Setup'))}>
              <Text style={styles.headerChange}>Trocar Lista</Text>
            </TouchableOpacity>
          </View>

          {hero && (
            <TouchableOpacity style={styles.hero} onPress={() => playChannel(hero)} activeOpacity={0.9}>
              {hero.logo
                ? <Image source={{ uri: hero.logo }} style={styles.heroBg} resizeMode="cover" />
                : <LinearGradient colors={['#1565D4', '#0a0f1e']} style={styles.heroBg} />
              }
              <LinearGradient colors={['transparent', 'rgba(10,15,30,0.95)']} style={styles.heroOverlay} />
              <View style={styles.heroContent}>
                <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>EM DESTAQUE</Text></View>
                <Text style={styles.heroTitle} numberOfLines={2}>{hero.name}</Text>
                <Text style={styles.heroSub}>{hero.group}</Text>
                <TouchableOpacity style={styles.heroBtn} onPress={() => playChannel(hero)}>
                  <LinearGradient colors={['#1565D4', '#00C8E8']} style={styles.heroBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                    <Text style={styles.heroBtnText}>▶  Assistir</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}

          {continueWatching.length > 0 && <Section title="▶ Continuar Assistindo" channels={continueWatching} renderCard={renderCard} />}
          {liveChannels.length > 0 && <Section title="📡 Ao Vivo" channels={liveChannels} renderCard={renderCard} />}
          {movies.length > 0 && <Section title="🎬 Filmes" channels={movies} renderCard={renderCard} />}
          {series.length > 0 && <Section title="📺 Séries" channels={series} renderCard={renderCard} />}
          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Section({ title, channels, renderCard }: { title: string; channels: Channel[]; renderCard: ({ item }: { item: Channel }) => React.ReactElement }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <FlatList data={channels} renderItem={renderCard} keyExtractor={item => item.id} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} ItemSeparatorComponent={() => <View style={{ width: 10 }} />} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0f1e' },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  headerLogo: { fontSize: 22, fontWeight: '900', color: '#ffffff', letterSpacing: 1 },
  headerChange: { fontSize: 13, color: '#00C8E8', fontWeight: '600' },
  hero: { width, height: 280, marginBottom: 20 },
  heroBg: { ...StyleSheet.absoluteFillObject },
  heroOverlay: { ...StyleSheet.absoluteFillObject },
  heroContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20 },
  heroBadge: { backgroundColor: 'rgba(21,101,212,0.8)', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 8 },
  heroBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  heroTitle: { fontSize: 24, fontWeight: '800', color: '#ffffff', marginBottom: 4, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  heroSub: { fontSize: 13, color: 'rgba(143,163,192,0.9)', marginBottom: 14 },
  heroBtn: { alignSelf: 'flex-start', borderRadius: 12, overflow: 'hidden' },
  heroBtnGrad: { paddingHorizontal: 22, paddingVertical: 11 },
  heroBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#ffffff', paddingHorizontal: 18, marginBottom: 12 },
  row: { paddingHorizontal: 18 },
  card: { width: CARD_W, height: CARD_H, borderRadius: 12, overflow: 'hidden', backgroundColor: '#111827' },
  cardImg: { width: CARD_W, height: CARD_H },
  cardPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a2540' },
  cardPlaceholderText: { fontSize: 32 },
  cardGrad: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  cardName: { position: 'absolute', bottom: 8, left: 8, right: 8, fontSize: 11, color: '#ffffff', fontWeight: '600', lineHeight: 15 },
});
