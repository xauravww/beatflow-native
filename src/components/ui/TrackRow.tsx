import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Song } from '../../api/types';
import { useTrackOptions } from './TrackOptionsSheet';

export default function TrackRow({
  song,
  onPress,
  subtitle,
  trailing,
  onArtistPress,
  isCurrent,
  duration,
  hideOptions,
}: {
  song: Song;
  onPress?: () => void;
  subtitle?: string;
  trailing?: React.ReactNode;
  onArtistPress?: () => void;
  /** Highlight the title (the track that's currently playing). */
  isCurrent?: boolean;
  /** Formatted duration shown on the right, before the options button. */
  duration?: string;
  /** Hide the ⋯ options button (e.g. when the row is embedded elsewhere). */
  hideOptions?: boolean;
}) {
  const subtitleText = subtitle ?? song.artist;
  const { openOptions } = useTrackOptions();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-2 active:bg-white/5"
    >
      <Image source={{ uri: song.cover }} className="w-12 h-12 rounded" />
      <View className="flex-1 ml-3 min-w-0">
        <Text
          numberOfLines={1}
          className={`text-sm font-medium ${
            isCurrent ? 'text-[#1ed760]' : 'text-white'
          }`}
        >
          {song.title}
        </Text>
        {onArtistPress ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onArtistPress();
            }}
          >
            <Text
              numberOfLines={1}
              className={`text-xs ${
                isCurrent ? 'text-[#1ed760]/80' : 'text-white/60'
              }`}
            >
              {subtitleText}
            </Text>
          </Pressable>
        ) : (
          <Text
            numberOfLines={1}
            className={`text-xs ${
              isCurrent ? 'text-[#1ed760]/80' : 'text-white/60'
            }`}
          >
            {subtitleText}
          </Text>
        )}
      </View>
      {duration ? (
        <Text className="text-white/40 text-xs mr-4">{duration}</Text>
      ) : null}
      {!hideOptions && (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            openOptions(song);
          }}
          hitSlop={10}
          className="p-1 mr-1"
        >
          <Icon
            name="ellipsis-horizontal"
            size={20}
            color="rgba(255,255,255,0.7)"
          />
        </Pressable>
      )}
      {trailing}
    </Pressable>
  );
}
