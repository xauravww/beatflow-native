import { Song } from '../api/types';
import { cacheLyrics, getCachedLyrics } from '../db/lyricsCache';

export interface LyricLine {
  time: number; // seconds
  text: string;
}

export interface LyricsResult {
  synced: LyricLine[];
  plain: string;
  /**
   * Runtime (seconds) of the lyric version these timestamps were written for,
   * or 0 when unknown. LRCLIB holds several versions of the same song (album
   * edit, video edit, live, sped-up) — timestamps from the wrong one drift, so
   * this is what {@link isSyncUsable} checks the playing audio against.
   */
  matchedDuration: number;
  source: 'lrclib' | 'azlyrics' | 'cache';
}

/**
 * Largest gap (seconds) allowed between the lyric version's runtime and the
 * audio we're actually playing. LRCLIB itself matches on ±2s; anything past
 * a few seconds means a different edit, whose lines drift audibly.
 */
const MAX_SYNC_DRIFT = 4;

/**
 * Can these timestamps be trusted to drive auto-highlight and auto-scroll?
 *
 * Faking it is worse than not doing it: a highlight that runs ahead of (or
 * behind) the vocal is more distracting than a plain, still lyric sheet. So
 * the caller only animates when this returns true, and shows scrollable text
 * otherwise.
 *
 * `audioDuration` is the playing track's length (0 while unknown).
 */
export function isSyncUsable(
  result: LyricsResult | null,
  audioDuration: number,
): boolean {
  if (!result || result.synced.length < 2) {
    return false;
  }
  if (!audioDuration || audioDuration <= 0) {
    // Nothing to compare against yet — don't animate against an unknown clock.
    return false;
  }
  // Wrong version of the song: its runtime doesn't match what's playing.
  if (
    result.matchedDuration > 0 &&
    Math.abs(result.matchedDuration - audioDuration) > MAX_SYNC_DRIFT
  ) {
    return false;
  }
  const lastTime = result.synced[result.synced.length - 1].time;
  // Timestamps running past the end of the audio, or stopping less than a
  // third of the way in, mean the lines don't describe this recording.
  if (lastTime > audioDuration + 10 || lastTime < audioDuration * 0.35) {
    return false;
  }
  return true;
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

/**
 * LRCLIB sits behind Cloudflare, which rejects React Native's default
 * `User-Agent: okhttp/<version>` with HTTP 520 — measured: every `okhttp/*`
 * UA 520s while an app-identifying one answers 200. That single header was why
 * every track reported "no lyrics". LRCLIB also asks clients to identify
 * themselves, so this is the header they want anyway.
 */
const LRCLIB_HEADERS = {
  'User-Agent': 'BeatFlow/1.0 (https://github.com/xauravww/beatflow-native)',
  Accept: 'application/json',
};

/**
 * GET with a timeout, and one retry on a 5xx. LRCLIB's Cloudflare edge
 * intermittently answers 520/522 (origin timeout) on the heavier `/search`
 * endpoint; a single immediate retry clears it. A hung request must never pin
 * the lyrics spinner, hence the abort.
 */
async function lrclibFetch(url: string, ms = 9000): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, {
        headers: LRCLIB_HEADERS,
        signal: controller.signal,
      });
      if (res.status >= 500 && attempt === 0) {
        continue;
      }
      return res;
    } catch (e) {
      if (attempt === 1) {
        console.warn('lrclib request failed:', url, e);
        return null;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function fetchFromLrclib(
  title: string,
  artist: string,
  album?: string,
  duration?: number,
): Promise<LrclibResponse | null> {
  try {
    let url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
      artist,
    )}&track_name=${encodeURIComponent(title)}`;
    if (album) {
      url += `&album_name=${encodeURIComponent(album)}`;
    }
    // LRCLIB matches duration within ±2s when it's given — that's what makes
    // it hand back the edit we're actually playing instead of another version.
    if (duration && duration > 0) {
      url += `&duration=${Math.round(duration)}`;
    }
    const res = await lrclibFetch(url);
    if (!res || res.status === 404) {
      return null;
    }
    if (!res.ok) {
      console.warn(`lrclib get returned ${res.status} for "${title}"`);
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
): Promise<LrclibResponse[]> {
  try {
    // Structured params match better than a free-text q.
    let url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(
      title,
    )}`;
    if (artist) {
      url += `&artist_name=${encodeURIComponent(artist)}`;
    }
    const res = await lrclibFetch(url);
    if (!res) {
      return [];
    }
    if (!res.ok) {
      console.warn(`lrclib search returned ${res.status} for "${title}"`);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      return [];
    }
    const results = (data as LrclibResponse[]).filter(
      (r) => r.syncedLyrics || r.plainLyrics,
    );
    // The same song exists in multiple versions (album / video / live) with
    // different durations. Rank by proximity to the version we're actually
    // playing so the timestamps line up with the audio.
    if (duration && duration > 0) {
      results.sort(
        (a, b) =>
          Math.abs((a.duration || 0) - duration) -
          Math.abs((b.duration || 0) - duration),
      );
    }
    return results;
  } catch (e) {
    console.error('lrclib search error:', e);
    return [];
  }
}

