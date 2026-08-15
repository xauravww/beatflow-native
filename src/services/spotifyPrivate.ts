/**
 * Spotify's private web-player API (`api-partner.spotify.com/pathfinder`).
 *
 * This is what the browser's web player actually uses — which is why Spotify
 * works in a browser but anonymous `/v1/*` calls (api.spotify.com) get 429
 * rate-limited on some networks. Requests need three things we mint here:
 *
 *   1. A bearer token (from `spotifyToken.ts` — anonymous TOTP flow).
 *   2. A `Client-Token` (from clienttoken.spotify.com, tied to the web-player
 *      client id + the current `clientVersion`).
 *   3. A persisted-query SHA-256 hash per operation (operation hashes from
 *      the web-player bundle — they rotate when Spotify ships a new build,
 *      so every call has a fallback to the public /v1 API in spotifyData).
 *
 * Verified live against api-partner.spotify.com: search, playlist contents,
 * album tracks, and artist top tracks all return 200 from a network where
 * api.spotify.com/v1 returns 429.
 */
import { getSpotifyToken } from './spotifyToken';
import type { SpotifySearchResults, SpotifyTrack } from './spotifyData';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** Minimal base64 decoder (no atob dependency for RN's TS libs). */
function base64Decode(input: string): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    if (ch === '=') break;
    buffer = (buffer << 6) | alphabet.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >>> bits) & 0xff);
    }
  }
  return out;
}

/** Persisted-query hashes extracted from the web-player bundle. */
const OPS = {
  searchDesktop: {
    name: 'searchDesktop',
    hash: 'db61238974d27839a136c9dc02bfdbe3fab7635f21cf85976ebff9a1ee281345',
  },
  // `fetchPlaylist`/`fetchPlaylistContents` share this hash; passing
  // enableWatchFeedEntrypoint:true unlocks the name/owner/metadata fields.
  fetchPlaylist: {
    name: 'fetchPlaylist',
    hash: '86dde7b9d9356e2369414647cf6950cfed96e778e129cfdfc99aea6c1613b3b0',
  },
  getAlbum: {
    name: 'getAlbum',
    hash: 'b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10',
  },
  queryArtistOverview: {
    name: 'queryArtistOverview',
    hash: 'ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a',
  },
} as const;

const PATHFINDER_URL =
  'https://api-partner.spotify.com/pathfinder/v2/query';

/** Cap how many tracks a single import will fetch (page loop guard). */
const MAX_TRACKS = 1000;

interface Session {
  clientVersion: string;
  clientToken: string;
  fetchedAt: number;
}

const SESSION_TTL = 30 * 60 * 1000;
let session: Session | null = null;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the web-player session config + mint a Client-Token (SpotAPI flow). */
async function bootstrapSession(): Promise<Session> {
  const htmlRes = await fetchWithTimeout(
    'https://open.spotify.com',
    { headers: { 'User-Agent': UA } },
    15000,
  );
  const html = await htmlRes.text();
  const m = html.match(
    /<script id="appServerConfig" type="text\/plain">([^<]+)<\/script>/,
  );
  if (!m) {
    throw new Error('Could not read Spotify session config');
  }
  let cfg: any;
  try {
    cfg = JSON.parse(base64Decode(m[1].trim()));
  } catch {
    throw new Error('Could not parse Spotify session config');
  }
  const token = await getSpotifyToken();
  const ctRes = await fetchWithTimeout(
    'https://clienttoken.spotify.com/v1/clienttoken',
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_data: {
          client_version: cfg.clientVersion,
          client_id: token.clientId,
          js_sdk_data: {
            device_brand: 'unknown',
            device_model: 'unknown',
            os: 'android',
            os_version: '14',
            device_id: '',
            device_type: 'smartphone',
          },
        },
      }),
    },
    15000,
  );
  const ctBody = await ctRes.json();
  const clientToken = ctBody?.granted_token?.token;
  if (!clientToken) {
    throw new Error('Could not get a Spotify client token');
  }
  session = {
    clientVersion: cfg.clientVersion,
    clientToken,
    fetchedAt: Date.now(),
  };
  return session;
}

/**
 * Run a persisted query against pathfinder. Returns `data` (the GraphQL
 * `data` object). Throws on non-OK responses so callers can fall back to
 * the public API. Refreshes the session + token once on 401.
 */
