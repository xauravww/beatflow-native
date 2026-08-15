import React from 'react';
import {
  ActivityIndicator,
  Image,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { formatTime } from '../../utils/format';
import {
  SpotifySearchResults,
  SpotifyTrack,
} from '../../services/spotifyData';

/**
 * Spotify search results grouped into TRACKS / PLAYLISTS / ALBUMS / ARTISTS,
 * with the same actions as the Spotify Sync screen (play, save, import).
 * Used by the main Search tab so searching feels like Spotify.
 */
export default function SpotifyResults({
  results,
  matchingId,
  disabled,
  onPlayTrack,
  onSaveTrack,
  onImportPlaylist,
  onImportAlbum,
  onImportArtist,
  onOpenArtist,
}: {
  results: SpotifySearchResults | null;
  matchingId: string | null;
  disabled?: boolean;
  onPlayTrack: (track: SpotifyTrack) => void;
  onSaveTrack: (track: SpotifyTrack) => void;
  onImportPlaylist: (id: string, name: string) => void;
  onImportAlbum: (id: string, name: string) => void;
  /** When provided, artist rows show an Import button instead of a chevron. */
  onImportArtist?: (id: string, name: string) => void;
  onOpenArtist: (name: string) => void;
}) {
  if (!results) {
    return null;
  }
  const hasAny =
    results.tracks.length > 0 ||
    results.playlists.length > 0 ||
    results.albums.length > 0 ||
    results.artists.length > 0;
  if (!hasAny) {
    return null;
  }

  return (
    <>
      {/* ---- TRACKS ---- */}
      {results.tracks.length > 0 && (
        <View className="mt-5">
          <Text className="text-white/60 text-xs font-semibold tracking-widest mb-2">
            TRACKS
          </Text>
          {results.tracks.map((t) => (
            <View key={t.id} className="flex-row items-center px-2 py-2">
              <Image
                source={{ uri: t.album?.images?.[0]?.url }}
                className="w-12 h-12 rounded"
              />
              <View className="flex-1 ml-3 min-w-0">
                <Text numberOfLines={1} className="text-white text-sm">
                  {t.name}
                </Text>
                <Text numberOfLines={1} className="text-white/60 text-xs">
                  {t.artists.map((a) => a.name).join(', ')}
                </Text>
              </View>
              <Text className="text-white/40 text-xs mr-3">
                {formatTime((t.duration_ms || 0) / 1000)}
              </Text>
              {matchingId === t.id ? (
                <ActivityIndicator size="small" color="#1ed760" />
              ) : (
                <View className="flex-row items-center">
                  <TouchableOpacity
                    onPress={() => onSaveTrack(t)}
                    hitSlop={10}
                    className="mr-4"
                  >
                    <Icon
                      name="heart-outline"
                      size={22}
                      color="rgba(255,255,255,0.8)"
                    />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onPlayTrack(t)} hitSlop={10}>
                    <Icon name="play-circle" size={28} color="#1ed760" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* ---- PLAYLISTS ---- */}
      {results.playlists.length > 0 && (
        <View className="mt-5">
          <Text className="text-white/60 text-xs font-semibold tracking-widest mb-2">
            PLAYLISTS
          </Text>
          {results.playlists.map((p) => (
            <View key={`p-${p.id}`} className="flex-row items-center px-2 py-2">
              <Image source={{ uri: p.cover }} className="w-12 h-12 rounded" />
              <View className="flex-1 ml-3 min-w-0">
                <Text numberOfLines={1} className="text-white text-sm">
                  {p.name}
                </Text>
                <Text numberOfLines={1} className="text-white/60 text-xs">
                  {p.owner ? `Playlist · ${p.owner}` : 'Playlist'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onImportPlaylist(p.id, p.name)}
                disabled={disabled}
                className="bg-white/10 rounded-full px-3 py-1.5 active:bg-white/20"
              >
                <Text className="text-white text-[12px] font-semibold">
                  Import
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* ---- ALBUMS ---- */}
      {results.albums.length > 0 && (
        <View className="mt-5">
          <Text className="text-white/60 text-xs font-semibold tracking-widest mb-2">
            ALBUMS
          </Text>
          {results.albums.map((a) => (
            <View key={`a-${a.id}`} className="flex-row items-center px-2 py-2">
              <Image source={{ uri: a.cover }} className="w-12 h-12 rounded" />
              <View className="flex-1 ml-3 min-w-0">
                <Text numberOfLines={1} className="text-white text-sm">
                  {a.name}
                </Text>
                <Text numberOfLines={1} className="text-white/60 text-xs">
                  {a.artist ? `Album · ${a.artist}` : 'Album'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onImportAlbum(a.id, a.name)}
                disabled={disabled}
                className="bg-white/10 rounded-full px-3 py-1.5 active:bg-white/20"
              >
                <Text className="text-white text-[12px] font-semibold">
                  Import
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* ---- ARTISTS ---- */}
      {results.artists.length > 0 && (
        <View className="mt-5">
          <Text className="text-white/60 text-xs font-semibold tracking-widest mb-2">
            ARTISTS
          </Text>
          {results.artists.map((a) =>
            onImportArtist ? (
              <View
                key={`ar-${a.id}`}
                className="flex-row items-center px-2 py-2"
              >
                <Image
                  source={{ uri: a.cover }}
                  className="w-12 h-12 rounded-full"
                />
                <View className="flex-1 ml-3 min-w-0">
                  <Text numberOfLines={1} className="text-white text-sm">
                    {a.name}
                  </Text>
                  <Text numberOfLines={1} className="text-white/60 text-xs">
                    Artist
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => onImportArtist(a.id, a.name)}
                  disabled={disabled}
                  className="bg-white/10 rounded-full px-3 py-1.5 active:bg-white/20"
                >
                  <Text className="text-white text-[12px] font-semibold">
                    Import
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                key={`ar-${a.id}`}
                onPress={() => onOpenArtist(a.name)}
                className="flex-row items-center px-2 py-2 active:bg-white/5"
              >
                <Image
                  source={{ uri: a.cover }}
                  className="w-12 h-12 rounded-full"
                />
                <View className="flex-1 ml-3 min-w-0">
                  <Text numberOfLines={1} className="text-white text-sm">
                    {a.name}
                  </Text>
                  <Text numberOfLines={1} className="text-white/60 text-xs">
                    Artist
                  </Text>
                </View>
                <Icon
                  name="chevron-forward"
                  size={18}
                  color="rgba(255,255,255,0.4)"
                />
              </TouchableOpacity>
            ),
          )}
        </View>
      )}
    </>
  );
}
