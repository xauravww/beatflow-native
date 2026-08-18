import React, { useCallback } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { RootStackParamList } from '../../navigation/types';
import { fetchCollectionSongs } from '../../api/client';
import { usePlayer } from '../../context/PlayerContext';
import { useCachedData } from '../../hooks/useCachedData';
import { formatTime } from '../../utils/format';
import TrackRow from '../ui/TrackRow';
import EmptyState from '../ui/EmptyState';
import { ListSkeleton } from '../ui/ListSkeleton';

type Route = RouteProp<RootStackParamList, 'YtPlaylist'>;

/**
 * A playlist or album tapped in the home feed. Its tracks come from YouTube
 * Music on demand — nothing is stored locally until the user saves songs,
 * so this is a read-through view rather than a library playlist.
 */
export default function YtPlaylistScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { collectionId, name, cover, subtitle, type } = route.params;
  const { playQueue, currentSong } = usePlayer();

  const fetchSongs = useCallback(
    () => fetchCollectionSongs(collectionId),
    [collectionId],
  );
  const { data, loading } = useCachedData(
    `ytcollection:${collectionId}`,
    fetchSongs,
    { persist: true },
  );
  const songs = data ?? [];
  const heroCover = cover || songs[0]?.cover;

  const openArtist = (artistName: string) =>
    navigation.navigate('Artist', { artistName });

  return (
    <View className="flex-1" style={{ backgroundColor: '#121212' }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 118 }}
      >
        <View>
          {heroCover ? (
            <View
              className="absolute top-0 left-0 right-0 overflow-hidden"
              style={{ height: 340 }}
            >
              <Image source={{ uri: heroCover }} style={styles.backdropImage} />
              <View
                className="absolute inset-0"
                style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
              />
              <View
                className="absolute bottom-0 left-0 right-0"
                style={{ height: 56, backgroundColor: '#121212' }}
              />
            </View>
          ) : null}

          <View
            className="flex-row items-center px-2"
            style={{ paddingTop: insets.top + 4 }}
          >
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              hitSlop={12}
              className="p-2"
            >
              <Icon name="chevron-back" size={28} color="#ffffff" />
            </TouchableOpacity>
            <Text
              className="text-white font-bold text-base ml-1 flex-1"
              numberOfLines={1}
            >
              {name}
            </Text>
          </View>

          <View className="flex-row items-end px-5 pt-6">
            <View
              className="w-[136px] h-[136px] rounded-lg bg-[#282828] items-center justify-center overflow-hidden"
              style={styles.coverShadow}
            >
              {heroCover ? (
                <Image source={{ uri: heroCover }} className="w-full h-full" />
              ) : (
                <Icon
                  name="musical-notes"
                  size={40}
                  color="rgba(255,255,255,0.4)"
                />
              )}
            </View>
            <View className="flex-1 ml-5">
              <Text className="text-white/60 text-[11px] font-bold tracking-[0.2em]">
                {(type ?? 'playlist').toUpperCase()}
              </Text>
              <Text
                className="text-white text-[24px] font-extrabold leading-7 mt-1"
                numberOfLines={3}
              >
                {name}
              </Text>
              {subtitle ? (
                <Text
                  className="text-white/60 text-[13px] font-medium mt-2"
                  numberOfLines={2}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </View>

          <View className="flex-row items-center px-5 mt-6 pb-4">
            {songs.length > 0 && (
              <>
                <Pressable
                  onPress={() => playQueue(songs, 0)}
                  className="w-14 h-14 bg-[#1ed760] rounded-full items-center justify-center"
                  style={styles.playShadow}
                >
                  <Icon
                    name="play"
                    size={26}
                    color="#000000"
                    style={{ marginLeft: 2 }}
                  />
                </Pressable>
                <Text className="text-white/60 text-[13px] font-medium ml-4">
                  {songs.length} songs
                </Text>
              </>
            )}
          </View>
        </View>

        {loading && songs.length === 0 ? (
          <ListSkeleton rows={8} />
        ) : songs.length === 0 ? (
          <EmptyState
            icon="cloud-offline-outline"
            message="Couldn't load this playlist — it may be private or unavailable in your region."
          />
        ) : (
          songs.map((song, i) => (
            <TrackRow
              key={song.id}
              song={song}
              isCurrent={currentSong?.id === song.id}
              duration={song.duration ? formatTime(song.duration) : undefined}
              onPress={() => playQueue(songs, i)}
              onArtistPress={() => openArtist(song.artist)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdropImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 460,
    transform: [{ scale: 1.3 }],
  },
  coverShadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  playShadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 10,
  },
});
