import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { Song } from '../../api/types';
import { usePlayer } from '../../context/PlayerContext';
import {
  getPlaylistSongs,
  removeSongFromPlaylist,
  setPlaylistOrder,
} from '../../db/playlists';
import { downloadTrack } from '../../services/downloadService';
import { useCachedData } from '../../hooks/useCachedData';
import { colors } from '../../theme/colors';
import { formatTime } from '../../utils/format';
import TrackRow from '../ui/TrackRow';
import EmptyState from '../ui/EmptyState';
import { ListSkeleton } from '../ui/ListSkeleton';

type Route = RouteProp<RootStackParamList, 'Playlist'>;

/** "1 hr 2 min" style total, like Spotify's playlist header. */
function formatTotal(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (hrs > 0) {
    return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
  }
  return `${mins} min`;
}

export default function PlaylistScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { playlistId, name } = route.params;
  const { playQueue, currentSong } = usePlayer();

  // Session + SQLite-cached per-playlist data: instant on revisit/relaunch,
  // background refresh.
  const fetchSongs = useCallback(
    () => getPlaylistSongs(playlistId),
    [playlistId],
  );
  const { data, loading, refresh } = useCachedData(
    `playlist:${playlistId}`,
    fetchSongs,
    { persist: true },
  );

  // seed from the cache so the first paint already shows content
  const [songs, setSongs] = useState<Song[]>(data ?? []);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadCount, setDownloadCount] = useState(0);

  useEffect(() => {
    if (data) {
      setSongs(data);
    }
  }, [data]);

  // refresh on focus so songs added from the player show up
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const removeSong = useCallback(
    async (song: Song) => {
      await removeSongFromPlaylist(playlistId, song.id);
      setSongs((prev) => prev.filter((s) => s.id !== song.id));
    },
    [playlistId],
  );

  const moveSong = useCallback(
    async (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= songs.length) {
        return;
      }
      const reordered = [...songs];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      setSongs(reordered);
      await setPlaylistOrder(
        playlistId,
        reordered.map((s) => s.id),
      );
    },
    [playlistId, songs],
  );

  const downloadAll = useCallback(async () => {
    if (songs.length === 0) {
      return;
    }
    setDownloadingAll(true);
    setDownloadCount(0);
    for (const song of songs) {
      if (song.isDownloaded) {
        setDownloadCount((c) => c + 1);
        continue;
      }
      const path = await downloadTrack(song);
      if (path) {
        setDownloadCount((c) => c + 1);
      }
    }
    setDownloadingAll(false);
    setSongs(await getPlaylistSongs(playlistId));
  }, [songs, playlistId]);

  const openArtist = (artistName: string) =>
    navigation.navigate('Artist', { artistName });

  const cover = songs[0]?.cover;
  const totalSeconds = songs.reduce((acc, s) => acc + (s.duration || 0), 0);

  return (
    <View className="flex-1" style={{ backgroundColor: '#121212' }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 118 }}
      >
        {/* ---- Hero header ---- */}
        <View>
          {cover ? (
            <View
              className="absolute top-0 left-0 right-0 overflow-hidden"
              style={{ height: 340 }}
            >
              <Image
                source={{ uri: cover }}
                style={styles.backdropImage}
              />
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

          {/* back row */}
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

          {/* cover + info */}
          <View className="flex-row items-end px-5 pt-6">
            <View
              className="w-[136px] h-[136px] rounded-lg bg-[#282828] items-center justify-center overflow-hidden"
              style={styles.coverShadow}
            >
              {cover ? (
                <Image source={{ uri: cover }} className="w-full h-full" />
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
                PLAYLIST
              </Text>
              <Text
                className="text-white text-[26px] font-extrabold leading-8 mt-1"
                numberOfLines={2}
              >
                {name}
              </Text>
              <Text className="text-white/60 text-[13px] font-medium mt-2">
                {songs.length} songs
                {songs.length > 0 ? ` · ${formatTotal(totalSeconds)}` : ''}
              </Text>
            </View>
          </View>

          {/* actions */}
          <View className="flex-row items-center px-5 mt-6 pb-4">
            {songs.length > 0 && (
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
            )}
            <View className="flex-1" />
            {songs.length > 0 && (
              <Pressable
                onPress={downloadAll}
                disabled={downloadingAll}
                className="flex-row items-center border border-white/20 rounded-full px-4 py-2.5"
              >
                {downloadingAll ? (
                  <>
                    <ActivityIndicator
                      size="small"
                      color={colors.greenBright}
                    />
                    <Text className="text-white/80 text-[13px] font-semibold ml-2">
                      {downloadCount}/{songs.length}
                    </Text>
                  </>
                ) : (
                  <>
                    <Icon
                      name="download-outline"
                      size={18}
                      color="#ffffff"
                    />
                    <Text className="text-white text-[13px] font-semibold ml-2">
                      Download
                    </Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </View>

        {/* ---- Track list ---- */}
        {loading ? (
          <ListSkeleton rows={8} />
        ) : songs.length === 0 ? (
          <EmptyState
            icon="musical-notes-outline"
            message="This playlist is empty. Save songs to it from the player options."
          />
        ) : (
          <View>
            {songs.map((song, i) => (
              <TrackRow
                key={song.id}
                song={song}
                isCurrent={currentSong?.id === song.id}
                duration={
                  song.duration ? formatTime(song.duration) : undefined
                }
                onPress={() => playQueue(songs, i)}
                onArtistPress={() => openArtist(song.artist)}
                trailing={
                  <View className="flex-row items-center">
                    <View className="mr-3">
                      <TouchableOpacity
                        onPress={() => moveSong(i, -1)}
                        disabled={i === 0}
                        hitSlop={6}
                        className="p-1"
                      >
                        <Icon
                          name="chevron-up"
                          size={20}
                          color={
                            i === 0
                              ? 'rgba(255,255,255,0.2)'
                              : 'rgba(255,255,255,0.7)'
                          }
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => moveSong(i, 1)}
                        disabled={i === songs.length - 1}
                        hitSlop={6}
                        className="p-1"
                      >
                        <Icon
                          name="chevron-down"
                          size={20}
                          color={
                            i === songs.length - 1
                              ? 'rgba(255,255,255,0.2)'
                              : 'rgba(255,255,255,0.7)'
                          }
                        />
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      onPress={() => removeSong(song)}
                      hitSlop={10}
                    >
                      <Icon
                        name="close"
                        size={22}
                        color="rgba(255,255,255,0.6)"
                      />
                    </TouchableOpacity>
                  </View>
                }
              />
            ))}
          </View>
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
