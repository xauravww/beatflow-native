import React from 'react';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { navigationRef } from './navigationRef';
import MainScreen from '../components/screens/MainScreen';
import MiniPlayerOverlay from '../components/ui/MiniPlayerOverlay';
import FullPlayer from '../components/player/FullPlayer';
import CreditsScreen from '../components/screens/CreditsScreen';
import SettingsScreen from '../components/screens/SettingsScreen';
import PlaylistScreen from '../components/screens/PlaylistScreen';
import ArtistScreen from '../components/screens/ArtistScreen';
import StatsScreen from '../components/screens/StatsScreen';
import SpotifySyncScreen from '../components/screens/SpotifySyncScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#121212',
    card: '#121212',
    text: '#ffffff',
    border: 'rgba(255,255,255,0.1)',
    primary: '#1DB954',
  },
};

export default function AppNavigator() {
  return (
    <NavigationContainer ref={navigationRef} theme={theme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#121212' },
        }}
      >
        <Stack.Screen name="Main" component={MainScreen} />
        <Stack.Screen
          name="FullPlayer"
          component={FullPlayer}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="Credits" component={CreditsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Playlist" component={PlaylistScreen} />
        <Stack.Screen name="Artist" component={ArtistScreen} />
        <Stack.Screen name="Stats" component={StatsScreen} />
        <Stack.Screen name="SpotifySync" component={SpotifySyncScreen} />
      </Stack.Navigator>
      {/* Mini player floats above every screen (hidden under FullPlayer). */}
      <MiniPlayerOverlay />
    </NavigationContainer>
  );
}
