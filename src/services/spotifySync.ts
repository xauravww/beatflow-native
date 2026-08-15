import { searchSongs } from '../api/client';
import { Song } from '../api/types';
import {
  addSongToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylists,
} from '../db/playlists';
import {
  fetchAlbumInfo,
  fetchAlbumTracks,
  fetchArtistInfo,
  fetchArtistTopTracks,
  fetchPlaylistInfo,
  fetchPlaylistTracks,
  fetchSavedTracks,
  SpotifyTrack,
} from './spotifyData';
import { fetchPlaylistPrivate } from './spotifyPrivate';

/** Prefix so synced playlists are recognizable in the Library. */
export const SPOTIFY_PREFIX = 'Spotify · ';

export type SpotifyLinkType = 'playlist' | 'album' | 'artist';

/**
 * Extract a type + ID from a Spotify URL, share URI, or bare ID.
 * Bare IDs default to playlist (albums should be pasted as full links).
 */
export function parseSpotifyLink(
  input: string,
): { type: SpotifyLinkType; id: string } | null {
  const trimmed = input.trim();
  const playlistUrl = trimmed.match(/playlist\/([A-Za-z0-9]+)/);
  if (playlistUrl) {
    return { type: 'playlist', id: playlistUrl[1] };
  }
  const albumUrl = trimmed.match(/album\/([A-Za-z0-9]+)/);
  if (albumUrl) {
    return { type: 'album', id: albumUrl[1] };
  }
  const artistUrl = trimmed.match(/artist\/([A-Za-z0-9]+)/);
  if (artistUrl) {
    return { type: 'artist', id: artistUrl[1] };
  }
  const uri = trimmed.match(/^spotify:(playlist|album|artist):([A-Za-z0-9]+)$/);
  if (uri) {
    return { type: uri[1] as SpotifyLinkType, id: uri[2] };
  }
  if (/^[A-Za-z0-9]{15,}$/.test(trimmed)) {
    return { type: 'playlist', id: trimmed };
  }
  return null;
}

function spotifyToQuery(track: SpotifyTrack): string {
  const artist = track.artists[0]?.name || '';
  return `${track.name} ${artist}`.trim();
}

/**
 * Find the YouTube equivalent of a Spotify track via ytmusic search,
 * ranked by duration proximity so we pick the version matching the audio.
 */
async function matchTrack(track: SpotifyTrack): Promise<Song | null> {
  const targetDur = track.duration_ms ? track.duration_ms / 1000 : 0;
  const results = await searchSongs(spotifyToQuery(track), 10);
  if (results.length === 0) {
    return null;
  }
  let best = results[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const r of results) {
    const delta = r.duration ? Math.abs(r.duration - targetDur) : Infinity;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = r;
    }
  }
  return best;
}

async function matchAll(
  tracks: SpotifyTrack[],
  onProgress: (done: number, total: number) => void,
): Promise<Song[]> {
  const out: Song[] = [];
  const BATCH = 5;
  for (let i = 0; i < tracks.length; i += BATCH) {
    const batch = tracks.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((t) => matchTrack(t).catch(() => null)),
    );
    for (const song of results) {
      if (song) {
        out.push(song);
      }
    }
    onProgress(Math.min(i + BATCH, tracks.length), tracks.length);
  }
  return out;
}

/** Create-or-replace a local playlist with the given songs. */
async function replaceLocalPlaylist(
  name: string,
  songs: Song[],
): Promise<void> {
  const existing = (await getPlaylists()).find((p) => p.name === name);
  if (existing) {
    await deletePlaylist(existing.id);
  }
  const id = await createPlaylist(name);
  for (const song of songs) {
    await addSongToPlaylist(id, song);
  }
}

/** Sync the user's Liked Songs into a local playlist. Returns songs matched. */
export async function syncLikedSongs(
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const tracks = await fetchSavedTracks(100);
  const songs = await matchAll(tracks, onProgress);
  await replaceLocalPlaylist(`${SPOTIFY_PREFIX}Liked Songs`, songs);
  return songs.length;
}

