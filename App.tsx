import './global.css';
import React, { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setupPlayer } from './src/services/trackPlayerService';
import { initDb } from './src/db/database';
import { getBackendBaseUrlSetting } from './src/db/settings';
import { hydrateScreenCaches } from './src/db/screenCache';
import { setCacheValue } from './src/hooks/cacheStore';
import { setCustomBackendBaseUrl } from './src/api/client';
import { PlayerProvider } from './src/context/PlayerContext';
import Toast from './src/components/ui/Toast';
import { TrackOptionsProvider } from './src/components/ui/TrackOptionsSheet';
import AppNavigator from './src/navigation/AppNavigator';

async function requestNotificationPermission() {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    try {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
    } catch (e) {
      console.log('Notification permission error:', e);
    }
  }
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      await initDb();
      // hydrate persisted screen caches BEFORE first paint so screens that
      // were opened before render instantly (no skeleton flash on relaunch)
      await hydrateScreenCaches(setCacheValue);
      setHydrated(true);
      // restore the custom backend URL override (if any) before any request
      const savedUrl = await getBackendBaseUrlSetting().catch(() => null);
      if (savedUrl) {
        setCustomBackendBaseUrl(savedUrl);
      }
      await setupPlayer();
      await requestNotificationPermission();
    })();
  }, []);

  if (!hydrated) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <PlayerProvider>
        <TrackOptionsProvider>
          <StatusBar barStyle="light-content" backgroundColor="#000000" />
          <AppNavigator />
          <Toast />
        </TrackOptionsProvider>
      </PlayerProvider>
    </SafeAreaProvider>
  );
}
