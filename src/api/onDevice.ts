/**
 * On-device YouTube Music access — runs inside the app (Hermes-safe: pure
 * JS, no Node builtins) so search and stream extraction work with NO backend
 * server. Used as the primary path in client.ts; the backend chain remains
 * as an automatic fallback.
 *
 * Stream extraction calls the InnerTube player API directly. Every client's
 * audio-only `adaptiveFormats` now come back with no `url` at all unless a
 * PoToken is attached, so the working path is the ANDROID client's
 * progressive `streamingData.formats` entry (itag 18, `ratebypass=yes`),
 * which streams a whole track unauthenticated. That is the same format
 * yt-dlp settles on with `player_client=android` and `-f ba/ba*`.
 */
import YTMusic from 'ytmusic-api';
import { YtSong } from './types';

let client: YTMusic | null = null;
let ready: Promise<void> | null = null;

/** Lazily create + initialize the shared YTMusic client (one per app run). */
async function getClient(): Promise<YTMusic> {
  if (!client) {
    client = new YTMusic();
  }
  if (!ready) {
    ready = client
      .initialize()
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready.then(() => client as YTMusic);
}

/** Race a promise against a timeout so a hung request can't block playback. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms),
    ),
  ]);
}

/**
 * Search songs straight from YouTube Music (no backend).
 * Returns raw YtSong-shaped results, or [] on any failure.
 */
export async function searchSongsOnDevice(
  query: string,
): Promise<YtSong[]> {
  try {
    const api = await withTimeout(getClient(), 10000, 'ytmusic init');
    const songs = await withTimeout(
      api.searchSongs(query),
      12000,
      'ytmusic search',
    );
    return songs as unknown as YtSong[];
  } catch (e) {
    console.warn('on-device search failed:', e);
    return [];
  }
}

/** One playable audio format from a player response. */
interface AudioFormat {
  url: string;
  /** Total byte size, or 0 when the response didn't include it. */
  contentLength: number;
  /** e.g. `audio/mp4; codecs="mp4a.40.2"`, or `video/mp4` for progressive. */
  mimeType: string;
  /** True for a muxed progressive format (itag 18) rather than audio-only. */
  progressive: boolean;
}

/**
 * Pick the best playable audio-only format from a response's adaptiveFormats.
 * Prefers AAC (m4a — plays everywhere), then Opus (webm); highest bitrate
 * wins within the same codec family. Entries without a `url` are skipped:
 * YouTube now omits it on PoToken-gated formats.
 */
function pickAudioOnlyFormat(formats: unknown): AudioFormat | null {
  const list = Array.isArray(formats) ? formats : [];
  const audio = list.filter(
    (f: any) =>
      f && typeof f.url === 'string' && (f.mimeType || '').includes('audio'),
  );
  const rank = (f: any) => {
    const mime = f.mimeType || '';
    const codec =
      mime.includes('audio/mp4') ? 2 : mime.includes('audio/webm') ? 1 : 0;
    return codec * 1e9 + (f.bitrate || 0);
  };
  audio.sort((a: any, b: any) => rank(b) - rank(a));
  const best: any = audio[0];
  if (!best) {
    return null;
  }
  return {
    url: best.url,
    // contentLength arrives as a string in the InnerTube response
    contentLength: Number(best.contentLength) || 0,
    mimeType: best.mimeType || 'audio/mp4',
    progressive: false,
  };
}

/**
 * Pick a progressive (muxed) format from `streamingData.formats`.
 * These carry audio alongside low-res video, so they cost more bandwidth than
 * an audio-only stream — but they're the formats YouTube still serves without
 * a PoToken, and ExoPlayer plays only the audio track (no video surface is
 * attached). itag 18 (mp4, AAC) is the reliable one.
 */
function pickProgressiveFormat(formats: unknown): AudioFormat | null {
  const list = Array.isArray(formats) ? formats : [];
  const usable = list.filter((f: any) => f && typeof f.url === 'string');
  // itag 18 is mp4/AAC and always present; prefer it over any webm variant.
  const best: any =
    usable.find((f: any) => Number(f.itag) === 18) ?? usable[0];
  if (!best) {
    return null;
  }
  return {
    url: best.url,
    contentLength: Number(best.contentLength) || 0,
    mimeType: best.mimeType || 'video/mp4',
    progressive: true,
  };
}

// ---- Stream extraction: InnerTube player API directly --------------------
// Calls the InnerTube player API and takes whichever format still ships a
// usable `url`. PoToken attestation now gates every audio-only adaptive
// format, so in practice that means the ANDROID client's progressive entry.

interface PlayerClient {
  name: string;
  clientId: string;
  userAgent: string;
  context: Record<string, unknown>;
  /** If true, a visitor session (from watch page fetch) is attached. */
  needsVisitor: boolean;
}

/**
 * Client configs from yt-dlp's youtube extractor.
 *
 * ANDROID first — it's the only client measured to yield a playable URL. Its
 * `adaptiveFormats` are all PoToken-gated (they come back with no `url` at
 * all), but `streamingData.formats` carries the progressive **itag 18** entry
 * with a `ratebypass=yes` URL that streams start-to-finish. This is the same
 * format yt-dlp lands on with `player_client=android` and `-f ba/ba*`.
 *
 * IOS is kept as a fallback but is a poor one: it returns adaptive audio URLs
 * that 403 at any offset at or past 1 MiB without a PoToken, so tracks longer
 * than ~1 minute cut off partway. ANDROID_VR currently answers
 * `LOGIN_REQUIRED` ("Sign in to confirm you're not a bot") with zero formats.
 */
const PLAYER_CLIENTS: PlayerClient[] = [
  {
    name: 'ANDROID',
    clientId: '3',
    userAgent:
      'com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip',
    context: {
      clientName: 'ANDROID',
      clientVersion: '21.02.35',
      androidSdkVersion: 30,
      osName: 'Android',
      osVersion: '11',
      hl: 'en',
      timeZone: 'UTC',
      utcOffsetMinutes: 0,
    },
    needsVisitor: false,
  },
  {
    name: 'IOS',
    clientId: '5',
    userAgent:
      'com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    context: {
      clientName: 'IOS',
      clientVersion: '21.02.3',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
      hl: 'en',
    },
    needsVisitor: false,
  },
  {
    name: 'ANDROID_VR',
    clientId: '28',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    context: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.65.10',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12L',
      hl: 'en',
      timeZone: 'UTC',
      utcOffsetMinutes: 0,
    },
    needsVisitor: true,
  },
];

