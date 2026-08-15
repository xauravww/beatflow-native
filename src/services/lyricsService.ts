import { Song } from '../api/types';
import { cacheLyrics, getCachedLyrics } from '../db/lyricsCache';

export interface LyricLine {
  time: number; // seconds
  text: string;
}

export interface LyricsResult {
  synced: LyricLine[];
  plain: string;
}

/** Parse LRC-format synced lyrics into timestamped lines. */
export function parseSyncedLyrics(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const timestampRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const rawLine of lrc.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // collect all timestamps, then the trailing text is the lyric
    const matches: number[] = [];
    let m: RegExpExecArray | null;
    timestampRe.lastIndex = 0;
    while ((m = timestampRe.exec(line)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracStr = m[3] || '0';
      const frac = parseInt(fracStr.padEnd(3, '0').slice(0, 3), 10) / 1000;
      matches.push(min * 60 + sec + frac);
    }
    if (matches.length === 0) continue;
    const text = line.replace(timestampRe, '').trim();
    for (const time of matches) {
      lines.push({ time, text });
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return lines;
}

interface LrclibResponse {
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

async function fetchFromLrclib(
  title: string,
  artist: string,
  album?: string,
): Promise<LrclibResponse | null> {
  try {
    let url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
      artist,
    )}&track_name=${encodeURIComponent(title)}`;
    if (album) {
      url += `&album_name=${encodeURIComponent(album)}`;
    }
    const res = await fetch(url);
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('lrclib fetch error:', e);
    return null;
  }
}

async function searchLrclib(
  title: string,
  artist: string,
  duration?: number,
): Promise<LrclibResponse | null> {
  try {
    // Structured params match better than a free-text q.
    const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(
      title,
    )}&artist_name=${encodeURIComponent(artist)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    let results = data as LrclibResponse[];
    results = results.filter((r) => r.syncedLyrics || r.plainLyrics);
    if (results.length === 0) {
      return null;
    }

    // Prefer synced results (karaoke) over plain-only ones.
    const synced = results.filter((r) => r.syncedLyrics);
    const pool = synced.length > 0 ? synced : results;

    // The same song exists in multiple versions (album / video / live) with
    // different durations. Rank by proximity to the version we're actually
    // playing so the timestamps line up with the audio.
    if (duration && duration > 0) {
      pool.sort((a, b) => {
        const da = Math.abs((a.duration || 0) - duration);
        const db = Math.abs((b.duration || 0) - duration);
        return da - db;
      });
    }
    return pool[0];
  } catch (e) {
    console.error('lrclib search error:', e);
    return null;
  }
}

/** Build the URL slug AZLyrics uses (lowercase, no punctuation, no spaces). */
function azSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/\(.*?\)/g, '') // "(feat. X)" -> ''
    .replace(/\bfeat\.?\s+.*$/i, '') // trailing "feat. Drake" -> ''
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

/** Extract the plain-text lyrics block from an AZLyrics page. */
function parseAzLyrics(html: string): string | null {
  const marker = 'Usage of azlyrics.com content';
  const idx = html.indexOf(marker);
  if (idx === -1) {
    return null;
  }
  const commentEnd = html.indexOf('-->', idx);
  if (commentEnd === -1) {
    return null;
  }
  let block = html.slice(commentEnd + 3);
  const close = block.indexOf('</div>');
  if (close !== -1) {
    block = block.slice(0, close);
  }
  const lyrics = block
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return lyrics || null;
}

/**
 * Last-resort plain-text lyrics from AZLyrics (no auth, no API key).
 * The URL is built from slugs — verified to work where Genius/Invidious
 * are blocked.
 */
async function fetchFromAzLyrics(
  title: string,
  artist: string,
): Promise<string | null> {
  try {
    const artistSlug = azSlug(artist);
    const titleSlug = azSlug(title);
    if (!artistSlug || !titleSlug) {
      return null;
    }
    const url = `https://www.azlyrics.com/lyrics/${artistSlug}/${titleSlug}.html`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Referer: 'https://www.azlyrics.com/',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        return null;
      }
      return parseAzLyrics(await res.text());
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.error('azlyrics fetch error:', e);
    return null;
  }
}

/**
 * Fetch lyrics for a song.
 * Order: SQLite cache → LRCLIB exact → LRCLIB search → AZLyrics (plain).
 * Results are cached so lyrics work offline.
 */
export async function fetchLyrics(song: Song): Promise<LyricsResult | null> {
  try {
    const cached = await getCachedLyrics(song.id);
    if (cached) {
      return {
        synced: cached.syncedLyrics
          ? parseSyncedLyrics(cached.syncedLyrics)
          : [],
        plain: cached.plainLyrics || '',
      };
    }

    const exact = await fetchFromLrclib(song.title, song.artist, song.album);
    const searched = await searchLrclib(
      song.title,
      song.artist,
      song.duration,
    );

    // Prefer whichever source gives synced lyrics (best sync), falling back
    // to any result. This picks the version whose timing matches our audio.
    let data: LrclibResponse | null = null;
    if (exact?.syncedLyrics) {
      data = exact;
    } else if (searched?.syncedLyrics) {
      data = searched;
    } else {
      data = exact || searched;
    }

    if (!data) {
      // Last resort: plain-text lyrics (like Spotify falling back from
      // Musixmatch sync to Genius text).
      const plain = await fetchFromAzLyrics(song.title, song.artist);
      if (plain) {
        await cacheLyrics(song.id, null, plain);
        return { synced: [], plain };
      }
      return null;
    }
    if (data.instrumental) {
      return { synced: [], plain: '♫ Instrumental' };
    }

    const result: LyricsResult = {
      synced: data.syncedLyrics ? parseSyncedLyrics(data.syncedLyrics) : [],
      plain: data.plainLyrics || '',
    };

    await cacheLyrics(
      song.id,
      data.syncedLyrics || null,
      data.plainLyrics || null,
    );
    return result;
  } catch (e) {
    console.error('fetchLyrics error:', e);
    return null;
  }
}
