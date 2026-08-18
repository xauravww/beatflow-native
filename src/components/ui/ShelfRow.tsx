import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Shelf, ShelfItem, Song } from '../../api/types';
import TrackCard from './TrackCard';

const CARD_WIDTH = 150;

/**
 * One row of the YouTube Music home feed. A shelf can mix tracks, playlists,
 * albums and artists, so each item renders as its own card type — songs play
 * on tap, collections open, artists jump to the artist page.
 */
export default function ShelfRow({
  shelf,
  onPlaySongs,
  onOpenCollection,
  onOpenArtist,
}: {
  shelf: Shelf;
  /** Play the shelf's own tracks, starting at the tapped one. */
  onPlaySongs: (songs: Song[], index: number) => void;
  onOpenCollection: (
    item: Extract<ShelfItem, { kind: 'collection' }>,
  ) => void;
  onOpenArtist: (name: string) => void;
}) {
  // A shelf's songs form their own queue, so tapping track 3 of "Quick picks"
  // queues the rest of Quick picks rather than a single track.
  const songs = shelf.items
    .filter((i): i is Extract<ShelfItem, { kind: 'song' }> => i.kind === 'song')
    .map((i) => i.song);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
    >
      {shelf.items.map((item) => {
        if (item.kind === 'song') {
          const index = songs.findIndex((s) => s.id === item.song.id);
          return (
            <View key={`s-${item.song.id}`} style={{ width: CARD_WIDTH }}>
              <TrackCard
                song={item.song}
                onPlay={() => onPlaySongs(songs, Math.max(index, 0))}
                onArtistPress={() => onOpenArtist(item.song.artist)}
              />
            </View>
          );
        }
        if (item.kind === 'artist') {
          return (
            <Pressable
              key={`a-${item.artistId}`}
              onPress={() => onOpenArtist(item.name)}
              style={{ width: CARD_WIDTH }}
              className="active:opacity-70"
            >
              <View className="w-full aspect-square rounded-full overflow-hidden bg-[#282828] items-center justify-center">
                {item.cover ? (
                  <Image source={{ uri: item.cover }} className="w-full h-full" />
                ) : (
                  <Icon name="person" size={40} color="rgba(255,255,255,0.4)" />
                )}
              </View>
              <Text
                numberOfLines={1}
                className="text-white text-[13px] font-semibold mt-2 text-center"
              >
                {item.name}
              </Text>
              <Text className="text-white/50 text-xs mt-0.5 text-center">
                Artist
              </Text>
            </Pressable>
          );
        }
        return (
          <Pressable
            key={`c-${item.id}`}
            onPress={() => onOpenCollection(item)}
            style={{ width: CARD_WIDTH }}
            className="active:opacity-70"
          >
            <View className="w-full aspect-square rounded-md overflow-hidden bg-[#282828] items-center justify-center">
              {item.cover ? (
                <Image source={{ uri: item.cover }} className="w-full h-full" />
              ) : (
                <Icon
                  name={item.type === 'album' ? 'disc' : 'musical-notes'}
                  size={40}
                  color="rgba(255,255,255,0.4)"
                />
              )}
            </View>
            <Text
              numberOfLines={1}
              className="text-white text-[13px] font-semibold mt-2"
            >
              {item.title}
            </Text>
            <Text numberOfLines={2} className="text-white/50 text-xs mt-0.5">
              {item.subtitle || (item.type === 'album' ? 'Album' : 'Playlist')}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
