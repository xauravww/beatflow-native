/** Raw shape returned by the server's /api/ytmusic endpoint (ytmusic-api `searchSongs`). */
export interface YtSong {
  type: 'SONG';
  name: string;
  videoId: string;
  artist: { artistId: string | null; name: string } | null;
  album: { name: string; albumId: string } | null;
  duration: number | null;
  thumbnails: { url: string; width: number; height: number }[];
}

/** Normalized song used across the app. */
export interface Song {
  id: string; // YouTube videoId
  title: string;
  artist: string;
  cover: string; // high-res thumbnail (w500-h500)
  album?: string;
  duration?: number; // seconds
  isDownloaded?: boolean;
  localPath?: string | null;
}

/**
 * One entry in a home-feed shelf. YouTube Music mixes tracks, playlists,
 * albums and artists inside the same shelf, so the feed is a union rather than
 * a list of songs.
 */
export type ShelfItem =
  | { kind: 'song'; song: Song }
  | {
      kind: 'collection';
      /**
       * What expands this into songs: a bare playlist id (`PL…`, `RDCLAK…`,
       * `OLAK…`) or an album browse id (`MPREb_…`), which the browse endpoint
       * takes as-is.
       */
      id: string;
      title: string;
      /** "Album · 2024", "Chart · YouTube Music", … */
      subtitle: string;
      cover: string;
      type: 'playlist' | 'album';
    }
  | { kind: 'artist'; artistId: string; name: string; cover: string };

/** A titled row of the home feed, straight from YouTube Music. */
export interface Shelf {
  title: string;
  items: ShelfItem[];
}