/**
 * Import a public Spotify playlist by URL/ID. Returns name + songs matched.
 * Name + tracks come from the private web-player API (single paginated
 * call, no rate limiting); falls back to the public /v1 API when the
 * private hashes rotate or a network blocks api-partner.spotify.com.
 */
export async function syncPlaylistFromUrl(
  urlOrId: string,
  onProgress: (done: number, total: number) => void,
): Promise<{ name: string; count: number }> {
  const parsed = parseSpotifyLink(urlOrId);
  if (!parsed || parsed.type !== 'playlist') {
    throw new Error('Could not find a playlist ID in that link.');
  }
  let name: string;
  let tracks: SpotifyTrack[];
  try {
    const pl = await fetchPlaylistPrivate(parsed.id);
    name = pl.name || 'Spotify Playlist';
    tracks = pl.tracks;
  } catch {
    const info = await fetchPlaylistInfo(parsed.id);
    name = info.name;
    tracks = await fetchPlaylistTracks(parsed.id, 100);
  }
  const songs = await matchAll(tracks, onProgress);
  await replaceLocalPlaylist(`${SPOTIFY_PREFIX}${name}`, songs);
  return { name, count: songs.length };
}

/** Import a public Spotify album by URL/ID. Returns name + songs matched. */
export async function syncAlbumFromUrl(
  urlOrId: string,
  onProgress: (done: number, total: number) => void,
): Promise<{ name: string; count: number }> {
  const parsed = parseSpotifyLink(urlOrId);
  if (!parsed || parsed.type !== 'album') {
    throw new Error('Could not find an album ID in that link.');
  }
  const info = await fetchAlbumInfo(parsed.id);
  const tracks = await fetchAlbumTracks(parsed.id, 100);
  const songs = await matchAll(tracks, onProgress);
  await replaceLocalPlaylist(`${SPOTIFY_PREFIX}${info.name}`, songs);
  return { name: info.name, count: songs.length };
}

/** Import a public Spotify artist (top tracks) by URL/ID. */
export async function syncArtistFromUrl(
  urlOrId: string,
  onProgress: (done: number, total: number) => void,
): Promise<{ name: string; count: number }> {
  const parsed = parseSpotifyLink(urlOrId);
  if (!parsed || parsed.type !== 'artist') {
    throw new Error('Could not find an artist ID in that link.');
  }
  const info = await fetchArtistInfo(parsed.id);
  const tracks = await fetchArtistTopTracks(parsed.id);
  const songs = await matchAll(tracks, onProgress);
  await replaceLocalPlaylist(`${SPOTIFY_PREFIX}${info.name}`, songs);
  return { name: info.name, count: songs.length };
}

/** Import a playlist, album, or artist link — dispatches on the link type. */
export async function importSpotifyLink(
  urlOrId: string,
  onProgress: (done: number, total: number) => void,
): Promise<{ name: string; count: number }> {
  const parsed = parseSpotifyLink(urlOrId);
  if (!parsed) {
    throw new Error('Could not find a playlist, album, or artist ID in that link.');
  }
  if (parsed.type === 'album') {
    return syncAlbumFromUrl(urlOrId, onProgress);
  }
  if (parsed.type === 'artist') {
    return syncArtistFromUrl(urlOrId, onProgress);
  }
  return syncPlaylistFromUrl(urlOrId, onProgress);
}

/** Match a single Spotify track to its YouTube equivalent (for search results). */
export async function matchSpotifyTrackToSong(
  track: SpotifyTrack,
): Promise<Song | null> {
  return matchTrack(track);
}

/** Import one of the user's own playlists (needs cookie). */
export async function syncOwnPlaylist(
  playlistId: string,
  name: string,
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const tracks = await fetchPlaylistTracks(playlistId, 100);
  const songs = await matchAll(tracks, onProgress);
  await replaceLocalPlaylist(`${SPOTIFY_PREFIX}${name}`, songs);
  return songs.length;
}
