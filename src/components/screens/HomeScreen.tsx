import React, { useCallback, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { RootStackParamList } from '../../navigation/types';
import { fetchHomeSections } from '../../api/client';
import { ShelfItem, Song } from '../../api/types';
import { getRecentPlays } from '../../db/history';
import { getPlaylists } from '../../db/playlists';
import { useCachedData } from '../../hooks/useCachedData';
import { usePlayer } from '../../context/PlayerContext';
import { getGreeting } from '../../utils/format';
import { colors } from '../../theme/colors';
import SectionHeader from '../ui/SectionHeader';
import ShelfRow from '../ui/ShelfRow';
import Skeleton from '../ui/Skeleton';

export default function HomeScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { playQueue } = usePlayer();
  const [refreshing, setRefreshing] = useState(false);

  // Home feed is persisted to SQLite — after the first load it renders
  // instantly on every later visit / launch and refreshes in the background.
  const fetchHome = useCallback(async () => {
    const [data, history, pls] = await Promise.all([
      fetchHomeSections(),
      getRecentPlays(12),
      getPlaylists(),
    ]);
    return { sections: data, recent: history, playlists: pls };
  }, []);
  const { data, loading, refresh } = useCachedData('home', fetchHome, {
    persist: true,
  });

  const sections = data?.sections ?? null;
  const recent = data?.recent ?? [];
  const playlists = data?.playlists ?? [];
  const shelves = sections?.shelves ?? [];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const playSongs = useCallback(
    (songs: Song[], index: number) => {
      playQueue(songs, index);
      navigation.navigate('FullPlayer');
    },
    [navigation, playQueue],
  );
  const openArtist = useCallback(
    (name: string) => navigation.navigate('Artist', { artistName: name }),
    [navigation],
  );
  const openCollection = useCallback(
    (item: Extract<ShelfItem, { kind: 'collection' }>) => {
      navigation.navigate('YtPlaylist', {
        collectionId: item.id,
        name: item.title,
        cover: item.cover,
        subtitle: item.subtitle,
        type: item.type,
      });
    },
    [navigation],
  );

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: '#121212' }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 110 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.greenBright}
        />
      }
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 mb-2">
        <View>
          <Text className="text-white text-[26px] font-bold">
            {getGreeting()}
          </Text>
          <Text className="text-white/50 text-sm">🎵 BeatFlow</Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate('SpotifySync')}
          className="w-9 h-9 rounded-full bg-[#282828] items-center justify-center"
        >
          <Icon name="sync-outline" size={18} color="#ffffff" />
        </Pressable>
      </View>

      {/* Spotify's shortcut grid: the last things you played, two per row. */}
      {recent.length > 0 && (
        <View className="flex-row flex-wrap px-4 mt-3 gap-2">
          {recent.slice(0, 6).map((song, i) => (
            <Pressable
              key={song.id}
              onPress={() => playSongs(recent, i)}
              className="w-[48.5%] flex-row items-center bg-white/10 active:bg-white/20 rounded-md overflow-hidden"
            >
              <Image source={{ uri: song.cover }} className="w-[52px] h-[52px]" />
              <Text
                numberOfLines={2}
                className="flex-1 text-white text-[12px] font-bold px-2"
              >
                {song.title}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {loading && shelves.length === 0 ? (
        <HomeSkeleton />
      ) : (
        <>
          {/* Your playlists — quick access */}
          {playlists.length > 0 && (
            <>
              <SectionHeader title="Your Playlists" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              >
                {playlists.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() =>
                      navigation.navigate('Playlist', {
                        playlistId: p.id,
                        name: p.name,
                      })
                    }
                    className="w-[150px] active:opacity-70"
                  >
                    <View className="w-full aspect-square rounded-md bg-[#282828] items-center justify-center overflow-hidden">
                      {p.cover ? (
                        <Image
                          source={{ uri: p.cover }}
                          className="w-full h-full"
                        />
                      ) : (
                        <Icon
                          name="musical-notes"
                          size={40}
                          color="rgba(255,255,255,0.4)"
                        />
                      )}
                    </View>
                    <Text
                      numberOfLines={1}
                      className="text-white text-[13px] font-semibold mt-2"
                    >
                      {p.name}
                    </Text>
                    <Text className="text-white/50 text-xs mt-0.5">
                      Playlist · {p.songCount} songs
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}

          {shelves.length === 0 ? (
            <View className="items-center justify-center py-24 px-10">
              <Icon
                name="cloud-offline-outline"
                size={48}
                color="rgba(255,255,255,0.25)"
              />
              <Text className="text-white/50 text-center mt-4 text-sm">
                Couldn't reach YouTube Music. Check your connection, then pull
                to refresh.
              </Text>
            </View>
          ) : (
            /* The real YouTube Music feed — localized shelves, in its order. */
            shelves.map((shelf, i) => (
              <View key={`${shelf.title}-${i}`}>
                <SectionHeader
                  title={shelf.title}
                  subtitle={
                    i === 0 && sections?.country
                      ? `Popular in ${sections.country}`
                      : undefined
                  }
                />
                <ShelfRow
                  shelf={shelf}
                  onPlaySongs={playSongs}
                  onOpenCollection={openCollection}
                  onOpenArtist={openArtist}
                />
              </View>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function HomeSkeleton() {
  return (
    <View className="pt-6">
      {[0, 1].map((row) => (
        <View key={row}>
          <Skeleton className="h-6 w-44 mb-4 ml-4" />
          <View className="flex-row px-4 gap-3 mb-7">
            {Array.from({ length: 3 }).map((_, i) => (
              <View key={i} className="w-[150px]">
                <Skeleton className="w-full aspect-square rounded-md" />
                <Skeleton className="h-3 w-3/4 mt-2" />
                <Skeleton className="h-3 w-1/2 mt-1.5" />
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
