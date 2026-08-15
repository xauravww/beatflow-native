/**
 * BeatFlow backend — self-hosted music server.
 *
 * Endpoints:
 *   GET /api/ytmusic?q=...   → YouTube Music search results (array of songs)
 *   GET /api/stream?id=...   → playable audio for a YouTube video id
 *
 * Run with:  npm install && npm start   (default port 3000, override with PORT)
 *
 * Why this looks the way it does:
 *   - Search uses `ytmusic-api` (same package as the working portfolio
 *     backend). If the YouTube Music endpoint 400s (datacenter IPs often get
 *     blocked), we transparently fall back to a yt-dlp "ytsearch" scrape so
 *     search never dies on a VPS.
 *   - Streaming prefers a REAL yt-dlp binary (system `yt-dlp`, or the
 *     standalone binary `backend/bin/yt-dlp` installed by `npm run setup` —
 *     no Python required). Each candidate URL is validated with a ranged GET
 *     before being returned, so the app never receives a dead/blocked URL.
 *     Fallback chain: yt-dlp clients → Piped public instances → play-dl.
 *   - Extracted URLs are cached (15 min) and concurrent requests for the same
 *     video are deduped so we never hammer YouTube into 429/bot checks.
 */
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import YTMusic from 'ytmusic-api';
import { stream as playdlStream } from 'play-dl';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
// Optional: path to a cookies.txt so YouTube stops the "confirm you're not
// a bot" check. Export one from your browser (see backend/README.md).
const COOKIES_FILE = process.env.YT_COOKIES || null;

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// YouTube Music search
// ---------------------------------------------------------------------------

let ytmusic = null;
let ytmusicReady = false;

async function getYTMusic() {
  if (!ytmusic) {
    ytmusic = new YTMusic();
  }
  if (!ytmusicReady) {
    await ytmusic.initialize();
    ytmusicReady = true;
  }
  return ytmusic;
}

/** Search via yt-dlp's "ytsearch" as a fallback when ytmusic-api is blocked. */
async function searchViaYtDlp(query, limit = 25) {
  const bin = await findYtdlp();
  if (!bin) {
    return [];
  }
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--flat-playlist',
    '-J',
    `ytsearch${Math.min(limit, 25)}:${query}`,
  ];
  if (COOKIES_FILE) {
    args.push('--cookies', COOKIES_FILE);
  }
  const { stdout } = await execFileAsync(bin, args, {
    timeout: 45000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const data = JSON.parse(stdout);
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return entries
    .filter((e) => e && e.id)
    .map((e) => ({
      videoId: e.id,
      name: e.title || 'Unknown',
      artist: { name: e.channel || 'Unknown Artist' },
      album: { name: e.album || undefined },
      duration: e.duration ?? undefined,
      thumbnails: e.thumbnails?.map((t) => ({ url: t.url })) || [],
      type: 'SONG',
    }));
}

app.get('/', (_req, res) => {
  res.json({
    name: 'BeatFlow backend',
    endpoints: ['/api/ytmusic?q=...', '/api/stream?id=...'],
  });
});

/**
 * GET /api/ytmusic?q=<query>
 * Returns the same song shape the app expects:
 *   { type, videoId, name, artist, album, duration, thumbnails }
 */
app.get('/api/ytmusic', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing ?q= query parameter' });
  }
  try {
    const client = await getYTMusic();
    const songs = await client.searchSongs(query);
    return res.json(songs);
  } catch (e) {
    // ytmusic-api frequently 400s from datacenter IPs — fall back to yt-dlp.
    console.warn('ytmusic-api search failed (%s); trying yt-dlp ytsearch…', e.message);
    try {
      const fallback = await searchViaYtDlp(query);
      if (fallback.length > 0) {
        return res.json(fallback);
      }
    } catch (e2) {
      console.warn('yt-dlp ytsearch fallback also failed:', e2.message);
    }
    res.status(502).json({ error: 'Search failed' });
  }
});

// ---------------------------------------------------------------------------
// Audio streaming
// ---------------------------------------------------------------------------

const STREAM_TTL_MS = 15 * 60 * 1000; // reuse resolved URLs for 15 minutes

/** id → { url, expiresAt } — avoids re-extracting the same track repeatedly. */
const streamCache = new Map();
/** id → in-flight Promise — concurrent requests share one extraction. */
const inflight = new Map();

function getCachedStream(id) {
  const hit = streamCache.get(id);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.url;
  }
  streamCache.delete(id);
  return null;
}

