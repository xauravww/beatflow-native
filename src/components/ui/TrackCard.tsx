import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useProgress } from 'react-native-track-player';
import { Song } from '../../api/types';
import { usePlayer } from '../../context/PlayerContext';
import { useTrackOptions } from './TrackOptionsSheet';

export default function TrackCard({
  song,
  onPlay,
  onArtistPress,
}: {
  song: Song;
  onPlay: () => void;
  onArtistPress?: () => void;
}) {
  const { currentSong, isPlaying, isBuffering, loadingSongId, togglePlay } =
    usePlayer();
  const { openOptions } = useTrackOptions();
  const isCurrent = currentSong?.id === song.id;
  const isLoading = loadingSongId === song.id;

  const handlePress = () => {
    if (isLoading) {
      return; // already starting — ignore re-taps
    }
    if (isCurrent) {
      togglePlay();
    } else {
      onPlay();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      className="bg-[#181818] active:bg-[#282828] rounded-lg p-3"
    >
      <View className="relative">
        <Image
          source={{ uri: song.cover }}
          className="w-full aspect-square rounded-md"
        />
        {/* playhead for the currently playing track */}
        {isCurrent && <CardProgress />}
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            openOptions(song);
          }}
          hitSlop={8}
          className="absolute top-1.5 right-1.5 w-8 h-8 bg-black/50 rounded-full items-center justify-center"
        >
          <Icon
            name="ellipsis-horizontal"
            size={16}
            color="#ffffff"
          />
        </Pressable>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            handlePress();
          }}
          className="absolute bottom-1.5 right-1.5 w-10 h-10 bg-[#1ed760] rounded-full items-center justify-center shadow-lg"
        >
          {(isCurrent && isBuffering) || isLoading ? (
            <ActivityIndicator size="small" color="#000000" />
          ) : (
            <Icon
              name={isCurrent && isPlaying ? 'pause' : 'play'}
              size={18}
              color="#000000"
              style={{ marginLeft: isCurrent && isPlaying ? 0 : 2 }}
            />
          )}
        </Pressable>
      </View>
      <Text numberOfLines={1} className="text-white text-[13px] font-semibold mt-2">
        {song.title}
      </Text>
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          onArtistPress?.();
        }}
        disabled={!onArtistPress}
      >
        <Text numberOfLines={1} className="text-white/60 text-xs mt-0.5">
          {song.artist}
        </Text>
      </Pressable>
    </Pressable>
  );
}

/** Thin green progress bar at the bottom of the cover. */
function CardProgress() {
  const { position, duration } = useProgress(500);
  const fraction = duration > 0 ? Math.min(position / duration, 1) : 0;
  return (
    <View className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10">
      <View
        className="h-full bg-[#1ed760]"
        style={{ width: `${fraction * 100}%` }}
      />
    </View>
  );
}
