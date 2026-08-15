import React, { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomNav, { Tab } from '../ui/BottomNav';
import HomeScreen from './HomeScreen';
import SearchScreen from './SearchScreen';
import LibraryScreen from './LibraryScreen';

export default function MainScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('home');

  return (
    <View className="flex-1 bg-[#121212]">
      <View className="flex-1">
        {tab === 'home' && <HomeScreen />}
        {tab === 'search' && <SearchScreen />}
        {tab === 'library' && <LibraryScreen />}
      </View>
      {/* The mini player is rendered globally by MiniPlayerOverlay. */}
      <View style={{ paddingBottom: insets.bottom }}>
        <BottomNav active={tab} onChange={setTab} />
      </View>
    </View>
  );
}