const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

// ---- Visitor session (only for clients that need it) ---------------------
// ANDROID_VR needs a visitor session from the watch page to return stream
// data. IOS works without one.

interface VisitorSession {
  visitorId: string;
  cookieStr: string;
  fetchedAt: number;
}

let visitorSession: VisitorSession | null = null;
const VISITOR_TTL_MS = 30 * 60 * 1000;

async function getVisitorSession(): Promise<VisitorSession> {
  if (
    visitorSession &&
    Date.now() - visitorSession.fetchedAt < VISITOR_TTL_MS
  ) {
    return visitorSession;
  }
  const res = await fetch('https://www.youtube.com/watch?v=jNQXAC9IVRw', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const rawCookies = (
    typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')!]
        : []
  ) as string[];
  const jar: Record<string, string> = {};
  for (const c of rawCookies) {
    for (const part of c.split(',')) {
      const [pair] = part.split(';');
      const i = pair.indexOf('=');
      if (i > 0) {
        jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
      }
    }
  }
  const html = await res.text();
  const vMatch = html.match(/"visitorData":"([^"]+)"/);
  visitorSession = {
    visitorId: vMatch?.[1] ?? '',
    cookieStr: Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
    fetchedAt: Date.now(),
  };
  return visitorSession;
}

// ---- Player API request --------------------------------------------------

/** One player-API attempt for a client; returns the best audio format or null. */
async function playerRequest(
  client: PlayerClient,
  id: string,
  cookieStr: string,
): Promise<AudioFormat | null> {
  // Build headers — only attach visitor data for clients that need it
  const headers: Record<string, string> = {
    'User-Agent': client.userAgent,
    'X-Youtube-Client-Name': client.clientId,
    'X-Youtube-Client-Version': client.context.clientVersion as string,
    'Content-Type': 'application/json',
    'Origin': 'https://www.youtube.com',
    'Accept-Language': 'en-us,en;q=0.5',
  };
  if (cookieStr) {
    headers['Cookie'] = cookieStr;
  }
  if (client.needsVisitor) {
    const visitor = await withTimeout(getVisitorSession(), 12000, 'yt visitor');
    if (visitor.visitorId) {
      headers['X-Goog-Visitor-Id'] = visitor.visitorId;
    }
  }

  const body = JSON.stringify({
    context: {
      client: {
        ...client.context,
        timeZone: 'UTC',
        utcOffsetMinutes: 0,
      },
    },
    videoId: id,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: 'HTML5_PREF_WANTS',
      },
    },
    contentCheckOk: true,
    racyCheckOk: true,
  });

  const res = await fetch(PLAYER_URL, { method: 'POST', headers, body });
  const j = await res.json();
  // Audio-only first when it's actually served with a URL (smaller download),
  // else the progressive format — which is what YouTube serves without a
  // PoToken today, and the only one that streams a whole track.
  const fmt =
    pickAudioOnlyFormat(j?.streamingData?.adaptiveFormats) ??
    pickProgressiveFormat(j?.streamingData?.formats);
  if (!fmt) {
    console.warn(
      `playerRequest(${client.name}) for ${id}: no audio URL in response.`,
      `playability=${j?.playabilityStatus?.status ?? 'unknown'}`,
      `reason=${j?.playabilityStatus?.reason ?? 'none'}`,
    );
  }
  return fmt;
}

