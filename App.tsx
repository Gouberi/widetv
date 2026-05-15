import React from 'react';
import { LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { PlaylistProvider } from './src/context/PlaylistContext';
import SplashScreen from './src/screens/SplashScreen';
import SetupScreen from './src/screens/SetupScreen';
import MainTabNavigator from './src/screens/MainTabNavigator';
import PlayerScreen from './src/screens/PlayerScreen';

LogBox.ignoreLogs(['Non-serializable values were found in the navigation state']);

export type RootStackParamList = {
  Splash: undefined;
  Setup: undefined;
  Main: undefined;
  Player: {
    url: string;
    title: string;
    subtitle?: string;
    poster?: string;
    channelId: string;
    isLive?: boolean;
    tvgId?: string;
    variants?: Array<{ label: string; url: string; id: string }>;
  };
};

const Stack = createStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PlaylistProvider>
          <StatusBar style="light" backgroundColor="#0a0f1e" />
          <NavigationContainer>
            <Stack.Navigator
              initialRouteName="Splash"
              screenOptions={{
                headerShown: false,
                animation: 'fade',
                gestureEnabled: true,        // swipe back em todas as telas
                gestureDirection: 'horizontal',
              }}
            >
              <Stack.Screen
                name="Splash"
                component={SplashScreen}
                options={{ gestureEnabled: false }} // splash não tem swipe back
              />
              <Stack.Screen name="Setup" component={SetupScreen} />
              <Stack.Screen
                name="Main"
                component={MainTabNavigator}
                options={{ gestureEnabled: false }} // raiz do app não tem swipe back
              />
              <Stack.Screen
                name="Player"
                component={PlayerScreen}
                options={{ animation: 'slide_from_bottom', gestureDirection: 'vertical' }}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </PlaylistProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
