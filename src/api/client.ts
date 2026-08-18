import { Shelf, Song, YtSong } from './types';
import { searchSongsOnDevice, resolveStreamUrlOnDevice } from './onDevice';
import {
  getChartShelves,
  getCountry,
  getHomeShelves,
  getNewReleaseShelves,
  getCollectionTracks,
  searchAll,
  SearchResults,
  searchTracks,
} from './ytmusicBrowse';
import { registerStream } from '../services/streamServer';

/**
 * Music backend base URLs, tried in order for search.
 *
 * 1. A custom URL saved in Settings (overrides everything below).
 * 2. LOCAL — your self-hosted backend (see the backend/ folder).
 * 3. LIVE  — the hosted fallback. Search works there, but /api/stream
 *    cannot resolve audio on serverless, so streams always use a
 *    non-serverless backend (custom or local).
 */
export const LOCAL_BASE_URL = 'http://192.168.31.86:3000';
export const LIVE_BASE_URL = 'https://xauravww.vercel.app';

/** Custom backend URL saved in Settings (null = use the defaults). */
let customBaseUrl: string | null = null;

/**
 * Set the custom backend base URL (from Settings). Pass null/empty to
 * clear the override and go back to the built-in defaults.
 */
export function setCustomBackendBaseUrl(url: string | null) {
  const trimmed = url?.trim().replace(/\/+$/, '');
  customBaseUrl = trimmed ? trimmed : null;
}

/** Currently active custom backend URL, or null when using defaults. */
export function getBackendBaseUrl(): string | null {
  return customBaseUrl;
}

/** Base URLs tried in order for search requests. */
function searchBaseUrls(): string[] {
  if (customBaseUrl) {
    return [customBaseUrl];
  }
  return [LOCAL_BASE_URL, LIVE_BASE_URL];
}

/** Base URL used for audio streams (must be able to resolve them). */
function streamBaseUrl(): string {
  return customBaseUrl ?? LOCAL_BASE_URL;
}

const PLACEHOLDER_COVER =
  'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&w=500&q=80';

/** fetch with a timeout so a dead server doesn't hang the fallback. */
function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/** Map the server's raw ytmusic-api song to our normalized Song. */
export function mapYtSong(raw: YtSong): Song {
  let coverUrl = raw.thumbnails?.[raw.thumbnails.length - 1]?.url || '';
  coverUrl = coverUrl.replace(/w\d+-h\d+/, 'w500-h500');
  return {
    id: raw.videoId,
    title: raw.name,
    artist: raw.artist?.name || 'Unknown Artist',
    cover: coverUrl || PLACEHOLDER_COVER,
    album: raw.album?.name ?? undefined,
    duration: raw.duration ?? undefined,
  };
}

/**
 * Search songs via the unofficial YouTube Music API.
 * 1. InnerTube search, straight from the app — one POST against a cached page
 *    config, so it answers in a few hundred ms.
 * 2. `ytmusic-api` on-device, which has to bootstrap its own client first.
 * 3. Backend chain — each base URL in order until one responds.
 */
export async function searchSongs(query: string, limit = 25): Promise<Song[]> {
  // 1) InnerTube directly
  try {
    const direct = await searchTracks(query, limit);
    if (direct.length > 0) {
      return direct;
    }
  } catch (e) {
    console.warn('innertube search failed:', e);
  }

  // 2) on-device library
  const onDevice = await searchSongsOnDevice(query);
  if (onDevice.length > 0) {
    return onDevice.map(mapYtSong).slice(0, limit);
  }

  // 3) backend chain (custom → local → live)
  for (const base of searchBaseUrls()) {
    try {
      const res = await fetchWithTimeout(
        `${base}/api/ytmusic?q=${encodeURIComponent(query)}`,
      );
      if (!res.ok) {
        continue;
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        continue;
      }
      return data.map(mapYtSong).slice(0, limit);
    } catch (e) {
      console.warn(`searchSongs failed via ${base}:`, e);
    }
  }
  return [];
}

/**
 * URL that serves (or redirects to) the raw playable audio for a video id.
 * Uses the custom backend when set, otherwise the local one — the hosted
 * fallback cannot resolve streams on serverless.
 */
export function getStreamUrl(id: string): string {
  return `${streamBaseUrl()}/api/stream?id=${encodeURIComponent(id)}`;
}

/**
 * Resolve a playable audio URL for a video id.
 *
 * 1. On-device — extract the direct googlevideo URL via the InnerTube player
 *    API, then hand it to the in-app proxy server and play from
 *    `http://127.0.0.1:8642/stream/<id>`. The proxy is required: googlevideo
 *    403s the open-ended `bytes=0-` range ExoPlayer sends natively.
 * 2. Backend — the server's 302 redirect to a yt-dlp-resolved URL, used only
 *    when on-device extraction or the proxy is unavailable.
 */