/**
 * Quick validation — confirms the URL serves media, and that it serves the
 * *whole* track rather than only a teaser.
 *
 * Two ranged GETs, both bounded on purpose: PoToken-gated adaptive URLs
 * answer `bytes=0-` and un-ranged GETs with 403, so an open-ended probe would
 * report even a partly-working URL as dead. The second probe at the 1 MiB mark
 * is what catches the teaser case — those URLs serve the opening bytes fine
 * and then 403 every offset at or past 1 MiB, which would cut a track off
 * about a minute in.
 *
 * Network flakes return true (don't block playback on transient errors); only
 * a definite upstream refusal returns false.
 */
const CAP_PROBE_OFFSET = 1024 * 1024;

async function isUrlPlayable(
  url: string,
  ua: string,
  totalLength: number,
): Promise<boolean> {
  const probe = async (range: string): Promise<number | null> => {
    try {
      const res = await withTimeout(
        fetch(url, { headers: { Range: range, 'User-Agent': ua } }),
        6000,
        'url probe',
      );
      try {
        await (res as any).body?.cancel?.();
      } catch {}
      return res.status;
    } catch {
      return null; // probe flaky — treated as inconclusive
    }
  };

  const first = await probe('bytes=0-1023');
  if (first !== null && first !== 200 && first !== 206) {
    return false;
  }

  // Only meaningful when the track is actually longer than the cap.
  if (totalLength > CAP_PROBE_OFFSET) {
    const deep = await probe(
      `bytes=${CAP_PROBE_OFFSET}-${CAP_PROBE_OFFSET + 1023}`,
    );
    if (deep !== null && deep !== 200 && deep !== 206) {
      console.warn(
        `stream url is capped — offset ${CAP_PROBE_OFFSET} returned ${deep}`,
      );
      return false;
    }
  }
  return true;
}

/**
 * Extract a playable audio URL for a video id (no backend). Tries the player
 * client chain (ANDROID → IOS → ANDROID_VR) and returns the first URL that
 * validates as serving a whole track. Returns null on total failure so
 * callers can fall back to the backend chain.
 *
 * In practice ANDROID wins with the progressive itag 18 format — see
 * PLAYER_CLIENTS for why the others don't.
 */
export interface StreamResult {
  url: string;
  userAgent: string;
  /** Total byte size, or 0 when unknown (proxy probes for it instead). */
  contentLength: number;
  mimeType: string;
  /** True when the format is muxed progressive rather than audio-only. */
  progressive: boolean;
}

export async function resolveStreamUrlOnDevice(
  id: string,
): Promise<StreamResult | null> {
  try {
    const cookieStr = '';

    for (const client of PLAYER_CLIENTS) {
      try {
        const fmt = await withTimeout(
          playerRequest(client, id, cookieStr),
          12000,
          'yt player',
        );
        if (!fmt) {
          continue;
        }
        const ok = await isUrlPlayable(
          fmt.url,
          client.userAgent,
          fmt.contentLength,
        );
        if (ok) {
          console.log(
            'on-device stream url for',
            id,
            `(${client.name}, ${fmt.progressive ? 'progressive' : 'audio-only'},`,
            `${fmt.mimeType}, ${fmt.contentLength} bytes)`,
          );
          return {
            url: fmt.url,
            userAgent: client.userAgent,
            contentLength: fmt.contentLength,
            mimeType: fmt.mimeType,
            progressive: fmt.progressive,
          };
        }
        console.warn(
          'on-device stream for',
          id,
          `(${client.name}) failed validation`,
        );
      } catch (e) {
        console.warn(
          `on-device extraction (${client.name}) failed for`,
          id,
          ':',
          e,
        );
      }
    }

    console.warn('on-device stream extraction returned no playable url for', id);
    visitorSession = null;
    return null;
  } catch (e) {
    console.warn('on-device stream extraction failed:', e);
    return null;
  }
}
