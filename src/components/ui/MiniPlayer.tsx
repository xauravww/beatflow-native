import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useProgress } from 'react-native-track-player';
import { usePlayer } from '../../context/PlayerContext';
import { isSongSaved, removeSavedSong, saveSong } from '../../db/songs';
import { useSwipeCarousel } from '../../hooks/useSwipeCarousel';
import { Song } from '../../api/types';
import PressableScale from './PressableScale';
import Artwork from './Artwork';

/** Horizontal gap between carousel bars (must match useSwipeCarousel). */
const ITEM_GAP = 10;

export default function MiniPlayer() {
  const {
    currentSong,
    isPlaying,
    isBuffering,
    togglePlay,
    next,
    skipNext,
    skipPrevious,
    openPlayer,
    getSwipeTargets,
  } = usePlayer();
  const { width: windowWidth } = useWindowDimensions();
  const [saved, setSaved] = useState(false);
  const heartScale = useRef(new Animated.Value(1)).current;
  // swipe left/right → scroll to next/prev track; swipe up → pull up player.
  // Swipes use skipNext/skipPrevious so a drag is always a track change.
  const gesture = useSwipeCarousel({
    next: skipNext,
    previous: skipPrevious,
    onPullUp: openPlayer,
    getSwipeTargets,
    currentSongId: currentSong?.id ?? null,
  });

  // bar width = window minus the mx-2 margins
  const itemWidth = windowWidth - 16;

  useEffect(() => {
    let mounted = true;
    if (currentSong) {
      isSongSaved(currentSong.id)
        .then((s) => {
          if (mounted) {
            setSaved(s);
          }
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, [currentSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentSong) {
    return null;
  }

  const toggleSave = async () => {
    if (saved) {
      await removeSavedSong(currentSong.id);
      setSaved(false);
    } else {
      await saveSong(currentSong);
      setSaved(true);
    }
    // heart pop micro-interaction
    Animated.sequence([
      Animated.timing(heartScale, {
        toValue: 1.4,
        duration: 110,
        useNativeDriver: true,
      }),
      Animated.spring(heartScale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 18,
        bounciness: 14,
      }),
    ]).start();
  };

  const { prevSong, nextSong } = gesture;

  return (
    <Animated.View
      className="mx-2 my-1.5"
      style={{ transform: [{ translateY: gesture.translateY }] }}
    >
      {/* clip the carousel row to one bar's width */}
      <View
        {...gesture.panHandlers}
        onLayout={gesture.onLayout}
        style={{ width: itemWidth, overflow: 'hidden', borderRadius: 8 }}
      >
        <Animated.View
          style={{
            flexDirection: 'row',
            // shift the row so the *current* bar occupies the visible slot
            // even when a prev bar is rendered ahead of it
            marginLeft: gesture.rowOffset(itemWidth),
            transform: [{ translateX: gesture.translateX }],
          }}
        >
          {prevSong && (
            <MiniBarView key={prevSong.id} song={prevSong} width={itemWidth} />
          )}
          <MiniBarView
            key={currentSong.id}
            song={currentSong}
            width={itemWidth}
            onPress={openPlayer}
            saved={saved}
            heartScale={heartScale}
            onToggleSave={toggleSave}
            isPlaying={isPlaying}
            isBuffering={isBuffering}
            onTogglePlay={togglePlay}
            onNext={next}
          />
          {nextSong && (
            <MiniBarView key={nextSong.id} song={nextSong} width={itemWidth} />
          )}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/**
 * One carousel bar. Only the current track gets the controls — the
 * neighboring bars are read-only previews that peek in while swiping.
 */
function MiniBarView({
  song,
  width,
  onPress,
  saved,
  heartScale,
  onToggleSave,
  isPlaying,
  isBuffering,
  onTogglePlay,
  onNext,
}: {
  song: Song;
  width: number;
  onPress?: () => void;
  saved?: boolean;
  heartScale?: Animated.Value;
  onToggleSave?: () => void;
  isPlaying?: boolean;
  isBuffering?: boolean;
  onTogglePlay?: () => void;
  onNext?: () => void;
}) {
  const current = !!onPress;
  return (
    <View style={{ width, marginRight: ITEM_GAP }}>
      <Pressable
        onPress={onPress}
        className="flex-row items-center bg-[#282828] rounded-md px-2 py-2 overflow-hidden"
      >
        <Artwork songId={song.id} uri={song.cover} className="w-11 h-11 rounded" />
        <View className="flex-1 ml-3 min-w-0">
          <Text numberOfLines={1} className="text-white text-sm font-semibold">
            {song.title}
          </Text>
          <Text numberOfLines={1} className="text-white/60 text-xs">
            {song.artist}
          </Text>
        </View>
        {current &&
          heartScale &&
          onToggleSave &&
          onTogglePlay &&
          onNext && (
            <>
              <PressableScale
                onPress={onToggleSave}
                scaleTo={0.75}
                hitSlop={10}
                className="mr-3"
              >
                <Animated.View style={{ transform: [{ scale: heartScale }] }}>
                  <Icon
                    name={saved ? 'heart' : 'heart-outline'}
                    size={20}
                    color={saved ? '#1ed760' : 'rgba(255,255,255,0.8)'}
                  />
                </Animated.View>
              </PressableScale>
              <PressableScale
                onPress={(e) => {
                  e.stopPropagation();
                  onTogglePlay();
                }}
                scaleTo={0.8}
                hitSlop={10}
                className="mx-3"
              >
                {isBuffering ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Icon
                    name={isPlaying ? 'pause' : 'play'}
                    size={26}
                    color="#ffffff"
                  />
                )}
              </PressableScale>
              <PressableScale
                onPress={(e) => {
                  e.stopPropagation();
                  onNext();
                }}
                scaleTo={0.8}
                hitSlop={10}
              >
                <Icon name="play-skip-forward" size={24} color="#ffffff" />
              </PressableScale>
            </>
          )}
        {current && <MiniProgress />}
      </Pressable>
    </View>
  );
}

/** Thin progress bar pinned to the bottom edge of the mini player. */
function MiniProgress() {
  const { position, duration } = useProgress(500);
  const fraction = duration > 0 ? Math.min(position / duration, 1) : 0;
  return (
    <View className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/10">
      <View
        className="h-full bg-[#1ed760]"
        style={{ width: `${fraction * 100}%` }}
      />
    </View>
  );
}
