/**
 * BeatFlow backend — self-hosted music server.
 *
 * Endpoints:
 *   GET /api/ytmusic?q=...   → YouTube Music search results (array of songs)
 *   GET /api/stream?id=...   → playable audio for a YouTube video id
 *
 * Run with:  npm install && npm start   (default port 3000, override with PORT)
 *
 * Streaming is resilient on purpose: extracted URLs are cached for 15 min,
 * concurrent requests for the same video are deduped, and yt-dlp retries
 * with different player clients (android/ios/tv/web) before giving up — so
 * the app doesn't hammer YouTube and trigger 429 / bot checks.
 */
import express from 'express';
import cors from 'cors';
import YTMusic from 'ytmusic-api';
import youtubedl from 'youtube-dl-exec';
import { stream as playdlStream } from 'play-dl';

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
async function getYTMusic() {
  if (!ytmusic) {
    ytmusic = new YTMusic();
    await ytmusic.initialize();
  }
  return ytmusic;
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
    res.json(songs);
  } catch (e) {
    console.error('ytmusic search error:', e.message);
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
 * yt-dlp client attempts, in order. The android/ios clients usually bypass
 * YouTube's bot checks (web gets "Sign in to confirm you're not a bot").
 */
const YTDLP_CLIENTS = [
  {},
  { extractorArgs: 'youtube:player_client=android' },
  { extractorArgs: 'youtube:player_client=ios' },
  { extractorArgs: 'youtube:player_client=tv' },
  { extractorArgs: 'youtube:player_client=web' },
];

function firstLine(value) {
  const line = String(value).trim().split('\n')[0];
  return line || null;
}

async function resolveWithYtdlp(videoUrl) {
  for (let i = 0; i < YTDLP_CLIENTS.length; i++) {
    const opts = {
      format: 'bestaudio[ext=m4a]/bestaudio[ext=opus]/bestaudio',
      getUrl: true,
      noWarnings: true,
      noPlaylist: true,
      ...YTDLP_CLIENTS[i],
    };
    if (COOKIES_FILE) {
      opts.cookies = COOKIES_FILE;
    }
    try {
      const url = firstLine(await youtubedl(videoUrl, opts));
      if (url) {
        return url;
      }
    } catch (e) {
      const msg = String(e?.message || e).split('\n')[0];
      console.warn(`yt-dlp (client #${i + 1}) failed for ${videoUrl}: ${msg}`);
    }
    if (i < YTDLP_CLIENTS.length - 1) {
      await delay(700 + i * 400); // gentle backoff between attempts
    }
  }
  return null;
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
  const job = resolveWithYtdlp(`https://www.youtube.com/watch?v=${id}`)
    .then((url) => {
      if (url) {
        cacheStream(id, url);
      }
      return url;
    })
    .finally(() => {
      inflight.delete(id);
    });
  inflight.set(id, job);
  return job;
}

/**
 * GET /api/stream?id=<videoId>
 * Serves the raw playable audio for a YouTube video, redirecting (302) to
 * the direct audio URL. Falls back to piping via play-dl when yt-dlp can't
 * resolve the video.
 */
app.get('/api/stream', async (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    return res.status(400).json({ error: 'Missing or invalid ?id= parameter' });
  }

  const url = await resolveStream(id);
  if (url) {
    return res.redirect(302, url);
  }

  // Last resort: play-dl in-process extraction, piped to the client.
  try {
    const audio = await playdlStream(`https://www.youtube.com/watch?v=${id}`);
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
  } catch (e) {
    console.warn(`play-dl fallback failed for ${id}:`, e.message);
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
