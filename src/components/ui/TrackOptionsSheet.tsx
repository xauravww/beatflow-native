import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Song } from '../../api/types';
import { usePlayer } from '../../context/PlayerContext';
import { isSongSaved, removeSavedSong, saveSong, upsertSong } from '../../db/songs';
import {
  addSongToPlaylist,
  createPlaylist,
  getPlaylists,
  Playlist,
} from '../../db/playlists';
import {
  deleteDownload,
  downloadTrack,
  hasDownload,
} from '../../services/downloadService';

interface TrackOptionsContextValue {
  /** Open the options sheet for a track (save, playlist, queue, download). */
  openOptions: (song: Song) => void;
  closeOptions: () => void;
}

const TrackOptionsContext = createContext<TrackOptionsContextValue | null>(
  null,
);

export function useTrackOptions(): TrackOptionsContextValue {
  const ctx = useContext(TrackOptionsContext);
  if (!ctx) {
    throw new Error('useTrackOptions must be used within TrackOptionsProvider');
  }
  return ctx;
}

/**
 * Per-track action sheet (⋯ on rows/cards): Save to Library, Add to
 * Playlist, Play Next, Add to Queue, Download. Mounted once at the root so
 * every screen gets it for free.
 */
export function TrackOptionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { addToQueue, showToast } = usePlayer();

  const [song, setSong] = useState<Song | null>(null);
  const [saved, setSaved] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [playlistVisible, setPlaylistVisible] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [newPlaylistMode, setNewPlaylistMode] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  const openOptions = useCallback(async (s: Song) => {
    setSong(s);
    setPlaylistVisible(false);
    const [isSaved, isDownloaded] = await Promise.all([
      isSongSaved(s.id),
      hasDownload(s),
    ]);
    setSaved(isSaved);
    setDownloaded(isDownloaded);
  }, []);

  const closeOptions = useCallback(() => setSong(null), []);

  const toggleSave = useCallback(async () => {
    if (!song) {
      return;
    }
    if (saved) {
      await removeSavedSong(song.id);
      setSaved(false);
      showToast('Removed from your Library');
    } else {
      await saveSong(song);
      setSaved(true);
      showToast('Saved to your Library');
    }
  }, [song, saved, showToast]);

  const openPlaylistSheet = useCallback(async () => {
    setPlaylists(await getPlaylists());
    setPlaylistSearch('');
    setNewPlaylistMode(false);
    setNewPlaylistName('');
    setPlaylistVisible(true);
  }, []);

  const handleCreatePlaylist = useCallback(async () => {
    const name = newPlaylistName.trim();
    if (!name || !song) {
      return;
    }
    setCreatingPlaylist(true);
    const id = await createPlaylist(name);
    await addSongToPlaylist(id, song);
    setCreatingPlaylist(false);
    setNewPlaylistName('');
    setNewPlaylistMode(false);
    setPlaylistVisible(false);
    closeOptions();
    showToast(`Added to ${name}`);
  }, [newPlaylistName, song, closeOptions, showToast]);

  const handleAddToPlaylist = useCallback(
    async (playlistId: number, name: string) => {
      if (song) {
        await addSongToPlaylist(playlistId, song);
      }
      setPlaylistVisible(false);
      closeOptions();
      showToast(`Added to ${name}`);
    },
    [song, closeOptions, showToast],
  );

  const playNext = useCallback(() => {
    if (!song) {
      return;
    }
    addToQueue(song, true);
    closeOptions();
    showToast('Playing next');
  }, [song, addToQueue, closeOptions, showToast]);

  const addToQueueEnd = useCallback(() => {
    if (!song) {
      return;
    }
    addToQueue(song, false);
    closeOptions();
    showToast('Added to queue');
  }, [song, addToQueue, closeOptions, showToast]);

  const handleDownload = useCallback(async () => {
    if (!song) {
      return;
    }
    if (downloaded) {
      await deleteDownload(song);
      setDownloaded(false);
      showToast('Download removed');
      return;
    }
    setDownloading(true);
    setDownloadProgress(0);
    const path = await downloadTrack(song, setDownloadProgress);
    setDownloading(false);
    setDownloadProgress(null);
    if (path) {
      await upsertSong(song);
      setDownloaded(true);
      showToast('Downloaded');
    }
  }, [song, downloaded, showToast]);

  const value = useMemo(
    () => ({ openOptions, closeOptions }),
    [openOptions, closeOptions],
  );

  return (
    <TrackOptionsContext.Provider value={value}>
      {children}

      {/* ---- Options sheet ---- */}
      <Modal
        visible={!!song}
        transparent
        animationType="slide"
        onRequestClose={closeOptions}
      >
        <Pressable
          className="flex-1 bg-black/60 justify-end"
          onPress={closeOptions}
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
              {song?.title} — {song?.artist}
            </Text>
            <OptionRow
              icon={saved ? 'heart' : 'heart-outline'}
              label={saved ? 'Remove from Library' : 'Save to Library'}
              onPress={toggleSave}
            />
            <OptionRow
              icon="add-circle-outline"
              label="Add to Playlist"
              onPress={openPlaylistSheet}
            />
            <OptionRow
              icon="play-forward"
              label="Play Next"
              onPress={playNext}
            />
            <OptionRow
              icon="list-outline"
              label="Add to Queue"
              onPress={addToQueueEnd}
            />
            <OptionRow
              icon={downloaded ? 'trash-outline' : 'download-outline'}
              label={
                downloading
                  ? `Downloading… ${
                      downloadProgress != null
                        ? `${Math.round(downloadProgress * 100)}%`
                        : ''
                    }`
                  : downloaded
                    ? 'Remove Download'
                    : 'Download'
              }
              onPress={downloading ? undefined : handleDownload}
              spinner={downloading}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* ---- Playlist picker (Spotify-style) ---- */}
      <Modal
        visible={playlistVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPlaylistVisible(false)}
      >
        <KeyboardAvoidingView
          className="flex-1 bg-black/60 justify-end"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            className="flex-1"
            onPress={() => setPlaylistVisible(false)}
          />
          <Pressable
            className="bg-[#282828] rounded-t-2xl"
            style={{
              paddingBottom: Math.max(insets.bottom + 16, 32),
              maxHeight: '85%',
            }}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Grab handle + title */}
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 rounded-full bg-white/20" />
            </View>
            <Text className="text-white font-bold text-lg px-4 mb-3">
              Add to Playlist
            </Text>

            {/* Search playlists */}
            <View className="flex-row items-center bg-white/10 rounded-md mx-4 mb-2 px-3">
              <Icon name="search" size={16} color="rgba(255,255,255,0.5)" />
              <TextInput
                value={playlistSearch}
                onChangeText={setPlaylistSearch}
                placeholder="Find a playlist"
                placeholderTextColor="rgba(255,255,255,0.4)"
                className="flex-1 ml-2 py-2.5 text-white text-sm"
              />
            </View>

            {/* New playlist — tap to reveal inline input (Spotify-style) */}
            {newPlaylistMode ? (
              <View className="mx-4 mb-2">
                <View className="flex-row items-center bg-white/10 rounded-md px-3">
                  <Icon
                    name="musical-notes"
                    size={16}
                    color="rgba(255,255,255,0.5)"
                  />
                  <TextInput
                    value={newPlaylistName}
                    onChangeText={setNewPlaylistName}
                    placeholder="New playlist name"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    autoFocus
                    onSubmitEditing={handleCreatePlaylist}
                    returnKeyType="done"
                    className="flex-1 ml-2 py-2.5 text-white text-sm"
                  />
                  <TouchableOpacity
                    onPress={handleCreatePlaylist}
                    disabled={!newPlaylistName.trim() || creatingPlaylist}
                    className="ml-2 bg-[#1ed760] rounded-full px-4 py-1.5"
                  >
                    {creatingPlaylist ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <Text className="text-black font-bold text-sm">
                        Create
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
                <Pressable
                  onPress={() => {
                    setNewPlaylistMode(false);
                    setNewPlaylistName('');
                  }}
                  className="py-2"
                >
                  <Text className="text-white/50 text-[13px] font-semibold">
                    Cancel
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setNewPlaylistMode(true)}
                className="flex-row items-center px-4 py-2.5 active:bg-white/5"
              >
                <View className="w-8 h-8 rounded bg-[#1ed760] items-center justify-center">
                  <Icon name="add" size={20} color="#000000" />
                </View>
                <Text className="text-white text-[15px] font-semibold ml-4">
                  New playlist
                </Text>
              </Pressable>
            )}

            {/* Playlist list (scrollable so the input is never covered) */}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              className="max-h-[320px]"
            >
              {(() => {
                const q = playlistSearch.trim().toLowerCase();
                const filtered = q
                  ? playlists.filter((p) =>
                      p.name.toLowerCase().includes(q),
                    )
                  : playlists;
                if (filtered.length === 0) {
                  return (
                    <Text className="text-white/50 text-[13px] px-4 py-3">
                      {q ? 'No playlists match that name.' : 'No playlists yet.'}
                    </Text>
                  );
                }
                return filtered.map((p) => (
                  <OptionRow
                    key={p.id}
                    icon="musical-note"
                    label={`${p.name} (${p.songCount})`}
                    onPress={() => handleAddToPlaylist(p.id, p.name)}
                  />
                ));
              })()}
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </TrackOptionsContext.Provider>
  );
}

function OptionRow({
  icon,
  label,
  onPress,
  spinner,
}: {
  icon: string;
  label: string;
  onPress?: () => void;
  spinner?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={spinner}
      className="flex-row items-center py-3 active:bg-white/5"
    >
      {spinner ? (
        <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />
      ) : (
        <Icon name={icon} size={22} color="rgba(255,255,255,0.8)" />
      )}
      <Text className="text-white text-[15px] font-medium ml-4">{label}</Text>
    </TouchableOpacity>
  );
}
