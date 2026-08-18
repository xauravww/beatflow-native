export type RootStackParamList = {
  Main: undefined;
  FullPlayer: undefined;
  Credits: undefined;
  Settings: undefined;
  Stats: undefined;
  SpotifySync: undefined;
  Playlist: { playlistId: number; name: string };
  /** A YouTube Music playlist/album from the home feed (not a local one). */
  YtPlaylist: {
    /** Playlist id or album browse id — whatever the feed card carried. */
    collectionId: string;
    name: string;
    cover?: string;
    subtitle?: string;
    type?: 'playlist' | 'album';
  };
  Artist: { artistName: string };
};
