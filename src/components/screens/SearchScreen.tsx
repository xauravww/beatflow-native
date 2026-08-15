import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { searchSongs } from '../../api/client';
import { Song } from '../../api/types';
import { usePlayer } from '../../context/PlayerContext';
import { saveSong } from '../../db/songs';
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
} from '../../db/recentSearches';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import {
  searchSpotify,
  SpotifySearchResults,
  SpotifyTrack,
} from '../../services/spotifyData';
import {
  matchSpotifyTrackToSong,
  syncAlbumFromUrl,
  syncPlaylistFromUrl,
} from '../../services/spotifySync';
import TrackCard from '../ui/TrackCard';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import SpotifyResults from '../ui/SpotifySearchResults';

const SUGGESTIONS = [
  'Trending Pop Music',
  'Lo-fi Beats',
  '90s Hits',
  'Hindi Love Songs',
  'Arijit Singh',
  'EDM Party Mix',
  'Chill Acoustic',
  'Bollywood Dance',
];

export default function SearchScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { playQueue, openPlayer, showToast } = usePlayer();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Spotify search state
  const [spotifyResults, setSpotifyResults] =
    useState<SpotifySearchResults | null>(null);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [importJob, setImportJob] = useState<{
    label: string;
    done: number;
    total: number;
  } | null>(null);
  const jobRef = useRef<{ label: string; done: number; total: number } | null>(
    null,
  );

  useEffect(() => {
    getRecentSearches().then(setRecentSearches).catch(() => {});
  }, []);

  const runSearch = async (q: string) => {
    const term = q.trim();
    if (!term) {
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    setSearched(true);
    setSpotifyResults(null);
    setSpotifyError(null);
    // YouTube songs (the app's core) + Spotify (artists/playlists/albums)
    const [data, sp] = await Promise.all([
      searchSongs(term, 24).catch(() => [] as Song[]),
      searchSpotify(term).catch((e: any) => {
        setSpotifyError(e?.message || 'Spotify search unavailable.');
        return null;
      }),
    ]);
    setResults(data);
    setSpotifyResults(sp);
    if (data.length > 0 || sp) {
      await addRecentSearch(term);
      setRecentSearches(await getRecentSearches());
    }
    setLoading(false);
  };

  const openArtist = (name: string) =>
    navigation.navigate('Artist', { artistName: name });

  /** Match a Spotify track to YouTube and play it immediately. */
  const playSpotifyTrack = useCallback(
    async (track: SpotifyTrack) => {
      setMatchingId(track.id);
      setSpotifyError(null);
      try {
        const song = await matchSpotifyTrackToSong(track);
        if (!song) {
          setSpotifyError(`Could not find "${track.name}" on YouTube.`);
          return;
        }
        await playQueue([song]);
        openPlayer();
      } catch (e: any) {
        setSpotifyError(e?.message || 'Could not play that track.');
      } finally {
        setMatchingId(null);
      }
    },
    [playQueue, openPlayer],
  );

  /** Match a Spotify track to YouTube and save it to Your Library. */
  const saveSpotifyTrack = useCallback(
    async (track: SpotifyTrack) => {
      setMatchingId(track.id);
      setSpotifyError(null);
      try {
        const song = await matchSpotifyTrackToSong(track);
        if (!song) {
          setSpotifyError(`Could not find "${track.name}" on YouTube.`);
          return;
        }
        await saveSong(song);
        showToast('💚 Saved to your Library');
      } catch (e: any) {
        setSpotifyError(e?.message || 'Could not save that track.');
      } finally {
        setMatchingId(null);
      }
    },
    [showToast],
  );

  /** Import a Spotify playlist/album with a live progress bar. */
  const runImport = useCallback(
    async (
      label: string,
      fn: (
        p: (done: number, total: number) => void,
      ) => Promise<number | { count: number }>,
    ) => {
      if (jobRef.current) {
        return;
      }
      setSpotifyError(null);
      const job = { label, done: 0, total: 1 };
      jobRef.current = job;
      setImportJob(job);
      try {
        const count = await fn((done, total) => {
          const next = { label, done, total };
          jobRef.current = next;
          setImportJob(next);
        });
        const n = typeof count === 'number' ? count : count.count;
        showToast(`✅ ${n} tracks synced — find them in Library → Playlists.`);
      } catch (e: any) {
        setSpotifyError(e?.message || 'Import failed. Try again.');
      } finally {
        jobRef.current = null;
        setImportJob(null);
      }
    },
    [showToast],
  );

  const importPlaylist = useCallback(
    (id: string, name: string) => {
      runImport(name, (p) =>
        syncPlaylistFromUrl(
          `https://open.spotify.com/playlist/${id}`,
          p,
        ).then((r) => r.count),
      );
    },
    [runImport],
  );

  const importAlbum = useCallback(
    (id: string, name: string) => {
      runImport(name, (p) =>
        syncAlbumFromUrl(`https://open.spotify.com/album/${id}`, p).then(
          (r) => r.count,
        ),
      );
    },
    [runImport],
  );

  const progressFraction =
    importJob && importJob.total > 0 ? importJob.done / importJob.total : 0;

  return (
    <View className="flex-1" style={{ backgroundColor: '#121212' }}>
      <View style={{ paddingTop: insets.top + 12 }} className="px-4">
        <Text className="text-white text-[26px] font-bold mb-4">Search</Text>
        <View className="flex-row items-center bg-white rounded-full px-4 py-3">
          <Icon name="search" size={20} color="#000000" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => runSearch(query)}
            returnKeyType="search"
            placeholder="Songs, artists, playlists…"
            placeholderTextColor="rgba(0,0,0,0.5)"
            className="flex-1 ml-2 text-black font-medium text-[15px]"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Icon name="close-circle" size={20} color="rgba(0,0,0,0.5)" />
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <View className="px-4 pt-4">
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
      ) : results.length > 0 || spotifyResults ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          keyboardShouldPersistTaps="handled"
        >
          {importJob ? (
            <View className="bg-[#181818] rounded-xl p-4 mb-4">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-white/80 text-[13px] font-medium">
                  Importing {importJob.label}…
                </Text>
                <Text className="text-white/60 text-xs">
                  {importJob.done}/{importJob.total}
                </Text>
              </View>
              <View className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <View
                  className="h-full bg-[#1ed760] rounded-full"
                  style={{ width: `${Math.round(progressFraction * 100)}%` }}
                />
              </View>
              <Text className="text-white/40 text-xs mt-2">
                Matching tracks to YouTube…
              </Text>
            </View>
          ) : null}

          {spotifyError ? (
            <Text className="text-red-400 text-[13px] mb-3">
              {spotifyError}
            </Text>
          ) : null}

          {/* Songs from YouTube — play instantly */}
          {results.length > 0 && (
            <>
              <Text className="text-white/60 text-xs font-semibold tracking-widest mb-3">
                SONGS
              </Text>
              <View className="flex-row flex-wrap gap-3">
                {results.map((song, i) => (
                  <View key={song.id} className="w-[48%]">
                    <TrackCard
                      song={song}
                      onPlay={() => {
                        playQueue(results, i);
                        navigation.navigate('FullPlayer');
                      }}
                      onArtistPress={() => openArtist(song.artist)}
                    />
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Spotify — artists, playlists, albums, tracks */}
          <SpotifyResults
            results={spotifyResults}
            matchingId={matchingId}
            disabled={!!importJob}
            onPlayTrack={playSpotifyTrack}
            onSaveTrack={saveSpotifyTrack}
            onImportPlaylist={importPlaylist}
            onImportAlbum={importAlbum}
            onOpenArtist={openArtist}
          />

          {results.length === 0 && !spotifyResults && (
            <EmptyState
              icon="musical-notes-outline"
              message="No results found. Try a different search."
            />
          )}
        </ScrollView>
      ) : searched ? (
        <EmptyState
          icon="musical-notes-outline"
          message="No results found. Try a different search."
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {recentSearches.length > 0 && (
            <>
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-white/60 text-xs font-semibold tracking-widest">
                  RECENT
                </Text>
                <Pressable
                  onPress={async () => {
                    await clearRecentSearches();
                    setRecentSearches([]);
                  }}
                >
                  <Text className="text-white/50 text-xs font-semibold">
                    Clear all
                  </Text>
                </Pressable>
              </View>
              <View className="flex-row flex-wrap gap-2 mb-6">
                {recentSearches.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => {
                      setQuery(s);
                      runSearch(s);
                    }}
                    className="bg-[#282828] rounded-full px-4 py-2.5 active:bg-[#3a3a3a]"
                  >
                    <Text className="text-white text-sm font-medium">
                      <Icon name="time-outline" size={14} color="rgba(255,255,255,0.5)" />{' '}
                      {s}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <Text className="text-white/60 text-xs font-semibold tracking-widest mb-3">
            BROWSE
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                onPress={() => {
                  setQuery(s);
                  runSearch(s);
                }}
                className="bg-[#282828] rounded-full px-4 py-2.5 active:bg-[#3a3a3a]"
              >
                <Text className="text-white text-sm font-medium">{s}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
