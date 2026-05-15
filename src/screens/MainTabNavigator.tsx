import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from './HomeScreen';
import { LiveScreen, MoviesScreen, SeriesScreen } from './LiveScreen';

const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = { Home: '🏠', Live: '📡', Movies: '🎬', Series: '📺' };
  return (
    <View style={tabStyles.iconWrap}>
      <Text style={[tabStyles.icon, focused && tabStyles.iconFocused]}>{icons[name]}</Text>
      {name === 'Live' && <View style={tabStyles.liveDot} />}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  iconWrap: { alignItems: 'center', position: 'relative' },
  icon: { fontSize: 22, opacity: 0.5 },
  iconFocused: { opacity: 1 },
  liveDot: { position: 'absolute', top: -2, right: -4, width: 7, height: 7, borderRadius: 4, backgroundColor: '#ff4444' },
});

export default function MainTabNavigator() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: '#0d1830', borderTopColor: 'rgba(255,255,255,0.07)', borderTopWidth: 1, height: 65, paddingBottom: 10, paddingTop: 8 }, tabBarActiveTintColor: '#00C8E8', tabBarInactiveTintColor: 'rgba(143,163,192,0.5)', tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 } }}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Início', tabBarIcon: ({ focused }) => <TabIcon name="Home" focused={focused} /> }} />
      <Tab.Screen name="Live" component={LiveScreen} options={{ tabBarLabel: 'Ao Vivo', tabBarIcon: ({ focused }) => <TabIcon name="Live" focused={focused} /> }} />
      <Tab.Screen name="Movies" component={MoviesScreen} options={{ tabBarLabel: 'Filmes', tabBarIcon: ({ focused }) => <TabIcon name="Movies" focused={focused} /> }} />
      <Tab.Screen name="Series" component={SeriesScreen} options={{ tabBarLabel: 'Séries', tabBarIcon: ({ focused }) => <TabIcon name="Series" focused={focused} /> }} />
    </Tab.Navigator>
  );
}