async function pathfinder<T = any>(
  op: { name: string; hash: string },
  variables: Record<string, unknown>,
): Promise<T> {
  let sess =
    session && Date.now() - session.fetchedAt < SESSION_TTL
      ? session
      : await bootstrapSession();

  const doCall = async (
    s: Session,
  ): Promise<{ status: number; body: any }> => {
    const token = await getSpotifyToken();
    const res = await fetchWithTimeout(
      PATHFINDER_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'en',
          'app-platform': 'WebPlayer',
          'Content-Type': 'application/json;charset=UTF-8',
          Origin: 'https://open.spotify.com',
          Referer: 'https://open.spotify.com/',
          'User-Agent': UA,
          Authorization: `Bearer ${token.accessToken}`,
          'Client-Token': s.clientToken,
          'Spotify-App-Version': s.clientVersion,
        },
        body: JSON.stringify({
          operationName: op.name,
          variables,
          extensions: { persistedQuery: { version: 1, sha256Hash: op.hash } },
        }),
      },
      20000,
    );
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  };

  let result = await doCall(sess);
  if (result.status === 401) {
    // stale client-token/app-version or expired bearer token — refresh both
    session = null;
    sess = await bootstrapSession();
    result = await doCall(sess);
  }
  if (!result.body?.data) {
    throw new Error(
      `Spotify API error ${result.status}${
        result.body?.error?.message ? `: ${result.body.error.message}` : ''
      }`,
    );
  }
  return result.body.data as T;
}

// --- response mappers -----------------------------------------------------

function lastSourceUrl(sources: any[] | undefined): string {
  if (!sources || sources.length === 0) {
    return '';
  }
  return sources[sources.length - 1]?.url || '';
}

/** Map a private-API track object to the app's SpotifyTrack shape. */
function mapTrack(raw: any): SpotifyTrack | null {
  if (!raw?.name || !raw?.uri) {
    return null;
  }
  const artists = (raw.artists?.items || []).map(
    (a: any) => ({ name: a?.profile?.name || '' }),
  );
  const albumRaw = raw.albumOfTrack;
  const images = albumRaw?.coverArt?.sources;
  return {
    id: raw.uri.split(':').pop() || '',
    name: raw.name,
    artists,
    duration_ms:
      raw.trackDuration?.totalMilliseconds ??
      raw.duration?.totalMilliseconds ??
      undefined,
    album: albumRaw
      ? {
          name: albumRaw.name || undefined,
          images: images?.length ? [{ url: lastSourceUrl(images) }] : undefined,
        }
      : undefined,
  };
}

// --- public operations ----------------------------------------------------

/** Search tracks/playlists/albums/artists in a single pathfinder call. */
export async function searchSpotifyPrivate(
  query: string,
): Promise<SpotifySearchResults> {
  const data = await pathfinder(OPS.searchDesktop, {
    searchTerm: query,
    offset: 0,
    limit: 20,
    numberOfTopResults: 5,
    includeAudiobooks: false,
    includeArtistHasSong: false,
    includePreReleases: true,
    includeUnknownArtists: false,
    withMusicSection: true,
    withTopResults: true,
  });
  const sv = data.searchV2 || {};
  const tracks = (sv.tracksV2?.items || [])
    .map((i: any) => mapTrack(i?.item?.data))
    .filter((t: SpotifyTrack | null): t is SpotifyTrack => !!t);
  const playlists = (sv.playlists?.items || [])
    .map((i: any) => {
      const d = i?.data || {};
      return {
        id: (d.uri || '').split(':').pop() || '',
        name: d.name || '',
        owner: d.ownerV2?.data?.name || '',
        cover: lastSourceUrl(d.images?.items?.[0]?.sources),
      };
    })
    .filter((p: { id: string }) => !!p.id);
  const albums = (sv.albumsV2?.items || [])
    .map((i: any) => {
      const d = i?.data || {};
      return {
        id: (d.uri || '').split(':').pop() || '',
        name: d.name || '',
        artist: d.artists?.items?.[0]?.profile?.name || '',
        cover: lastSourceUrl(d.coverArt?.sources),
      };
    })
    .filter((a: { id: string }) => !!a.id);
  const artists = (sv.artists?.items || [])
    .map((i: any) => {
      const d = i?.data || {};
      return {
        id: (d.uri || '').split(':').pop() || '',
        name: d.profile?.name || '',
        cover:
          lastSourceUrl(d.visuals?.avatarImage?.sources) ||
          lastSourceUrl(d.visuals?.sources),
      };
    })
    .filter((a: { id: string }) => !!a.id);
  return { tracks, playlists, albums, artists };
}

