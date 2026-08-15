import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  clearSpotifySettings,
  getSpotifySetting,
  saveSpotifySetting,
} from '../../db/spotify';
import { saveSong } from '../../db/songs';
import {
  clearCachedToken,
  getSpotifyToken,
} from '../../services/spotifyToken';
import {
  fetchProfile,
  fetchUserPlaylists,
  searchSpotify,
  SpotifyPlaylistSummary,
  SpotifySearchResults,
  SpotifyTrack,
} from '../../services/spotifyData';
import {
  importSpotifyLink,
  matchSpotifyTrackToSong,
  syncAlbumFromUrl,
  syncArtistFromUrl,
  syncLikedSongs,
  syncOwnPlaylist,
  syncPlaylistFromUrl,
} from '../../services/spotifySync';
import { usePlayer } from '../../context/PlayerContext';
import SpotifyResults from '../ui/SpotifySearchResults';

interface SyncJob {
  label: string;
  done: number;
  total: number;
}

/** Quick-paste samples for the import box. */
const SAMPLES: { label: string; url: string }[] = [
  {
    label: 'Today\'s Top Hits',
    url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
  },
  {
    label: '÷ (Divide)',
    url: 'https://open.spotify.com/album/2XiT8ljTbXG9S0Q4dv6rV0',
  },
  {
    label: 'Ed Sheeran',
    url: 'https://open.spotify.com/artist/6eUKZXaKkcviH0Ku9w2n3V',
  },
];

