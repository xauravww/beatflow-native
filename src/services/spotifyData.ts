import { getSpotifyToken } from './spotifyToken';
import {
  fetchPlaylistTracksPrivate,
  getAlbumPrivate,
  getArtistTopTracksPrivate,
  searchSpotifyPrivate,
} from './spotifyPrivate';

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  duration_ms: number;
  album?: { name?: string; images?: { url: string }[] };
}

/**
 * Read a public endpoint. Public reads try Spotify's private web-player API
 * first (what the browser uses — no rate limiting) and fall back to the
 * public /v1 API (needs a plain bearer token) when the private hashes
 * rotate or a network blocks api-partner.spotify.com.
 */
async function withFallback<T>(
  privateCall: () => Promise<T>,
  v1Call: () => Promise<T>,
): Promise<T> {
  try {
    return await privateCall();
  } catch {
    return v1Call();
  }
}

async function api<T>(path: string, allowAnonymous: boolean): Promise<T> {
  const token = await getSpotifyToken();
  if (token.isAnonymous && !allowAnonymous) {
    throw new Error(
      'This needs the sp_dc cookie — connect your account first.',
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch {
      // non-JSON error body — ignore
    }
    throw new Error(
      `Spotify API error ${res.status}${detail ? `: ${detail}` : ''}`,
    );
  }
  return res.json();
}

/** Tracks of any playlist (public playlists work without a cookie). */
export async function fetchPlaylistTracks(
  playlistId: string,
  limit = 1000,
): Promise<SpotifyTrack[]> {
  return withFallback(
    () => fetchPlaylistTracksPrivate(playlistId, limit),
    () =>
      api<{ items: { track: SpotifyTrack | null }[] }>(
        `/playlists/${playlistId}/tracks?limit=${limit}`,
        true,
      ).then((data) =>
        (data.items || [])
          .map((i) => i.track)
          .filter((t): t is SpotifyTrack => !!t),
      ),
  );
}

/** Name + owner of a playlist (public ones work without a cookie). */
export async function fetchPlaylistInfo(
  playlistId: string,
): Promise<{ name: string; owner: string }> {
  const data = await api<{ name: string; owner?: { id: string } }>(
    `/playlists/${playlistId}`,
    true,
  );
  return { name: data.name, owner: data.owner?.id || '' };
}

/** Tracks of an album (public albums work without a cookie). */
export async function fetchAlbumTracks(
  albumId: string,
  limit = 100,
): Promise<SpotifyTrack[]> {
  return withFallback(
    () => getAlbumPrivate(albumId, limit).then((a) => a.tracks),
    () =>
      api<{ items: SpotifyTrack[] }>(
        `/albums/${albumId}/tracks?limit=${limit}`,
        true,
      ).then((data) => data.items || []),
  );
}

/** Name + artist of an album (public albums work without a cookie). */
export async function fetchAlbumInfo(
  albumId: string,
): Promise<{ name: string; artist: string }> {
  try {
    const { name, tracks } = await getAlbumPrivate(albumId, 1);
    return { name, artist: tracks[0]?.artists[0]?.name || '' };
  } catch {
    const data = await api<{ name: string; artists?: { name: string }[] }>(
      `/albums/${albumId}`,
      true,
    );
    return { name: data.name, artist: data.artists?.[0]?.name || '' };
  }
}

/** Name of an artist (public artists work without a cookie). */
export async function fetchArtistInfo(
  artistId: string,
): Promise<{ name: string }> {
  try {
    const { name } = await getArtistTopTracksPrivate(artistId);
    return { name };
  } catch {
    const data = await api<{ name: string }>(`/artists/${artistId}`, true);
    return { name: data.name };
  }
}

/**
 * Top tracks of an artist (public artists work without a cookie).
 * The official endpoint returns up to 10 tracks.
 */
export async function fetchArtistTopTracks(
  artistId: string,
): Promise<SpotifyTrack[]> {
  return withFallback(
    () => getArtistTopTracksPrivate(artistId).then((a) => a.tracks),
    () =>
      api<{ tracks: SpotifyTrack[] }>(
        `/artists/${artistId}/top-tracks?market=US`,
        true,
      ).then((data) => data.tracks || []),
  );
}

/** The user's Liked Songs — requires the sp_dc cookie. */
export async function fetchSavedTracks(
  limit = 100,
): Promise<SpotifyTrack[]> {
  const data = await api<{ items: { track: SpotifyTrack | null }[] }>(
    `/me/tracks?limit=${limit}&offset=0`,
    false,
  );
  return (data.items || [])
    .map((i) => i.track)
    .filter((t): t is SpotifyTrack => !!t);
}

export interface SpotifyPlaylistSummary {
  id: string;
  name: string;
  owner: string;
}

/** The user's playlists — requires the sp_dc cookie. */
export async function fetchUserPlaylists(): Promise<SpotifyPlaylistSummary[]> {
  const data = await api<{ items: any[] }>('/me/playlists?limit=50', false);
  return (data.items || []).map((p) => ({
    id: p.id,
    name: p.name,
    owner: p.owner?.id || '',
  }));
}

/** The user's profile (username/display name) — requires the cookie. */
export async function fetchProfile(): Promise<{
  displayName: string | null;
}> {
  const data = await api<{ display_name?: string; id?: string }>(
    '/me',
    false,
  );
  return {
    displayName: data.display_name || data.id || null,
  };
}

export interface SpotifySearchResults {
  tracks: SpotifyTrack[];
  playlists: {
    id: string;
    name: string;
    owner: string;
    cover: string;
  }[];
  albums: {
    id: string;
    name: string;
    artist: string;
    cover: string;
  }[];
  artists: {
    id: string;
    name: string;
    cover: string;
  }[];
}

/** Search Spotify (tracks, playlists, albums, artists) — no cookie needed. */
export async function searchSpotify(
  query: string,
): Promise<SpotifySearchResults> {
  return withFallback(
    () => searchSpotifyPrivate(query),
    () => {
      const q = encodeURIComponent(query);
      return api<{
        tracks?: { items: SpotifyTrack[] };
        playlists?: { items: any[] };
        albums?: { items: any[] };
      }>(
        `/search?q=${q}&type=track,playlist,album&limit=20&market=US`,
        true,
      ).then((data) => ({
        tracks: data.tracks?.items || [],
        playlists: (data.playlists?.items || []).map((p) => ({
          id: p.id,
          name: p.name,
          owner: p.owner?.id || '',
          cover: p.images?.[0]?.url || '',
        })),
        albums: (data.albums?.items || []).map((a) => ({
          id: a.id,
          name: a.name,
          artist: a.artists?.[0]?.name || '',
          cover: a.images?.[0]?.url || '',
        })),
        artists: [],
      }));
    },
  );
}
