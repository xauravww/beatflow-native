import { Song, YtSong } from './types';

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
 * Tries each base URL in order until one responds successfully.
 */
export async function searchSongs(query: string, limit = 25): Promise<Song[]> {
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
 * Best-effort country name (used to localize the home feed).
 * Silently falls back to 'Global' — never blocks or spams the console.
 */
export async function getCountryName(): Promise<string> {
  try {
    const res = await fetchWithTimeout('https://ipapi.co/json/', 4000);
    if (!res.ok) {
      return 'Global';
    }
    const text = await res.text();
    if (!text.trim().startsWith('{')) {
      // some networks/proxies return HTML instead of JSON
      return 'Global';
    }
    const data = JSON.parse(text);
    return data.country_name || 'Global';
  } catch {
    return 'Global';
  }
}

export interface HomeSections {
  trending: Song[];
  topHits: Song[];
  local: Song[];
  country: string;
}

/** Fetch the three home sections in parallel (mirrors the web MusicApp). */
export async function fetchHomeSections(): Promise<HomeSections> {
  const country = await getCountryName();
  const [trending, topHits, local] = await Promise.all([
    searchSongs('Trending Pop Music 2024', 10),
    searchSongs('Global Top 50 Hits', 10),
    searchSongs(`Top hits ${country}`, 10),
  ]);
  return { trending, topHits, local, country };
}