export async function resolveStreamUrl(id: string): Promise<string> {
  try {
    const stream = await resolveStreamUrlOnDevice(id);
    if (stream) {
      const proxied = await registerStream(
        id,
        stream.url,
        stream.userAgent,
        stream.contentLength,
        stream.mimeType,
      );
      if (proxied) {
        return proxied;
      }
      console.warn(
        'in-app stream server unavailable for',
        id,
        '— falling back to backend',
      );
    }
  } catch (e) {
    console.warn('on-device stream resolution failed for', id, ':', e);
  }
  return getStreamUrl(id);
}

/**
 * Best-effort country name, used to label the localized feed rows.
 *
 * Comes from YouTube Music's own page config (the `GL` it resolved from our
 * IP), so it always agrees with the shelves the feed just returned. The old
 * path asked ipapi.co, which rate-limits to a few hundred calls a day and then
 * answers 429/HTML — every user past that quota silently got "Global".
 */
export async function getCountryName(): Promise<string> {
  const { name } = await getCountry();
  return name === 'your area' ? 'Global' : name;
}

export interface HomeSections {
  /** Country label for the localized rows, e.g. "India". */
  country: string;
  /** Real YouTube Music home/chart shelves, in display order. */
  shelves: Shelf[];
}

/**
 * Build the home feed from YouTube Music's own browse API — the same shelves
 * the official app shows, geolocated by IP (Quick picks, "<Country>'s biggest
 * hits", new releases, charts…).
 *
 * Falls back to a few plain searches if browse fails entirely (YouTube
 * reshuffling its response, or no network), so the feed degrades instead of
 * going blank.
 */
export async function fetchHomeSections(): Promise<HomeSections> {
  const [{ name: country }, home, newReleases, charts] = await Promise.all([
    getCountry(),
    getHomeShelves(),
    getNewReleaseShelves(),
    getChartShelves(),
  ]);

  const shelves: Shelf[] = [];
  const seen = new Set<string>();
  const push = (list: Shelf[]) => {
    for (const shelf of list) {
      const key = shelf.title.toLowerCase();
      if (seen.has(key) || shelf.items.length === 0) {
        continue;
      }
      seen.add(key);
      shelves.push(shelf);
    }
  };
  // Song shelves first — a feed that opens on something playable feels alive.
  push(home.filter((s) => s.items.some((i) => i.kind === 'song')));
  push(home);
  push(charts);
  push(newReleases);

  if (shelves.length > 0) {
    return { country, shelves };
  }

  // ---- Fallback: search-built shelves ----------------------------------
  const label = country === 'your area' ? 'Global' : country;
  const [local, topHits, trending] = await Promise.all([
    searchSongs(`Top hits ${label}`, 12),
    searchSongs('Global Top 50 Hits', 12),
    searchSongs('Trending Pop Music', 12),
  ]);
  const asShelf = (title: string, songs: Song[]): Shelf => ({
    title,
    items: songs.map((song) => ({ kind: 'song' as const, song })),
  });
  return {
    country: label,
    shelves: [
      asShelf(`Trending in ${label}`, local),
      asShelf('Global Top Hits', topHits),
      asShelf('Trending Pop Music', trending),
    ].filter((s) => s.items.length > 0),
  };
}

/**
 * Expand a home-feed playlist or album card into playable songs.
 * Empty when YouTube gives us nothing (private/region-locked playlist).
 */
export async function fetchCollectionSongs(id: string): Promise<Song[]> {
  return getCollectionTracks(id);
}

/**
 * Everything YouTube Music has for a query — songs, artists, albums, playlists
 * and videos — with the best-matching kind first. Repeat searches for the same
 * term are served from memory: users retype and re-tap the same things
 * constantly, and a cached hit renders with no spinner at all.
 */
const searchCache = new Map<string, SearchResults>();
const SEARCH_CACHE_MAX = 30;

export async function searchEverything(
  query: string,
): Promise<SearchResults> {
  const key = query.trim().toLowerCase();
  const cached = searchCache.get(key);
  if (cached) {
    return cached;
  }
  const results = await searchAll(query);
  // Don't cache a failure — the next attempt should really retry.
  if (results.sections.length > 0) {
    if (searchCache.size >= SEARCH_CACHE_MAX) {
      const oldest = searchCache.keys().next().value;
      if (oldest !== undefined) {
        searchCache.delete(oldest);
      }
    }
    searchCache.set(key, results);
  }
  return results;
}

export type { SearchResults };
