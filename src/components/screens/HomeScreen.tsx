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
import { Song } from '../../api/types';
import { getRecentPlays } from '../../db/history';
import { getPlaylists } from '../../db/playlists';
import { useCachedData } from '../../hooks/useCachedData';
import { usePlayer } from '../../context/PlayerContext';
import { getGreeting } from '../../utils/format';
import { colors } from '../../theme/colors';
import TrackCard from '../ui/TrackCard';
import SectionHeader from '../ui/SectionHeader';
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const playSongs = (songs: Song[], index: number) => {
    playQueue(songs, index);
    navigation.navigate('FullPlayer');
  };
  const openArtist = (name: string) =>
    navigation.navigate('Artist', { artistName: name });

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
          <Text className="text-white text-[26px] font-bold">{getGreeting()}</Text>
          <Text className="text-white/50 text-sm">🎵 BeatFlow</Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate('SpotifySync')}
          className="w-9 h-9 rounded-full bg-[#282828] items-center justify-center"
        >
          <Icon name="sync-outline" size={18} color="#ffffff" />
        </Pressable>
      </View>

      {loading && !sections ? (
        <HomeSkeleton />
      ) : !sections || sections.local.length === 0 ? (
        <View className="items-center justify-center py-32 px-10">
          <Icon name="cloud-offline-outline" size={48} color="rgba(255,255,255,0.25)" />
          <Text className="text-white/50 text-center mt-4 text-sm">
            Couldn't reach the music server. Make sure your backend is running,
            then pull to refresh.
          </Text>
        </View>
      ) : (
        <>
          {/* Recently played */}
          {recent.length > 0 && (
            <>
              <SectionHeader title="Recently Played" />
              <HorizontalRow
                songs={recent}
                onPlay={playSongs}
                onArtistPress={openArtist}
              />
            </>
          )}

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

          {/* Trending near you — 2-column grid */}
          <SectionHeader
            title="Trending Near You"
            subtitle={`Top hits in ${sections.country}`}
          />
          <View className="flex-row flex-wrap px-4 gap-3">
            {sections.local.map((song, i) => (
              <View key={song.id} className="w-[48%]">
                <TrackCard
                  song={song}
                  onPlay={() => playSongs(sections.local, i)}
                  onArtistPress={() => openArtist(song.artist)}
                />
              </View>
            ))}
          </View>

          {/* Horizontal rows */}
          {sections.topHits.length > 0 && (
            <>
              <SectionHeader title="Global Top Hits" />
              <HorizontalRow
                songs={sections.topHits}
                onPlay={playSongs}
                onArtistPress={openArtist}
              />
            </>
          )}
          {sections.trending.length > 0 && (
            <>
              <SectionHeader title="Trending Pop Music" />
              <HorizontalRow
                songs={sections.trending}
                onPlay={playSongs}
                onArtistPress={openArtist}
              />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function HomeSkeleton() {
  return (
    <View className="px-4 pt-4">
      <Skeleton className="h-7 w-44 mb-6" />
      <View className="flex-row flex-wrap gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} className="w-[48%]">
            <Skeleton className="w-full aspect-square rounded-md" />
            <Skeleton className="h-3 w-3/4 mt-2" />
            <Skeleton className="h-3 w-1/2 mt-1.5" />
          </View>
        ))}
      </View>
    </View>
  );
}

function HorizontalRow({
  songs,
  onPlay,
  onArtistPress,
}: {
  songs: Song[];
  onPlay: (songs: Song[], index: number) => void;
  onArtistPress?: (artistName: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
    >
      {songs.map((song, i) => (
        <View key={song.id} className="w-[150px]">
          <TrackCard
            song={song}
            onPlay={() => onPlay(songs, i)}
            onArtistPress={
              onArtistPress ? () => onArtistPress(song.artist) : undefined
            }
          />
        </View>
      ))}
    </ScrollView>
  );
}
