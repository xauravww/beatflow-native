import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import TrackPlayer, { useProgress } from 'react-native-track-player';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../context/PlayerContext';
import {
  fetchLyrics,
  LyricsResult,
} from '../../services/lyricsService';
import {
  deleteDownload,
  downloadTrack,
  hasDownload,
} from '../../services/downloadService';
import {
  isSongSaved,
  removeSavedSong,
  saveSong,
  upsertSong,
} from '../../db/songs';
import {
  addSongToPlaylist,
  createPlaylist,
  getPlaylists,
  Playlist,
} from '../../db/playlists';
import { formatTime } from '../../utils/format';
import { useSwipeCarousel } from '../../hooks/useSwipeCarousel';
import { Song } from '../../api/types';
import LyricsView from './LyricsView';
import PressableScale from '../ui/PressableScale';
import Toast from '../ui/Toast';
import { colors } from '../../theme/colors';

type Mode = 'player' | 'lyrics' | 'queue';

export default function FullPlayer() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const {
    currentSong,
    isPlaying,
    isBuffering,
    loadingSongId,
    queue,
    currentIndex,
    repeat,
    shuffle,
    togglePlay,
    next,
    previous,
    toggleRepeat,
    toggleShuffle,
    playAt,
    addToQueue,
    closePlayer,
    getSwipeTargets,
  } = usePlayer();
  const { position, duration } = useProgress(500);

  const [mode, setMode] = useState<Mode>('player');
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [playlistVisible, setPlaylistVisible] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showVolume, setShowVolume] = useState(false);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [sleepModalVisible, setSleepModalVisible] = useState(false);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartScale = useRef(new Animated.Value(1)).current;
  // swipe the artwork left/right to scroll to the next/prev track
  const artworkGesture = useSwipeCarousel({
    next,
    previous,
    enabled: mode === 'player',
    getSwipeTargets,
    currentSongId: currentSong?.id ?? null,
  });
  const { width: windowWidth } = useWindowDimensions();
  // cover width = window minus the px-8 (32px each side) container padding
  const coverWidth = windowWidth - 64;

  useEffect(() => {
    TrackPlayer.getVolume().then(setVolume).catch(() => {});
  }, []);

  useEffect(
    () => () => {
      if (sleepTimerRef.current) {
        clearTimeout(sleepTimerRef.current);
      }
    },
    [],
  );

  // refresh per-track state
  useEffect(() => {
    setMode('player');
    setLyrics(null);
    setDownloadProgress(null);
    if (!currentSong) {
      return;
    }
    let mounted = true;
    (async () => {
      const [isSaved, isDownloaded] = await Promise.all([
        isSongSaved(currentSong.id),
        hasDownload(currentSong),
      ]);
      if (!mounted) {
        return;
      }
      setSaved(isSaved);
      setDownloaded(isDownloaded);
    })();
    setLyricsLoading(true);
    fetchLyrics(currentSong).then((result) => {
      if (!mounted) {
        return;
      }
      setLyrics(result);
      setLyricsLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [currentSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSave = useCallback(async () => {
    if (!currentSong) {
      return;
    }
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
  }, [currentSong, saved, heartScale]);

  const handleDownload = useCallback(async () => {
    if (!currentSong) {
      return;
    }
    if (downloaded) {
      await deleteDownload(currentSong);
      setDownloaded(false);
      return;
    }
    setDownloadProgress(0);
    const path = await downloadTrack(currentSong, setDownloadProgress);
    setDownloadProgress(null);
    if (path) {
      await upsertSong(currentSong);
      setDownloaded(true);
    }
  }, [currentSong, downloaded]);

  const openPlaylistSheet = useCallback(async () => {
    setOptionsVisible(false);
    setPlaylists(await getPlaylists());
    setPlaylistVisible(true);
  }, []);

  const handleCreatePlaylist = useCallback(async () => {
    const name = newPlaylistName.trim();
    if (!name) {
      return;
    }
    setCreatingPlaylist(true);
    const id = await createPlaylist(name);
    if (currentSong) {
      await addSongToPlaylist(id, currentSong);
    }
    setNewPlaylistName('');
    setCreatingPlaylist(false);
    setPlaylists(await getPlaylists());
  }, [newPlaylistName, currentSong]);

  const handleAddToPlaylist = useCallback(
    async (playlistId: number) => {
      if (currentSong) {
        await addSongToPlaylist(playlistId, currentSong);
      }
      setPlaylistVisible(false);
    },
    [currentSong],
  );

  const handleVolumeChange = useCallback((value: number) => {
    setVolume(value);
    TrackPlayer.setVolume(value);
  }, []);

  const startSleepTimer = useCallback((minutes: number) => {
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    if (minutes <= 0) {
      setSleepMinutes(null);
      return;
    }
    setSleepMinutes(minutes);
    sleepTimerRef.current = setTimeout(async () => {
      await TrackPlayer.pause();
      setSleepMinutes(null);
    }, minutes * 60 * 1000);
  }, []);

  if (!currentSong) {
    return (
      <View className="flex-1 bg-[#0d0d0d] items-center justify-center">
        <Text className="text-white/50">Nothing playing</Text>
      </View>
    );
  }

  const repeatIcon =
    repeat === 'one' ? 'repeat' : repeat === 'all' ? 'repeat' : 'repeat-outline';

  // neighboring tracks the swipe can actually reach (matches player behavior)
  const { prevSong, nextSong } = artworkGesture;

  return (
    <View className="flex-1 bg-[#0d0d0d]" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-2">
        <PressableScale onPress={closePlayer} scaleTo={0.85} hitSlop={12}>
          <Icon name="chevron-down" size={28} color="#ffffff" />
        </PressableScale>
        <Text className="text-white/50 text-[11px] font-semibold tracking-[0.15em]">
          NOW PLAYING
        </Text>
        <PressableScale
          onPress={() => setOptionsVisible(true)}
          scaleTo={0.85}
          hitSlop={12}
        >
          <Icon name="ellipsis-horizontal" size={24} color="#ffffff" />
        </PressableScale>
      </View>

      {/* Mode pills — Now Playing / Lyrics / Queue */}
      <View className="flex-row justify-center items-center gap-1.5 px-4 pt-1 pb-3">
        {(['player', 'lyrics', 'queue'] as Mode[]).map((m) => {
          const active = mode === m;
          const label =
            m === 'player' ? 'Now Playing' : m === 'lyrics' ? 'Lyrics' : 'Queue';
          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              className={`px-4 py-1.5 rounded-full ${
                active ? 'bg-white' : 'bg-white/10'
              }`}
            >
              <Text
                className={`text-[11px] font-bold ${
                  active ? 'text-black' : 'text-white/70'
                }`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Main area */}
      {mode === 'lyrics' ? (
        lyricsLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={colors.green} size="large" />
          </View>
        ) : (
          <LyricsView
            lines={lyrics?.synced ?? []}
            plain={lyrics?.plain}
            position={position}
            cover={currentSong.cover}
            duration={duration}
          />
        )
      ) : mode === 'queue' ? (
        <ScrollView className="flex-1 px-2">
          <Text className="text-white text-lg font-bold px-2 py-3">Up Next</Text>
          {queue.map((song, i) => {
            const isCurrent = i === currentIndex;
            return (
              <Pressable
                key={song.id}
                onPress={() => playAt(i)}
                className="flex-row items-center px-2 py-2 active:bg-white/5"
              >
                <Image
                  source={{ uri: song.cover }}
                  className="w-11 h-11 rounded"
                />
                <View className="flex-1 ml-3 min-w-0">
                  <Text
                    numberOfLines={1}
                    className={`text-sm ${isCurrent ? 'text-[#1ed760] font-semibold' : 'text-white'}`}
                  >
                    {song.title}
                  </Text>
                  <Text numberOfLines={1} className="text-white/60 text-xs">
                    {song.artist}
                  </Text>
                </View>
                {isCurrent && (
                  <Icon name="volume-high" size={18} color={colors.greenBright} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View className="flex-1 justify-center px-8">
          {/* swipeable cover carousel — neighbors peek in while dragging */}
          <View
            {...artworkGesture.panHandlers}
            onLayout={artworkGesture.onLayout}
            style={{ overflow: 'hidden', borderRadius: 8 }}
          >
            <Animated.View
              style={{
                flexDirection: 'row',
                transform: [{ translateX: artworkGesture.translateX }],
              }}
            >
              {prevSong && (
                <ArtworkCover song={prevSong} width={coverWidth} />
              )}
              <ArtworkCover song={currentSong} width={coverWidth} />
              {nextSong && (
                <ArtworkCover song={nextSong} width={coverWidth} />
              )}
            </Animated.View>
          </View>
          <View className="mt-8">
            <Text
              numberOfLines={2}
              className="text-white text-[22px] font-bold leading-7"
            >
              {currentSong.title}
            </Text>
            <Pressable
              onPress={() =>
                navigation.navigate('Artist', { artistName: currentSong.artist })
              }
            >
              <Text
                numberOfLines={1}
                className="text-white/60 text-base mt-1"
              >
                {currentSong.artist}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Progress bar (always visible so position is never lost) */}
      <SeekBar position={position} duration={duration} />

      {/* Controls */}
      <View className="flex-row items-center justify-between px-8 pb-5 mt-1">
        <PressableScale onPress={toggleShuffle} scaleTo={0.8} hitSlop={10}>
          <Icon
            name="shuffle"
            size={22}
            color={shuffle ? colors.greenBright : 'rgba(255,255,255,0.6)'}
          />
        </PressableScale>
        <PressableScale onPress={previous} scaleTo={0.8} hitSlop={10}>
          <Icon name="play-skip-back" size={34} color="#ffffff" />
        </PressableScale>
        <PressableScale
          onPress={togglePlay}
          scaleTo={0.88}
          className="w-[72px] h-[72px] bg-white rounded-full items-center justify-center"
        >
          {isBuffering || loadingSongId === currentSong.id ? (
            <ActivityIndicator size="large" color="#000000" />
          ) : (
            <Icon
              name={isPlaying ? 'pause' : 'play'}
              size={34}
              color="#000000"
              style={{ marginLeft: isPlaying ? 0 : 3 }}
            />
          )}
        </PressableScale>
        <PressableScale onPress={next} scaleTo={0.8} hitSlop={10}>
          <Icon name="play-skip-forward" size={34} color="#ffffff" />
        </PressableScale>
        <PressableScale onPress={toggleRepeat} scaleTo={0.8} hitSlop={10}>
          <Icon
            name={repeatIcon}
            size={22}
            color={repeat !== 'off' ? colors.greenBright : 'rgba(255,255,255,0.6)'}
          />
        </PressableScale>
      </View>

      {/* Volume */}
      {showVolume && mode === 'player' && (
        <View className="flex-row items-center px-8 pb-2">
          <Icon name="volume-medium" size={20} color="rgba(255,255,255,0.7)" />
          <Slider
            style={{ flex: 1, marginLeft: 8 }}
            minimumValue={0}
            maximumValue={1}
            value={volume}
            onValueChange={handleVolumeChange}
            minimumTrackTintColor="#ffffff"
            maximumTrackTintColor="rgba(255,255,255,0.2)"
            thumbTintColor="#ffffff"
          />
        </View>
      )}

      {/* Bottom icon row — save | volume · download */}
      <View
        className="flex-row items-center justify-between px-8"
        style={{ paddingBottom: Math.max(insets.bottom + 18, 28) }}
      >
        <PressableScale onPress={toggleSave} scaleTo={0.8} hitSlop={10}>
          <Animated.View style={{ transform: [{ scale: heartScale }] }}>
            <Icon
              name={saved ? 'heart' : 'heart-outline'}
              size={24}
              color={saved ? colors.greenBright : 'rgba(255,255,255,0.7)'}
            />
          </Animated.View>
        </PressableScale>
        <View className="flex-row items-center">
          <PressableScale
            onPress={() => setShowVolume((v) => !v)}
            scaleTo={0.8}
            hitSlop={10}
            className="mr-8"
          >
            <Icon
              name={volume === 0 ? 'volume-mute' : 'volume-high'}
              size={22}
              color={showVolume ? colors.greenBright : 'rgba(255,255,255,0.7)'}
            />
          </PressableScale>
          <PressableScale onPress={handleDownload} scaleTo={0.8} hitSlop={10}>
            {downloadProgress !== null ? (
              <View className="min-w-[26px] items-center">
                <Text className="text-[#1ed760] text-[11px] font-bold">
                  {Math.round(downloadProgress * 100)}%
                </Text>
              </View>
            ) : (
              <Icon
                name={downloaded ? 'download' : 'download-outline'}
                size={24}
                color={downloaded ? colors.greenBright : 'rgba(255,255,255,0.7)'}
              />
            )}
          </PressableScale>
        </View>
      </View>

      {/* Live download progress bar */}
      {downloadProgress !== null && (
        <View
          className="mx-8 h-[3px] bg-white/10 rounded-full overflow-hidden"
          style={{ marginBottom: Math.max(insets.bottom + 8, 12) }}
        >
          <View
            className="h-full bg-[#1ed760]"
            style={{ width: `${Math.round(downloadProgress * 100)}%` }}
          />
        </View>
      )}

      {/* Options sheet */}
      <Modal
        visible={optionsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setOptionsVisible(false)}
      >
        <Pressable
          className="flex-1 bg-black/60 justify-end"
          onPress={() => setOptionsVisible(false)}
        >
          <Pressable
            className="bg-[#282828] rounded-t-2xl p-4"
            style={{ paddingBottom: Math.max(insets.bottom + 16, 32) }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-3">
              <View className="w-10 h-1 rounded-full bg-white/20" />
            </View>
            <Text
              numberOfLines={1}
              className="text-white font-bold text-base mb-4"
            >
              {currentSong.title} — {currentSong.artist}
            </Text>
            <OptionRow
              icon={saved ? 'heart' : 'heart-outline'}
              label={saved ? 'Remove from Library' : 'Save to Library'}
              onPress={() => {
                setOptionsVisible(false);
                toggleSave();
              }}
            />
            <OptionRow
              icon="add-circle-outline"
              label="Add to Playlist"
              onPress={openPlaylistSheet}
            />
            <OptionRow
              icon="play-forward"
              label="Play Next"
              onPress={() => {
                setOptionsVisible(false);
                addToQueue(currentSong, true);
              }}
            />
            <OptionRow
              icon="list-outline"
              label="Add to Queue"
              onPress={() => {
                setOptionsVisible(false);
                addToQueue(currentSong, false);
              }}
            />
            <OptionRow
              icon="moon-outline"
              label={
                sleepMinutes
                  ? `Sleep Timer (${sleepMinutes} min)`
                  : 'Sleep Timer'
              }
              onPress={() => {
                setOptionsVisible(false);
                setSleepModalVisible(true);
              }}
            />
            <OptionRow
              icon={downloaded ? 'trash-outline' : 'download-outline'}
              label={downloaded ? 'Remove Download' : 'Download'}
              onPress={() => {
                setOptionsVisible(false);
                handleDownload();
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Playlist picker sheet */}
      <Modal
        visible={playlistVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPlaylistVisible(false)}
      >
        <KeyboardAvoidingView
          className="flex-1 bg-black/60 justify-end"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            className="flex-1"
            onPress={() => setPlaylistVisible(false)}
          />
          <Pressable
            className="bg-[#282828] rounded-t-2xl p-4"
            style={{ paddingBottom: Math.max(insets.bottom + 16, 32) }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-white font-bold text-base mb-4">
              Add to Playlist
            </Text>
            {playlists.map((p) => (
              <OptionRow
                key={p.id}
                icon="musical-note"
                label={`${p.name} (${p.songCount})`}
                onPress={() => handleAddToPlaylist(p.id)}
              />
            ))}
            <View className="flex-row items-center mt-3">
              <TextInput
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
                placeholder="New playlist name"
                placeholderTextColor="rgba(255,255,255,0.4)"
                className="flex-1 bg-white/10 rounded-full px-4 py-2.5 text-white text-sm"
              />
              <TouchableOpacity
                onPress={handleCreatePlaylist}
                disabled={!newPlaylistName.trim() || creatingPlaylist}
                className="ml-3 bg-[#1ed760] rounded-full px-4 py-2.5"
              >
                {creatingPlaylist ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text className="text-black font-bold text-sm">Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Toast (native modals are separate windows — render it here too) */}
      <Toast />

      {/* Sleep timer sheet */}
      <Modal
        visible={sleepModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSleepModalVisible(false)}
      >
        <Pressable
          className="flex-1 bg-black/60 justify-end"
          onPress={() => setSleepModalVisible(false)}
        >
          <Pressable
            className="bg-[#282828] rounded-t-2xl p-4"
            style={{ paddingBottom: Math.max(insets.bottom + 16, 32) }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-white font-bold text-base mb-3">
              Sleep Timer
            </Text>
            <Text className="text-white/50 text-sm mb-4">
              {sleepMinutes
                ? `Playback stops in ${sleepMinutes} minutes.`
                : 'Playback will pause after the chosen time.'}
            </Text>
            {[0, 5, 10, 15, 30, 60].map((minutes) => (
              <OptionRow
                key={minutes}
                icon={
                  sleepMinutes === minutes ? 'checkmark-circle' : 'time-outline'
                }
                label={minutes === 0 ? 'Off' : `${minutes} minutes`}
                onPress={() => {
                  startSleepTimer(minutes);
                  setSleepModalVisible(false);
                }}
              />
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** One artwork card in the swipe carousel (neighbors peek in while dragging). */
function ArtworkCover({ song, width }: { song: Song; width: number }) {
  return (
    <View style={{ width, marginRight: 10 }} className="shadow-2xl">
      <Image
        source={{ uri: song.cover }}
        className="w-full aspect-square rounded-md"
      />
    </View>
  );
}

function SeekBar({ position, duration }: { position: number; duration: number }) {
  // Track whether the user is actively dragging. On Android the slider fires
  // onValueChange when its `value` prop is set programmatically (position
  // updates every 500ms) — without this guard that feedback loop re-renders
  // forever and React throws "Maximum update depth exceeded".
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const shown = dragging ? dragValue : Math.min(position, duration || position);
  return (
    <View className="px-4 mb-2">
      <Slider
        minimumValue={0}
        maximumValue={duration || 1}
        value={shown}
        onSlidingStart={() => {
          setDragging(true);
          setDragValue(position);
        }}
        onValueChange={(value) => {
          // Ignore programmatic updates; only track real user drags.
          if (dragging) {
            setDragValue(value);
          }
        }}
        onSlidingComplete={(value) => {
          setDragging(false);
          TrackPlayer.seekTo(value);
        }}
        minimumTrackTintColor="#ffffff"
        maximumTrackTintColor="rgba(255,255,255,0.2)"
        thumbTintColor="#ffffff"
        style={{ height: 40 }}
      />
      <View className="flex-row justify-between px-1">
        <Text className="text-white/50 text-xs">{formatTime(shown)}</Text>
        <Text className="text-white/50 text-xs">{formatTime(duration)}</Text>
      </View>
    </View>
  );
}

function OptionRow({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center py-3 active:bg-white/5"
    >
      <Icon name={icon} size={22} color="rgba(255,255,255,0.8)" />
      <Text className="text-white text-[15px] font-medium ml-4">{label}</Text>
    </TouchableOpacity>
  );
}