/**
 * Choose the candidate whose timestamps will actually line up: synced lyrics
 * whose runtime is closest to the audio win; a plain-only result is taken only
 * when nothing synced matches. A synced result that's more than
 * [MAX_SYNC_DRIFT] off is still returned (the text is right even when the
 * timing isn't) — {@link isSyncUsable} is what decides whether to animate it.
 */
function pickBestCandidate(
  candidates: LrclibResponse[],
  duration?: number,
): LrclibResponse | null {
  const usable = candidates.filter(Boolean);
  if (usable.length === 0) {
    return null;
  }
  const drift = (r: LrclibResponse) =>
    duration && duration > 0 && r.duration
      ? Math.abs(r.duration - duration)
      : Number.MAX_SAFE_INTEGER / 2;
  const score = (r: LrclibResponse) => {
    // synced beats plain; within a tier, the closest runtime wins
    const tier = r.syncedLyrics ? 0 : 1;
    return tier * 1e9 + drift(r);
  };
  return [...usable].sort((a, b) => score(a) - score(b))[0];
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

interface Query {
  title: string;
  artist: string;
}

/** Only the primary artist — LRCLIB indexes "A, B & C" under "A". */
function primaryArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|feat\.?|ft\.?|·)\s+/i)[0].trim() || artist;
}

/**
 * Strip the decoration YouTube titles carry but LRCLIB's index doesn't:
 * "(Official Video)", "[Lyrics]", "feat. X", '(From "Movie")'.
 */
function stripDecoration(title: string): string {
  const junk =
    'official|video|audio|lyric|lyrics|hd|4k|visualizer|mv|remaster(?:ed)?|explicit';
  return (
    title
      .replace(new RegExp(`\\((?:[^()]*\\b(?:${junk})\\b[^()]*)\\)`, 'gi'), '')
      .replace(
        new RegExp(`\\[(?:[^[\\]]*\\b(?:${junk})\\b[^[\\]]*)\\]`, 'gi'),
        '',
      )
      // '(From "Brahmastra")' — the whole group goes, not just the quoted part.
      .replace(/[([]\s*from\s+[^)\]]*[)\]]/gi, '')
      .replace(/\bfrom\s+["“][^"”]*["”]/gi, '')
      .replace(/[-–|]\s*(?:official|full)?\s*(?:video|audio|song|lyrics?)\s*$/gi, '')
      .replace(/\b(?:feat|ft)\.?\s.*$/i, '')
      .replace(/\(\s*\)|\[\s*\]/g, '') // any bracket pair we emptied out
      .replace(/\s{2,}/g, ' ')
      .replace(/[\s\-–|,]+$/, '')
      .trim()
  );
}

/**
 * Progressively looser retries for when the exact metadata finds nothing,
 * cheapest/safest first:
 *   1. decoration stripped, primary artist only
 *   2. also drop a trailing " - Album" / " | Movie" segment — how YouTube
 *      labels film songs ("Tum Hi Ho - Aashiqui 2"), which LRCLIB indexes
 *      under the bare song name
 *   3. title alone, no artist filter
 * Duplicates and empties are dropped so no request is wasted.
 */
