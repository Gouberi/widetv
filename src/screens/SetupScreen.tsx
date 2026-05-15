import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Animated, Switch,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RootStackParamList } from '../../App';
import { usePlaylist } from '../context/PlaylistContext';
import WideTVLogo from '../components/WideTVLogo';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'Setup'> };
type TabType = 'url' | 'paste';

export default function SetupScreen({ navigation }: Props) {
  const { loadFromUrl, loadFromText, isLoading, loadError, isLoaded } = usePlaylist();
  const [activeTab, setActiveTab] = useState<TabType>('url');
  const [urlValue, setUrlValue] = useState('');
  const [pasteValue, setPasteValue] = useState('');
  const [useProxy, setUseProxy] = useState(false);
  const [localError, setLocalError] = useState('');
  const tabAnim = useRef(new Animated.Value(0)).current;

  const switchTab = (tab: TabType) => {
    setActiveTab(tab);
    setLocalError('');
    Animated.timing(tabAnim, { toValue: tab === 'url' ? 0 : 1, duration: 200, useNativeDriver: false }).start();
  };

  const handleLoadUrl = async () => {
    const url = urlValue.trim();
    if (!url) { setLocalError('Insira uma URL válida'); return; }
    if (!url.startsWith('http')) { setLocalError('A URL deve começar com http:// ou https://'); return; }
    setLocalError('');
    try {
      await loadFromUrl(url, useProxy);
      navigation.replace('Main');
    } catch (e: any) { setLocalError(e.message || 'Erro ao carregar'); }
  };

  const handleLoadPaste = async () => {
    const text = pasteValue.trim();
    if (!text) { setLocalError('Cole o conteúdo M3U no campo acima'); return; }
    setLocalError('');
    try {
      await loadFromText(text);
      navigation.replace('Main');
    } catch (e: any) { setLocalError(e.message || 'Erro ao processar'); }
  };

  const error = localError || loadError;

  return (
    <LinearGradient colors={['#0a0f1e', '#0d1830', '#091528']} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        {/* Botão de voltar — visível quando há playlist (acessado via "Trocar Lista") */}
        {isLoaded && navigation.canGoBack() && (
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnTxt}>←  Voltar</Text>
          </TouchableOpacity>
        )}
        <View style={[styles.orb, styles.orb1]} />
        <View style={[styles.orb, styles.orb2]} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.logoSection}>
              <WideTVLogo size={90} />
              <Text style={styles.brandName}>WideTV</Text>
              <Text style={styles.tagline}>Bem-vindo à sua experiência de streaming</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Inserir Playlist M3U</Text>
              <Text style={styles.cardDesc}>Sua playlist será salva automaticamente para próximas sessões</Text>

              <View style={styles.tabsRow}>
                <TouchableOpacity style={[styles.tabBtn, activeTab === 'url' && styles.tabBtnActive]} onPress={() => switchTab('url')} activeOpacity={0.7}>
                  <Text style={[styles.tabText, activeTab === 'url' && styles.tabTextActive]}>🔗 URL</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tabBtn, activeTab === 'paste' && styles.tabBtnActive]} onPress={() => switchTab('paste')} activeOpacity={0.7}>
                  <Text style={[styles.tabText, activeTab === 'paste' && styles.tabTextActive]}>📋 Colar</Text>
                </TouchableOpacity>
              </View>

              {activeTab === 'url' && (
                <View style={styles.tabContent}>
                  <View style={styles.inputWrapper}>
                    <Text style={styles.inputIcon}>🌐</Text>
                    <TextInput style={styles.input} placeholder="http://seu.servidor.com/lista.m3u" placeholderTextColor="rgba(143,163,192,0.5)" value={urlValue} onChangeText={setUrlValue} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" onSubmitEditing={handleLoadUrl} />
                  </View>
                  <View style={styles.corsNote}>
                    <Text style={styles.corsNoteText}>ℹ️ Se a URL não carregar, ative o proxy CORS abaixo</Text>
                  </View>
                  <View style={styles.proxyRow}>
                    <Text style={styles.proxyLabel}>Usar proxy CORS automático</Text>
                    <Switch value={useProxy} onValueChange={setUseProxy} trackColor={{ false: '#1e2a3a', true: '#1565D4' }} thumbColor={useProxy ? '#00C8E8' : '#8fa3c0'} />
                  </View>
                  <TouchableOpacity style={[styles.btnPrimary, isLoading && styles.btnDisabled]} onPress={handleLoadUrl} disabled={isLoading} activeOpacity={0.8}>
                    <LinearGradient colors={['#1565D4', '#00C8E8']} style={styles.btnGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                      {isLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>▶  Carregar Lista</Text>}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              )}

              {activeTab === 'paste' && (
                <View style={styles.tabContent}>
                  <TextInput style={styles.textarea} placeholder={`#EXTM3U\n#EXTINF:-1 group-title="News",Canal\nhttp://stream.url/canal.m3u8`} placeholderTextColor="rgba(143,163,192,0.4)" value={pasteValue} onChangeText={setPasteValue} multiline numberOfLines={8} autoCapitalize="none" autoCorrect={false} textAlignVertical="top" />
                  <TouchableOpacity style={[styles.btnPrimary, isLoading && styles.btnDisabled]} onPress={handleLoadPaste} disabled={isLoading} activeOpacity={0.8}>
                    <LinearGradient colors={['#1565D4', '#00C8E8']} style={styles.btnGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                      {isLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>▶  Carregar Lista</Text>}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              )}

              {!!error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>✕  {error}</Text>
                </View>
              )}
            </View>

            <View style={styles.saveNotice}>
              <Text style={styles.saveNoticeText}>💾 A playlist fica salva automaticamente. Você não precisará inserir novamente ao abrir o app.</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  backBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  backBtnTxt: { fontSize: 14, color: '#00C8E8', fontWeight: '600' },
  orb: { position: 'absolute', borderRadius: 999, opacity: 0.1 },
  orb1: { width: 250, height: 250, backgroundColor: '#1565D4', top: -60, left: -80 },
  orb2: { width: 180, height: 180, backgroundColor: '#00C8E8', bottom: 80, right: -40 },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  logoSection: { alignItems: 'center', marginBottom: 32, paddingTop: 16 },
  brandName: { fontSize: 32, fontWeight: '900', color: '#ffffff', letterSpacing: 2, marginTop: 12 },
  tagline: { fontSize: 13, color: 'rgba(143,163,192,0.8)', marginTop: 6, letterSpacing: 0.5 },
  card: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 24, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#ffffff', marginBottom: 6 },
  cardDesc: { fontSize: 13, color: 'rgba(143,163,192,0.8)', marginBottom: 20, lineHeight: 18 },
  tabsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 4, marginBottom: 20 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabBtnActive: { backgroundColor: 'rgba(21,101,212,0.4)', borderWidth: 1, borderColor: 'rgba(21,101,212,0.6)' },
  tabText: { fontSize: 14, color: 'rgba(143,163,192,0.7)', fontWeight: '500' },
  tabTextActive: { color: '#ffffff', fontWeight: '700' },
  tabContent: { gap: 12 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, gap: 10 },
  inputIcon: { fontSize: 16 },
  input: { flex: 1, paddingVertical: 14, fontSize: 14, color: '#ffffff' },
  corsNote: { backgroundColor: 'rgba(21,101,212,0.1)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: 'rgba(21,101,212,0.2)' },
  corsNoteText: { fontSize: 12, color: 'rgba(143,163,192,0.9)', lineHeight: 16 },
  proxyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  proxyLabel: { fontSize: 14, color: 'rgba(143,163,192,0.9)' },
  textarea: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 14, fontSize: 13, color: '#ffffff', minHeight: 150, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier' },
  btnPrimary: { borderRadius: 14, overflow: 'hidden', marginTop: 4 },
  btnDisabled: { opacity: 0.5 },
  btnGradient: { paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnText: { color: '#ffffff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  errorBox: { backgroundColor: 'rgba(220,50,50,0.1)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(220,50,50,0.3)', marginTop: 8 },
  errorText: { color: '#ff6b6b', fontSize: 13, lineHeight: 18 },
  saveNotice: { backgroundColor: 'rgba(0,200,232,0.06)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(0,200,232,0.15)' },
  saveNoticeText: { fontSize: 13, color: 'rgba(143,163,192,0.85)', textAlign: 'center', lineHeight: 18 },
});
