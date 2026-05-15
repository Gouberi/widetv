// UX RULES - WideTV
// 1. Nenhuma tela bloqueia a thread JS por mais de 16ms
// 2. Todo toque deve ter feedback visual em menos de 100ms
// 3. Gesture de swipe back habilitado em todas as telas filhas
// 4. SafeAreaInsets aplicado em todas as telas
// 5. Loading nunca trava a navegação — sempre roda em background
// 6. Toda lista tem getItemLayout, windowSize e maxToRenderPerBatch

import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import * as ScreenOrientation from 'expo-screen-orientation';
import { RootStackParamList } from '../../App';
import { usePlaylist } from '../context/PlaylistContext';
import WideTVLogo from '../components/WideTVLogo';

type Props = { navigation: StackNavigationProp<RootStackParamList, 'Splash'> };

const { height } = Dimensions.get('window');

function getLoadingMessage(pct: number, isLoading: boolean): string {
  if (!isLoading && pct === 0) return 'Preparando antena...';
  if (isLoading && pct === 0)  return 'Captando sinal...';
  if (pct < 25)  return 'Sintonizando canais...';
  if (pct < 50)  return 'Carregando filmes...';
  if (pct < 75)  return 'Carregando séries...';
  if (pct < 100) return 'Organizando sua biblioteca...';
  return 'Quase lá...';
}

export default function SplashScreen({ navigation }: Props) {
  const { isLoaded, isLoading, parseProgress, playlistSource } = usePlaylist();

  // ── Bounce animation ────────────────────────────────────────────────────
  const bounceY          = useRef(new Animated.Value(0)).current;
  const bounceSc         = useRef(new Animated.Value(1)).current;
  const fadeOut          = useRef(new Animated.Value(1)).current;
  const barWidth         = useRef(new Animated.Value(0)).current;
  const navigated        = useRef(false);
  const isLoadedRef      = useRef(isLoaded);
  const playlistSourceRef = useRef(playlistSource);
  isLoadedRef.current      = isLoaded;
  playlistSourceRef.current = playlistSource;

  const doNavigate = useCallback((dest: 'Main' | 'Setup') => {
    if (navigated.current) return;
    navigated.current = true;
    Animated.timing(fadeOut, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => {
      navigation.replace(dest);
    });
  }, [navigation, fadeOut]);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);

    // Bounce loop
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(bounceY, { toValue: -14, duration: 380, useNativeDriver: true }),
          Animated.timing(bounceSc, { toValue: 1.08, duration: 380, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(bounceY, { toValue: 0, duration: 380, useNativeDriver: true }),
          Animated.timing(bounceSc, { toValue: 1.0, duration: 380, useNativeDriver: true }),
        ]),
      ]),
    ).start();

    // Após 2s decidir o destino:
    // - Sem source → Setup (onboarding)
    // - Com cache já carregado → Main imediatamente
    // - Com source mas sem cache → FICAR na tela aguardando isLoaded
    const timer = setTimeout(() => {
      const hasSource = !!playlistSourceRef.current;
      if (!hasSource) {
        doNavigate('Setup');
      } else if (isLoadedRef.current) {
        doNavigate('Main');
      }
      // Se hasSource && !isLoaded: permanece na splash mostrando progresso
      // até isLoaded mudar (veja o useEffect abaixo)
    }, 2000);

    return () => clearTimeout(timer);
  }, [doNavigate]);

  // Quando isLoaded muda para true (caso sem cache): navegar para Main após 500ms
  // para que o usuário veja brevemente "Quase lá..." na barra
  useEffect(() => {
    if (isLoaded) {
      const t = setTimeout(() => doNavigate('Main'), 500);
      return () => clearTimeout(t);
    }
  }, [isLoaded, doNavigate]);

  // Animar barra de progresso conforme parseProgress avança
  useEffect(() => {
    Animated.timing(barWidth, {
      toValue: parseProgress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [parseProgress]);

  return (
    <Animated.View style={[styles.root, { opacity: fadeOut }]}>
      <LinearGradient
        colors={['#0a0f1e', '#0d1830', '#091528']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
      />

      {/* Orbs de fundo */}
      <View style={[styles.orb, styles.orb1]} />
      <View style={[styles.orb, styles.orb2]} />

      {/* Logo saltitante */}
      <Animated.View style={[
        styles.logoWrap,
        { transform: [{ translateY: bounceY }, { scale: bounceSc }] },
      ]}>
        <WideTVLogo size={110} />
        <Text style={styles.brand}>WideTV</Text>
      </Animated.View>

      {/* Barra de progresso + mensagem */}
      <View style={styles.progressSection}>
        <Text style={styles.progressMsg}>{getLoadingMessage(parseProgress, isLoading)}</Text>

        {/* Track */}
        <View style={styles.barTrack}>
          <Animated.View style={[
            styles.barFill,
            {
              width: barWidth.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}>
            <LinearGradient
              colors={['#1565D4', '#00C8E8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>

        {parseProgress > 0 && (
          <Text style={styles.progressPct}>{Math.round(parseProgress)}%</Text>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0f1e',
  },
  orb: { position: 'absolute', borderRadius: 999, opacity: 0.1 },
  orb1: { width: 280, height: 280, backgroundColor: '#1565D4', top: height * 0.08, left: -90 },
  orb2: { width: 200, height: 200, backgroundColor: '#00C8E8', bottom: height * 0.12, right: -60 },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 52,
  },
  brand: {
    fontSize: 38,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 3,
    marginTop: 18,
    textShadowColor: 'rgba(0,200,232,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  progressSection: {
    position: 'absolute',
    bottom: 70,
    left: 36,
    right: 36,
    alignItems: 'center',
    gap: 10,
  },
  progressMsg: {
    fontSize: 13,
    color: 'rgba(143,163,192,0.85)',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  barTrack: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressPct: {
    fontSize: 11,
    color: 'rgba(0,200,232,0.7)',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