export default function SpotifySyncScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { playQueue, openPlayer, showToast } = usePlayer();

  const [spDcInput, setSpDcInput] = useState('');
  const [hasCookie, setHasCookie] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([]);
  const [url, setUrl] = useState('');
  const [job, setJob] = useState<SyncJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const jobRef = useRef<SyncJob | null>(null);

  // Search state
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SpotifySearchResults | null>(null);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const runJob = useCallback(
    async (
      label: string,
      fn: (p: (done: number, total: number) => void) => Promise<number | { count: number }>,
    ) => {
      if (jobRef.current) {
        return;
      }
      setError(null);
      setInfo(null);
      setBusy(true);
      const job = { label, done: 0, total: 1 };
      jobRef.current = job;
      setJob(job);
      try {
        const count = await fn((done, total) => {
          const next = { label, done, total };
          jobRef.current = next;
          setJob(next);
        });
        const n = typeof count === 'number' ? count : count.count;
        setInfo(`✅ ${n} tracks synced — in Library → Playlists.`);
      } catch (e: any) {
        setError(e?.message || 'Sync failed. Try again.');
      } finally {
        jobRef.current = null;
        setJob(null);
        setBusy(false);
      }
    },
    [],
  );

  const refreshAccount = useCallback(async () => {
    try {
      await getSpotifyToken(true);
      const profile = await fetchProfile();
      setUsername(profile.displayName);
      const list = await fetchUserPlaylists();
      setPlaylists(list);
      setError(null);
    } catch (e: any) {
      setUsername(null);
      setPlaylists([]);
      setError(e?.message || 'Could not connect to Spotify.');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await getSpotifySetting('sp_dc');
      setHasCookie(!!saved);
      if (saved) {
        setSpDcInput(saved);
        refreshAccount();
      }
    })();
  }, [refreshAccount]);

  const saveCookie = useCallback(async () => {
    const cookie = spDcInput.trim();
    if (!cookie) {
      setError('Paste your sp_dc cookie first.');
      return;
    }
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await saveSpotifySetting('sp_dc', cookie);
      setHasCookie(true);
      clearCachedToken();
      await refreshAccount();
      setInfo('✅ Connected to Spotify.');
    } catch (e: any) {
      setError(e?.message || 'Could not connect with that cookie.');
    } finally {
      setBusy(false);
    }
  }, [spDcInput, refreshAccount]);

  const disconnect = useCallback(async () => {
    await clearSpotifySettings();
    clearCachedToken();
    setHasCookie(false);
    setUsername(null);
    setPlaylists([]);
    setSpDcInput('');
    setShowHint(false);
    setInfo('Disconnected.');
  }, []);

  const importUrl = useCallback(
    (link?: string) => {
      const target = link ?? url;
      const trimmed = target.trim();
      if (!trimmed) {
        setError('Paste a Spotify link first.');
        return;
      }
      runJob('Link', (p) =>
        importSpotifyLink(trimmed, p).then((r) => r.count),
      );
    },
    [url, runJob],
  );

  const syncLiked = useCallback(() => {
    runJob('Liked Songs', (p) => syncLikedSongs(p));
  }, [runJob]);

  const syncPlaylist = useCallback(
    (playlistId: string, name: string) => {
      runJob(name, (p) => syncOwnPlaylist(playlistId, name, p));
    },
    [runJob],
  );

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setSearchError('Type something to search Spotify.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      setResults(await searchSpotify(q));
    } catch (e: any) {
      setSearchError(e?.message || 'Search failed. Try again.');
    } finally {
      setSearching(false);
    }
  }, [query]);

  /** Match a search result to YouTube and play it immediately. */
  const playSearchTrack = useCallback(
    async (track: SpotifyTrack) => {
      setMatchingId(track.id);
      setSearchError(null);
      try {
        const song = await matchSpotifyTrackToSong(track);
        if (!song) {
          setSearchError(`Could not find "${track.name}" on YouTube.`);
          return;
        }
        await playQueue([song]);
        openPlayer();
      } catch (e: any) {
        setSearchError(e?.message || 'Could not play that track.');
      } finally {
        setMatchingId(null);
      }
    },
    [playQueue, openPlayer],
  );

  /** Match a search result to YouTube and save it to Your Library. */
  const saveSearchTrack = useCallback(
    async (track: SpotifyTrack) => {
      setMatchingId(track.id);
      setSearchError(null);
      try {
        const song = await matchSpotifyTrackToSong(track);
        if (!song) {
          setSearchError(`Could not find "${track.name}" on YouTube.`);
          return;
        }
        await saveSong(song);
        showToast('💚 Saved to your Library');
      } catch (e: any) {
        setSearchError(e?.message || 'Could not save that track.');
      } finally {
        setMatchingId(null);
      }
    },
    [showToast],
  );

  const importSearchPlaylist = useCallback(
    (id: string, name: string) => {
      runJob(name, (p) =>
        syncPlaylistFromUrl(
          `https://open.spotify.com/playlist/${id}`,
          p,
        ).then((r) => r.count),
      );
    },
    [runJob],
  );

  const importSearchAlbum = useCallback(
    (id: string, name: string) => {
      runJob(name, (p) =>
        syncAlbumFromUrl(`https://open.spotify.com/album/${id}`, p).then(
          (r) => r.count,
        ),
      );
    },
    [runJob],
  );

  const importSearchArtist = useCallback(
    (id: string, name: string) => {
      runJob(name, (p) =>
        syncArtistFromUrl(`https://open.spotify.com/artist/${id}`, p).then(
          (r) => r.count,
        ),
      );
    },
    [runJob],
  );

  const openArtist = (name: string) =>
    navigation.navigate('Artist', { artistName: name });

  const progressFraction =
    job && job.total > 0 ? job.done / job.total : 0;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: '#121212' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View
        className="flex-row items-center px-4 py-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="chevron-back" size={28} color="#ffffff" />
        </TouchableOpacity>
        <Text className="text-white font-bold text-lg ml-2 flex-1">
          Spotify
        </Text>
        <Icon name="logo-spotify" size={26} color="#1DB954" />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
        keyboardShouldPersistTaps="handled"
      >
        {job ? (
          <View className="bg-[#181818] rounded-2xl p-4 mb-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-white/80 text-[13px] font-medium">
                Syncing {job.label}…
              </Text>
              <Text className="text-white/60 text-xs">
                {job.done}/{job.total}
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

        {error ? (
          <View className="bg-[#2a1a1a] rounded-xl px-4 py-3 mb-3 flex-row items-start">
            <Icon
              name="alert-circle"
              size={16}
              color="#ff6b6b"
              style={{ marginTop: 2 }}
            />
            <Text className="text-white/85 text-[13px] ml-2 flex-1 leading-5">
              {error}
            </Text>
          </View>
        ) : null}
        {info ? (
          <View className="bg-[#12281d] rounded-xl px-4 py-3 mb-3 flex-row items-start">
            <Icon
              name="checkmark-circle"
              size={16}
              color="#1ed760"
              style={{ marginTop: 2 }}
            />
            <Text className="text-[#7dffa8] text-[13px] ml-2 flex-1 leading-5">
              {info}
            </Text>
          </View>
        ) : null}

        {/* ---- Your account ---- */}
        <SectionCard icon="logo-spotify" iconColor="#1DB954" title="Your account">
          {hasCookie ? (
            <>
              <View className="flex-row items-center mb-4">
                <View className="w-12 h-12 rounded-full bg-[#1DB954]/20 items-center justify-center">
                  <Icon name="logo-spotify" size={24} color="#1DB954" />
                </View>
                <View className="flex-1 ml-3">
                  <Text className="text-white font-bold">
                    {username || 'Spotify account'}
                  </Text>
                  <View className="flex-row items-center mt-0.5">
                    <View className="w-1.5 h-1.5 rounded-full bg-[#1ed760] mr-1.5" />
                    <Text className="text-[#1ed760] text-xs font-semibold">
                      Connected
                    </Text>
                  </View>
                </View>
                <TouchableOpacity onPress={disconnect} hitSlop={10}>
                  <Text className="text-white/50 text-[13px] font-semibold">
                    Disconnect
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={syncLiked}
                disabled={!!job}
                className="bg-[#1ed760] rounded-full py-3 items-center mb-4 active:opacity-90"
              >
                <Text className="text-black font-bold text-[15px]">
                  Sync Liked Songs
                </Text>
              </TouchableOpacity>

              <Text className="text-white/60 text-xs font-semibold tracking-widest mb-2">
                YOUR PLAYLISTS
              </Text>
              {playlists.length === 0 ? (
                <Text className="text-white/40 text-[13px] mb-2">
                  No playlists found.
                </Text>
              ) : (
                playlists.map((p) => (
                  <View
                    key={p.id}
                    className="flex-row items-center justify-between py-2.5"
                  >
                    <Text
                      className="text-white text-[14px] flex-1 mr-3"
                      numberOfLines={1}
                    >
                      {p.name}
                    </Text>
                    <TouchableOpacity
                      onPress={() => syncPlaylist(p.id, p.name)}
                      disabled={!!job}
                      className="bg-white/10 rounded-full px-3 py-1.5 active:bg-white/20"
                    >
                      <Text className="text-white text-[12px] font-semibold">
                        Sync
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </>
          ) : (
            <>
              <Text className="text-white/60 text-[13px] leading-5 mb-3">
                Sync your Liked Songs and playlists into BeatFlow. No login —
                just paste your <Text className="text-white">sp_dc</Text>{' '}
                cookie.
              </Text>
              <View className="flex-row items-center bg-white/5 rounded-lg px-3 mb-2">
                <TextInput
                  value={spDcInput}
                  onChangeText={setSpDcInput}
                  placeholder="Paste sp_dc cookie…"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  className="flex-1 py-3 text-white text-[14px]"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {busy ? (
                  <ActivityIndicator color="#1ed760" size="small" />
                ) : (
                  <TouchableOpacity
                    onPress={saveCookie}
                    className="bg-[#1ed760] rounded-full px-4 py-2"
                  >
                    <Text className="text-black font-bold text-[13px]">
                      Connect
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              {!showHint ? (
                <TouchableOpacity onPress={() => setShowHint(true)} hitSlop={8}>
                  <Text className="text-[#1ed760] text-[12px] font-semibold">
                    How to find it?
                  </Text>
                </TouchableOpacity>
              ) : (
                <View className="bg-white/5 rounded-lg p-3 mt-1">
                  <Text className="text-white/60 text-[12px] leading-5">
                    Open open.spotify.com → log in → DevTools → Application →
                    Cookies → open.spotify.com → copy the{' '}
                    <Text className="text-white">sp_dc</Text> value. Saved only
                    on this device.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowHint(false)}
                    hitSlop={8}
                    className="mt-1.5"
                  >
                    <Text className="text-white/40 text-[12px] font-semibold">
                      Hide
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </SectionCard>

        {/* ---- Import from link ---- */}
        <SectionCard icon="link-outline" title="Import from link">
          <Text className="text-white/60 text-[13px] leading-5 mb-3">
            Playlist, album, or artist — no login needed.
          </Text>
          <View className="flex-row items-center bg-white/5 rounded-lg px-3 mb-3">
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://open.spotify.com/playlist/…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              className="flex-1 py-3 text-white text-[14px]"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity
              onPress={() => importUrl()}
              disabled={!!job}
              className="bg-[#1ed760] rounded-full px-4 py-2"
            >
              <Text className="text-black font-bold text-[13px]">Import</Text>
            </TouchableOpacity>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <TouchableOpacity
                key={s.label}
                onPress={() => {
                  setUrl(s.url);
                  importUrl(s.url);
                }}
                disabled={!!job}
                className="bg-white/10 rounded-full px-3 py-1.5 active:bg-white/20"
              >
                <Text className="text-white text-[12px] font-semibold">
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </SectionCard>

        {/* ---- Search Spotify ---- */}
        <SectionCard icon="search-outline" title="Search Spotify">
          <Text className="text-white/60 text-[13px] leading-5 mb-3">
            Find tracks, artists, playlists, and albums.
          </Text>
          <View className="flex-row items-center bg-white/5 rounded-lg px-3 mb-3">
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={doSearch}
              returnKeyType="search"
              placeholder="Songs, artists, playlists…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              className="flex-1 py-3 text-white text-[14px]"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              onPress={doSearch}
              disabled={searching}
              className="bg-[#1ed760] rounded-full px-4 py-2"
            >
              {searching ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <Text className="text-black font-bold text-[13px]">
                  Search
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {searchError ? (
            <Text className="text-red-400 text-[13px] mb-2">{searchError}</Text>
          ) : null}

          {results &&
          results.tracks.length === 0 &&
          results.playlists.length === 0 &&
          results.albums.length === 0 &&
          results.artists.length === 0 ? (
            <Text className="text-white/40 text-[13px]">No results found.</Text>
          ) : null}

          <SpotifyResults
            results={results}
            matchingId={matchingId}
            disabled={!!job}
            onPlayTrack={playSearchTrack}
            onSaveTrack={saveSearchTrack}
            onImportPlaylist={importSearchPlaylist}
            onImportAlbum={importSearchAlbum}
            onImportArtist={importSearchArtist}
            onOpenArtist={openArtist}
          />
        </SectionCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Compact card with a green-accented icon + title. */
function SectionCard({
  icon,
  iconColor,
  title,
  children,
}: {
  icon: string;
  iconColor?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="bg-[#181818] rounded-2xl p-4 mb-4">
      <View className="flex-row items-center mb-3">
        <Icon
          name={icon}
          size={18}
          color={iconColor || '#1ed760'}
        />
        <Text className="text-white text-[16px] font-bold ml-2">{title}</Text>
      </View>
      {children}
    </View>
  );
}