/**
 * Name, owner, and full track list of a playlist — paginated like the web
 * player does (playlists can exceed one page). Works for public playlists
 * without a cookie. The name/owner come from the same call.
 */
export async function fetchPlaylistPrivate(
  playlistId: string,
  pageSize = 100,
  maxTotal = MAX_TRACKS,
): Promise<{
  name: string;
  owner: string;
  tracks: SpotifyTrack[];
}> {
  const tracks: SpotifyTrack[] = [];
  let name = '';
  let owner = '';
  let offset = 0;
  for (;;) {
    const data = await pathfinder(OPS.fetchPlaylist, {
      uri: `spotify:playlist:${playlistId}`,
      offset,
      limit: pageSize,
      enableWatchFeedEntrypoint: true,
      includeEpisodeContentRatingsV2: true,
    });
    const content = data.playlistV2?.content;
    if (!content?.items) {
      break;
    }
    if (!name) {
      name = data.playlistV2?.name || '';
      owner = data.playlistV2?.ownerV2?.data?.name || '';
    }
    for (const item of content.items) {
      const track = mapTrack(item?.itemV2?.data);
      if (track) {
        tracks.push(track);
      }
    }
    const totalCount = content.totalCount as number | undefined;
    const got = offset + content.items.length;
    if (
      totalCount == null ||
      got >= totalCount ||
      tracks.length >= maxTotal
    ) {
      break;
    }
    offset = got;
  }
  return { name, owner, tracks };
}

/** Tracks of any playlist (public playlists work without a cookie). */
export async function fetchPlaylistTracksPrivate(
  playlistId: string,
  limit = MAX_TRACKS,
): Promise<SpotifyTrack[]> {
  return (await fetchPlaylistPrivate(playlistId, Math.min(100, limit), limit))
    .tracks;
}

/** Name + tracks of an album (paginated for deluxe editions). */
export async function getAlbumPrivate(
  albumId: string,
  limit = MAX_TRACKS,
): Promise<{ name: string; tracks: SpotifyTrack[] }> {
  const tracks: SpotifyTrack[] = [];
  let name = '';
  let offset = 0;
  const pageSize = Math.min(100, limit);
  for (;;) {
    const data = await pathfinder(OPS.getAlbum, {
      uri: `spotify:album:${albumId}`,
      locale: 'en',
      offset,
      limit: pageSize,
    });
    const au = data.albumUnion;
    if (!au || au.__typename === 'NotFound') {
      throw new Error('Album not found');
    }
    if (!name) {
      name = au.name || '';
    }
    const items = au.tracksV2?.items || [];
    for (const item of items) {
      const track = mapTrack(item?.track);
      if (track) {
        tracks.push(track);
      }
    }
    const next = au.tracksV2?.pagingInfo?.nextOffset;
    if (next == null || tracks.length >= limit || items.length === 0) {
      break;
    }
    offset = next;
  }
  return { name, tracks };
}

/** Name + top tracks of an artist. */
export async function getArtistTopTracksPrivate(
  artistId: string,
): Promise<{ name: string; tracks: SpotifyTrack[] }> {
  const data = await pathfinder(OPS.queryArtistOverview, {
    uri: `spotify:artist:${artistId}`,
    locale: 'en',
    preReleaseV2: false,
  });
  const au = data.artistUnion;
  if (!au || au.__typename !== 'Artist') {
    throw new Error('Artist not found');
  }
  const tracks = (au.discography?.topTracks?.items || [])
    .map((i: any) => mapTrack(i?.track))
    .filter((t: SpotifyTrack | null): t is SpotifyTrack => !!t);
  return { name: au.profile?.name || '', tracks };
}

/** Drop the cached session (called when the cookie/account changes). */
export function clearPrivateSession(): void {
  session = null;
}