function cacheStream(id, url) {
  streamCache.set(id, { url, expiresAt: Date.now() + STREAM_TTL_MS });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Locate a usable yt-dlp binary, in priority order:
 *   1. $YTDLP_BIN env var (explicit override)
 *   2. backend/bin/yt-dlp — standalone binary from `npm run setup`
 *      (static build, no Python needed — fixes "Python 3.10 deprecated")
 *   3. system `yt-dlp` on PATH (like the working portfolio backend)
 */
async function findYtdlp() {
  const candidates = [
    process.env.YTDLP_BIN,
    path.join(__dirname, 'bin', 'yt-dlp'),
    'yt-dlp',
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 8000 });
      return bin;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

let ytdlpBinCache = null;
async function getYtdlpBin() {
  if (ytdlpBinCache === null) {
    ytdlpBinCache = (await findYtdlp()) || '';
  }
  return ytdlpBinCache || null;
}

/**
 * yt-dlp player clients, tried in order. The android/ios clients usually
 * bypass YouTube's bot checks (web gets "Sign in to confirm you're not a
 * bot"). `null` = default client.
 */
const YTDLP_CLIENTS = [null, 'android', 'ios', 'tv', 'web'];

async function resolveWithYtdlp(videoUrl) {
  const bin = await getYtdlpBin();
  if (!bin) {
    console.warn('No yt-dlp binary found (run `npm run setup` or install yt-dlp)');
    return null;
  }

  for (const client of YTDLP_CLIENTS) {
    const args = [
      '--no-playlist',
      '--no-warnings',
      // IPv4-signed URLs play far more reliably on mobile networks.
      '--force-ipv4',
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=opus]/bestaudio',
      '-g',
    ];
    if (client) {
      args.push('--extractor-args', `youtube:player_client=${client}`);
    }
    if (COOKIES_FILE) {
      args.push('--cookies', COOKIES_FILE);
    }
    args.push(videoUrl);

    try {
      const { stdout } = await execFileAsync(bin, args, {
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      });
      const url = stdout.trim().split('\n')[0];
      if (url && (await isUrlPlayable(url))) {
        return url;
      }
    } catch (e) {
      const msg = String(e?.message || e).split('\n')[0];
      console.warn(`yt-dlp (client ${client ?? 'default'}) failed for ${videoUrl}: ${msg}`);
    }
    if (client !== YTDLP_CLIENTS[YTDLP_CLIENTS.length - 1]) {
      await delay(700); // gentle backoff between attempts
    }
  }
  return null;
}

/** Piped public instances — independent YouTube frontends, decent fallback. */
const PIPED_INSTANCES = [
  'pipedapi.kavin.rocks',
  'pipedapi.leptons.xyz',
  'api.piped.yt',
];

async function resolveWithPiped(id) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`https://${instance}/streams/${id}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        continue;
      }
      const data = await res.json();
      if (!Array.isArray(data.audioStreams)) {
        continue;
      }
      const audio = data.audioStreams
        .filter((s) => s && s.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (audio.length === 0) {
        continue;
      }
      // Prefer AAC (m4a) — plays everywhere (ExoPlayer + AVPlayer).
      const m4a = audio.find((s) => (s.mimeType || '').includes('audio/mp4'));
      const url = (m4a || audio[0]).url;
      if (url && (await isUrlPlayable(url))) {
        return url;
      }
    } catch (e) {
      console.warn(`Piped ${instance} failed for ${id}:`, e.message);
    }
  }
  return null;
}

/** play-dl — last resort, in-process extraction piped to the client. */
async function resolveWithPlayDl(id) {
  try {
    const audio = await playdlStream(`https://www.youtube.com/watch?v=${id}`);
    return audio;
  } catch (e) {
    console.warn(`play-dl failed for ${id}:`, e.message);
    return null;
  }
}

/**
 * Confirm a URL actually serves audio before redirecting to it.
 * A cheap ranged GET (first 1KB) — 200/206 means playable; 403/404 means
 * expired/blocked, so we move to the next fallback instead of handing the
 * app a dead URL.
 */
async function isUrlPlayable(url) {
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-1023' },
      signal: AbortSignal.timeout(8000),
    });
    const ok = res.status === 200 || res.status === 206;
    // release the connection without downloading the rest of the file
    res.body?.getReader?.()?.cancel().catch(() => {});
    return ok;
  } catch {
    return false;
  }
}

/** Resolve a stream URL once per video id (cached + deduped). */
function resolveStream(id) {
  const cached = getCachedStream(id);
  if (cached) {
    return Promise.resolve(cached);
  }
  if (inflight.has(id)) {
    return inflight.get(id);
  }
  const job = (async () => {
    const videoUrl = `https://www.youtube.com/watch?v=${id}`;
    // 1) yt-dlp (system/standalone binary) with client fallbacks
    const url = await resolveWithYtdlp(videoUrl);
    if (url) {
      return url;
    }
    // 2) Piped public instances
    const pipedUrl = await resolveWithPiped(id);
    if (pipedUrl) {
      return pipedUrl;
    }
    return null;
  })().finally(() => {
    inflight.delete(id);
  });
  inflight.set(id, job);
  return job;
}

/**
 * GET /api/stream?id=<videoId>
 * Redirects (302) to a validated, playable audio URL. Falls back to piping
 * via play-dl when neither yt-dlp nor Piped can resolve the video.
 */
app.get('/api/stream', async (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    return res.status(400).json({ error: 'Missing or invalid ?id= parameter' });
  }

  const cached = getCachedStream(id);
  const url = cached || (await resolveStream(id));
  if (url) {
    cacheStream(id, url);
    return res.redirect(302, url);
  }

  // Last resort: play-dl in-process extraction, piped to the client.
  const audio = await resolveWithPlayDl(id);
  if (audio) {
    res.setHeader(
      'Content-Type',
      audio.type === 'video' ? 'audio/mp4' : 'audio/mpeg',
    );
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    audio.stream.pipe(res);
    audio.stream.on('error', (err) => {
      console.error('stream pipe error:', err.message);
      res.destroy();
    });
    req.on('close', () => {
      audio.stream.destroy();
    });
    return;
  }

  res.status(502).json({ error: 'Stream unavailable' });
});

app.listen(PORT, () => {
  console.log(`🎵 BeatFlow backend listening on http://localhost:${PORT}`);
  console.log(
    `   Search:  http://localhost:${PORT}/api/ytmusic?q=never+gonna+give+you+up`,
  );
  console.log(`   Stream:  http://localhost:${PORT}/api/stream?id=<videoId>`);
  if (COOKIES_FILE) {
    console.log(`   Cookies: ${COOKIES_FILE}`);
  }
});
