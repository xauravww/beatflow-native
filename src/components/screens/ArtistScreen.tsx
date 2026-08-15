import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  RouteProp,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { searchSongs } from '../../api/client';
import { usePlayer } from '../../context/PlayerContext';
import { useCachedData } from '../../hooks/useCachedData';
import { formatTime } from '../../utils/format';
import TrackRow from '../ui/TrackRow';
import EmptyState from '../ui/EmptyState';
import { ListSkeleton } from '../ui/ListSkeleton';

type Route = RouteProp<RootStackParamList, 'Artist'>;

export default function ArtistScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { artistName } = route.params;
  const { playQueue, currentSong } = usePlayer();

  // Session-cached per-artist tracks: instant on revisit, background refresh.
  const { data, loading } = useCachedData(
    `artist:${artistName}`,
    () => searchSongs(artistName, 30),
    { persist: true },
  );
  const songs = data ?? [];

  return (
    <View className="flex-1" style={{ backgroundColor: '#121212' }}>
      <View
        className="flex-row items-center justify-between px-4 py-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <View className="flex-row items-center flex-1">
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Icon name="chevron-back" size={28} color="#ffffff" />
          </TouchableOpacity>
          <Text className="text-white font-bold text-lg ml-2" numberOfLines={1}>
            Artist
          </Text>
        </View>
        {songs.length > 0 && (
          <Pressable
            onPress={() => playQueue(songs, 0)}
            className="w-11 h-11 bg-[#1ed760] rounded-full items-center justify-center"
          >
            <Icon name="play" size={20} color="#000000" style={{ marginLeft: 2 }} />
          </Pressable>
        )}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
      >
        <View className="items-center pt-6 pb-6">
          <View className="w-28 h-28 rounded-full bg-[#282828] items-center justify-center overflow-hidden">
            {songs[0]?.cover ? (
              <Image source={{ uri: songs[0].cover }} className="w-full h-full" />
            ) : (
              <Icon name="person" size={52} color="rgba(255,255,255,0.4)" />
            )}
          </View>
          <Text className="text-white text-3xl font-bold mt-4 px-6 text-center">
            {artistName}
          </Text>
          <Text className="text-white/50 text-sm mt-1">
            {songs.length} popular tracks
          </Text>
        </View>

        {loading ? (
          <ListSkeleton rows={10} />
        ) : songs.length === 0 ? (
          <EmptyState
            icon="person-outline"
            message="No tracks found for this artist."
          />
        ) : (
          songs.map((song, i) => (
            <TrackRow
              key={song.id}
              song={song}
              isCurrent={currentSong?.id === song.id}
              duration={
                song.duration ? formatTime(song.duration) : undefined
              }
              onPress={() => playQueue(songs, i)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