function fallbackQueries(title: string, artist: string): Query[] {
  const out: Query[] = [];
  const seen = new Set([`${title} ${artist}`.toLowerCase()]);
  const push = (t: string, a: string) => {
    if (!t) {
      return;
    }
    const key = `${t} ${a}`.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({ title: t, artist: a });
  };

  const stripped = stripDecoration(title);
  const primary = primaryArtist(artist);
  push(stripped, primary);
  // Everything before the first " - " / " | " separator.
  const core = stripped.split(/\s+[-–|]\s+/)[0].trim();
  push(core, primary);
  push(core, '');
  return out;
}

/**
 * Fetch lyrics for a song.
 * Order: SQLite cache → LRCLIB with the exact metadata → LRCLIB again with
 * progressively looser queries → AZLyrics (plain text). Results are cached so
 * lyrics work offline.
 *
 * `durationOverride` is the real playing length in seconds — pass it when the
 * player knows better than the search metadata, so LRCLIB returns the matching
 * edit of the song instead of an arbitrary one.
 */
export async function fetchLyrics(
  song: Song,
  durationOverride?: number,
): Promise<LyricsResult | null> {
  const duration =
    durationOverride && durationOverride > 0
      ? durationOverride
      : song.duration && song.duration > 0
        ? song.duration
        : undefined;

  /**
   * One LRCLIB round: the precise /get endpoint and the forgiving /search
   * endpoint in parallel (sequential just doubled latency), best candidate
   * returned. /get needs an artist, so it's skipped on an artist-less query.
   */
  const lookup = async (title: string, artist: string, album?: string) => {
    const [exact, searched] = await Promise.all([
      artist
        ? fetchFromLrclib(title, artist, album, duration)
        : Promise.resolve(null),
      searchLrclib(title, artist, duration),
    ]);
    return pickBestCandidate(
      [...(exact ? [exact] : []), ...searched],
      duration,
    );
  };

  try {
    const cached = await getCachedLyrics(song.id);
    // A row with neither synced nor plain text is a failed lookup that got
    // written anyway — treat it as a miss, or one bad fetch (a 520, an offline
    // moment) pins "no lyrics found" on that song forever.
    if (cached && (cached.syncedLyrics || cached.plainLyrics)) {
      return {
        synced: cached.syncedLyrics
          ? parseSyncedLyrics(cached.syncedLyrics)
          : [],
        plain: cached.plainLyrics || '',
        matchedDuration: cached.matchedDuration,
        source: 'cache',
      };
    }

    let data = await lookup(song.title, song.artist, song.album);

    // Nothing on the exact metadata: retry with looser queries, since YouTube
    // titles carry decoration LRCLIB never indexed.
    if (!data) {
      for (const q of fallbackQueries(song.title, song.artist)) {
        data = await lookup(q.title, q.artist);
        if (data) {
          break;
        }
      }
    }

    if (!data) {
      // Last resort: plain-text lyrics (like Spotify falling back from
      // Musixmatch sync to Genius text). Feed it the de-decorated title —
      // the AZLyrics slug is built from it.
      const plain = await fetchFromAzLyrics(
        stripDecoration(song.title) || song.title,
        primaryArtist(song.artist),
      );
      if (plain) {
        await cacheLyrics(song.id, null, plain, 0);
        return {
          synced: [],
          plain,
          matchedDuration: 0,
          source: 'azlyrics',
        };
      }
      return null;
    }
    if (data.instrumental) {
      return {
        synced: [],
        plain: '♫ Instrumental',
        matchedDuration: data.duration || 0,
        source: 'lrclib',
      };
    }

    const result: LyricsResult = {
      synced: data.syncedLyrics ? parseSyncedLyrics(data.syncedLyrics) : [],
      plain: data.plainLyrics || '',
      matchedDuration: data.duration || 0,
      source: 'lrclib',
    };

    await cacheLyrics(
      song.id,
      data.syncedLyrics || null,
      data.plainLyrics || null,
      data.duration || 0,
    );
    return result;
  } catch (e) {
    console.error('fetchLyrics error:', e);
    return null;
  }
}
