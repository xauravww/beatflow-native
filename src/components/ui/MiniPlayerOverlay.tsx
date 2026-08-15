import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { navigationRef } from '../../navigation/navigationRef';
import { usePlayer } from '../../context/PlayerContext';
import MiniPlayer from './MiniPlayer';

/** Height of the bottom tab bar (icons + label + paddings). */
const BOTTOM_NAV_HEIGHT = 60;

/**
 * Renders the mini player on top of every screen (tabs + pushed screens).
 * On the Main tabs it floats above the bottom tab bar; on pushed screens
 * (Playlist, Artist, Stats, …) it sits at the bottom above the system bar.
 *
 * Hidden on the FullPlayer — the full player has its own controls and the
 * overlay (rendered after the navigator) would otherwise sit on top of it
 * and block its bottom buttons.
 */
export default function MiniPlayerOverlay() {
  const insets = useSafeAreaInsets();
  const { currentSong } = usePlayer();
  const [onMain, setOnMain] = useState(true);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const update = () => {
      const route = navigationRef.getCurrentRoute();
      setOnMain(route?.name === 'Main');
      setHidden(route?.name === 'FullPlayer');
    };
    update();
    return navigationRef.addListener('state', update);
  }, []);

  if (!currentSong || hidden) {
    return null;
  }

  const bottom = onMain
    ? BOTTOM_NAV_HEIGHT + insets.bottom
    : insets.bottom;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { bottom }]}
    >
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
