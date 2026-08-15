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
