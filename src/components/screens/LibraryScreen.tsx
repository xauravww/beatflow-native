import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { Song } from '../../api/types';
import { usePlayer } from '../../context/PlayerContext';
import {
  getDownloadedSongs,
  getSavedSongs,
  removeSavedSong,
} from '../../db/songs';
import {
  createPlaylist,
  deletePlaylist,
  getPlaylists,
  Playlist,
  renamePlaylist,
} from '../../db/playlists';
import { deleteDownload } from '../../services/downloadService';
import { useCachedData } from '../../hooks/useCachedData';
import { colors } from '../../theme/colors';
import TrackRow from '../ui/TrackRow';
import EmptyState from '../ui/EmptyState';
import { ListSkeleton } from '../ui/ListSkeleton';

type Tab = 'songs' | 'downloads' | 'playlists';

export default function LibraryScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { playQueue } = usePlayer();

  // Session + SQLite-cached library: returns instantly on revisit/relaunch,
  // refreshes in the background so repeat visits never flash a loader.
  const fetchLibrary = useCallback(async () => {
    const [s, d, p] = await Promise.all([
      getSavedSongs(),
      getDownloadedSongs(),
      getPlaylists(),
    ]);
    return { songs: s, downloads: d, playlists: p };
  }, []);
  const { data, loading, refresh } = useCachedData('library', fetchLibrary, {
    persist: true,
  });

  const [tab, setTab] = useState<Tab>('songs');
  // seed from the cache so the first paint already shows content
  const [songs, setSongs] = useState<Song[]>(data?.songs ?? []);
  const [downloads, setDownloads] = useState<Song[]>(data?.downloads ?? []);
  const [playlists, setPlaylists] = useState<Playlist[]>(data?.playlists ?? []);
  const [newPlaylistVisible, setNewPlaylistVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Playlist | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);

  // sync cached/fetched data into local (mutatable) state
  useEffect(() => {
    if (data) {
      setSongs(data.songs);
      setDownloads(data.downloads);
      setPlaylists(data.playlists);
    }
  }, [data]);

  // refresh whenever the screen regains focus (e.g. returning from player)
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const removeSong = useCallback(async (song: Song) => {
    await removeSavedSong(song.id);
    setSongs((prev) => prev.filter((s) => s.id !== song.id));
  }, []);

  const removeDownload = useCallback(async (song: Song) => {
    await deleteDownload(song);
    setDownloads((prev) => prev.filter((s) => s.id !== song.id));
    setSongs((prev) =>
      prev.map((s) =>
        s.id === song.id ? { ...s, isDownloaded: false, localPath: null } : s,
      ),
    );
  }, []);

  const handleCreatePlaylist = useCallback(async () => {
    const name = newPlaylistName.trim();
    if (!name) {
      return;
    }
    setCreating(true);
    await createPlaylist(name);
    setNewPlaylistName('');
    setCreating(false);
    setNewPlaylistVisible(false);
    setPlaylists(await getPlaylists());
  }, [newPlaylistName]);

  const handleDeletePlaylist = useCallback(async (playlist: Playlist) => {
    await deletePlaylist(playlist.id);
    setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
  }, []);

  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameName.trim()) {
      return;
    }
    setRenaming(true);
    await renamePlaylist(renameTarget.id, renameName.trim());
    setRenaming(false);
    setRenameTarget(null);
    setPlaylists(await getPlaylists());
  }, [renameTarget, renameName]);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'songs', label: 'Songs' },
    { key: 'downloads', label: 'Downloads' },
    { key: 'playlists', label: 'Playlists' },
  ];

  return (
    <View className="flex-1" style={{ backgroundColor: '#121212' }}>
      <View style={{ paddingTop: insets.top + 12 }} className="px-4">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-white text-[26px] font-bold">Your Library</Text>
          <View className="flex-row">
            <Pressable
              onPress={() => navigation.navigate('Stats')}
              className="w-9 h-9 rounded-full bg-[#282828] items-center justify-center mr-2"
              hitSlop={8}
            >
              <Icon name="bar-chart-outline" size={18} color="#ffffff" />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Credits')}
              className="w-9 h-9 rounded-full bg-[#282828] items-center justify-center mr-2"
              hitSlop={8}
            >
              <Icon name="information-circle-outline" size={20} color="#ffffff" />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Settings')}
              className="w-9 h-9 rounded-full bg-[#282828] items-center justify-center"
              hitSlop={8}
            >
              <Icon name="settings-outline" size={19} color="#ffffff" />
            </Pressable>
          </View>
        </View>
        <View className="flex-row gap-2 mb-2">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                className={`rounded-full px-4 py-2 ${active ? 'bg-white' : 'bg-[#282828]'}`}
              >
                <Text
                  className={`text-[13px] font-bold ${active ? 'text-black' : 'text-white'}`}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {loading ? (
        <ListSkeleton rows={9} />
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 110 }}>
          {/* Play all */}
          {(tab === 'songs' && songs.length > 0) ||
          (tab === 'downloads' && downloads.length > 0) ? (
            <View className="px-4 py-3">
              <Pressable
                onPress={() =>
                  playQueue(tab === 'songs' ? songs : downloads, 0)
                }
                className="w-12 h-12 bg-[#1ed760] rounded-full items-center justify-center"
              >
                <Icon name="play" size={22} color="#000000" style={{ marginLeft: 2 }} />
              </Pressable>
            </View>
          ) : null}

          {tab === 'songs' &&
            (songs.length === 0 ? (
              <EmptyState
                icon="heart-outline"
                message="Songs you save with the heart icon will show up here."
              />
            ) : (
              songs.map((song) => (
                <TrackRow
                  key={song.id}
                  song={song}
                  onPress={() =>
                    playQueue(songs, songs.findIndex((s) => s.id === song.id))
                  }
                  onArtistPress={() =>
                    navigation.navigate('Artist', { artistName: song.artist })
                  }
                  trailing={
                    <View className="flex-row items-center">
                      {song.isDownloaded && (
                        <Icon
                          name="download"
                          size={18}
                          color={colors.greenBright}
                          style={{ marginRight: 14 }}
                        />
                      )}
                      <TouchableOpacity
                        onPress={() => removeSong(song)}
                        hitSlop={10}
                      >
                        <Icon
                          name="heart"
                          size={20}
                          color="rgba(255,255,255,0.7)"
                        />
                      </TouchableOpacity>
                    </View>
                  }
                />
              ))
            ))}

          {tab === 'downloads' &&
            (downloads.length === 0 ? (
              <EmptyState
                icon="download-outline"
                message="Downloads live here forever — play them offline with no expiry."
              />
            ) : (
              downloads.map((song) => (
                <TrackRow
                  key={song.id}
                  song={song}
                  subtitle={`${song.artist} • Downloaded`}
                  onPress={() =>
                    playQueue(
                      downloads,
                      downloads.findIndex((s) => s.id === song.id),
                    )
                  }
                  onArtistPress={() =>
                    navigation.navigate('Artist', { artistName: song.artist })
                  }
                  trailing={
                    <TouchableOpacity
                      onPress={() => removeDownload(song)}
                      hitSlop={10}
                    >
                      <Icon
                        name="trash-outline"
                        size={20}
                        color="rgba(255,255,255,0.7)"
                      />
                    </TouchableOpacity>
                  }
                />
              ))
            ))}

          {tab === 'playlists' && (
            <>
              <Pressable
                onPress={() => setNewPlaylistVisible(true)}
                className="flex-row items-center px-4 py-3 active:bg-white/5"
              >
                <View className="w-12 h-12 rounded bg-[#282828] items-center justify-center">
                  <Icon name="add" size={26} color="#ffffff" />
                </View>
                <Text className="text-white text-[15px] font-semibold ml-3">
                  New playlist
                </Text>
              </Pressable>
              {playlists.length === 0 ? (
                <EmptyState
                  icon="albums-outline"
                  message="Create playlists to group your favorite tracks."
                />
              ) : (
                playlists.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() =>
                      navigation.navigate('Playlist', {
                        playlistId: p.id,
                        name: p.name,
                      })
                    }
                    onLongPress={() => {
                      setRenameTarget(p);
                      setRenameName(p.name);
                    }}
                    className="flex-row items-center px-4 py-3 active:bg-white/5"
                  >
                    <View className="w-12 h-12 rounded bg-[#282828] items-center justify-center overflow-hidden">
                      {p.cover ? (
                        <Image source={{ uri: p.cover }} className="w-full h-full" />
                      ) : (
                        <Icon name="musical-notes" size={22} color="#ffffff" />
                      )}
                    </View>
                    <View className="flex-1 ml-3">
                      <Text className="text-white text-[15px] font-semibold">
                        {p.name}
                      </Text>
                      <Text className="text-white/60 text-xs">
                        Playlist • {p.songCount} songs
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDeletePlaylist(p)}
                      hitSlop={10}
                    >
                      <Icon
                        name="trash-outline"
                        size={18}
                        color="rgba(255,255,255,0.5)"
                      />
                    </TouchableOpacity>
                  </Pressable>
                ))
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Rename playlist modal */}
      <Modal
        visible={!!renameTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <Pressable
          className="flex-1 bg-black/60 items-center justify-center px-8"
          onPress={() => setRenameTarget(null)}
        >
          <Pressable
            className="w-full bg-[#282828] rounded-xl p-5"
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-white font-bold text-lg mb-4">
              Rename playlist
            </Text>
            <TextInput
              value={renameName}
              onChangeText={setRenameName}
              placeholder="Playlist name"
              placeholderTextColor="rgba(255,255,255,0.4)"
              autoFocus
              className="bg-white/10 rounded-lg px-4 py-3 text-white text-[15px]"
            />
            <View className="flex-row justify-end mt-5">
              <TouchableOpacity
                onPress={() => setRenameTarget(null)}
                className="px-4 py-2"
              >
                <Text className="text-white/70 font-semibold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleRename}
                disabled={!renameName.trim() || renaming}
                className="bg-[#1ed760] rounded-full px-5 py-2 ml-3"
              >
                {renaming ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text className="text-black font-bold">Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* New playlist modal */}
      <Modal
        visible={newPlaylistVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNewPlaylistVisible(false)}
      >
        <Pressable
          className="flex-1 bg-black/60 items-center justify-center px-8"
          onPress={() => setNewPlaylistVisible(false)}
        >
          <Pressable
            className="w-full bg-[#282828] rounded-xl p-5"
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-white font-bold text-lg mb-4">
              New playlist
            </Text>
            <TextInput
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              placeholder="Playlist name"
              placeholderTextColor="rgba(255,255,255,0.4)"
              autoFocus
              className="bg-white/10 rounded-lg px-4 py-3 text-white text-[15px]"
            />
            <View className="flex-row justify-end mt-5">
              <TouchableOpacity
                onPress={() => setNewPlaylistVisible(false)}
                className="px-4 py-2"
              >
                <Text className="text-white/70 font-semibold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreatePlaylist}
                disabled={!newPlaylistName.trim() || creating}
                className="bg-[#1ed760] rounded-full px-5 py-2 ml-3"
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text className="text-black font-bold">Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
