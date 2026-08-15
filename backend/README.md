# 🎵 BeatFlow Backend

The self-hosted music backend for BeatFlow — an Express server that powers
search (`ytmusic-api` with a `yt-dlp` ytsearch fallback) and audio streaming
(standalone `yt-dlp` binary with URL validation + Piped + `play-dl`
fallbacks). No accounts, no keys, no database.

## Quick start

```sh
cd backend
npm run setup       # npm install + downloads standalone yt-dlp (no Python needed)
npm start           # http://localhost:3000
```

For development with auto-reload: `npm run dev`.

> **On a fresh VPS, just run `npm run setup`** — it installs the deps *and* a
> static `yt-dlp` binary into `backend/bin/yt-dlp`. The static build needs no
> Python, so it works even on servers with old Python (3.10) that newer
> `yt-dlp` refuses to run on.

## Verify it works

```sh
# Search (returns JSON array of songs)
curl "http://localhost:3000/api/ytmusic?q=never+gonna+give+you+up"

# Stream audio (302-redirects to the playable audio URL)
curl -L "http://localhost:3000/api/stream?id=<videoId>" -o test.mp4
```

## Point the app at it

1. Run the backend on your machine (or any always-on server).
2. In BeatFlow → **Settings → Backend URL**, enter your server's address
   and tap **Save**. That's it — search, streaming and downloads all use
   your server.

> ⚠️ **Running on a local PC?** Your PC and your phone must be connected to
> the **same Wi-Fi network**. Use your computer's **LAN IP** — it usually
> looks like **`192.168.x.x`** — and never use `localhost` / `127.0.0.1`
> from the phone.
>
> **Finding your IP:**
> - **Windows:** `Win + R` → type `cmd` → run `ipconfig` → look for
>   **“IPv4 Address”** (starts with `192.168`)
> - **Mac:** Terminal → `ipconfig getifaddr en0`
> - **Linux:** `ip a` → look for the `inet 192.168.x.x` line

## Getting help

- App & backend source: [github.com/xauravww/beatflow-native](https://github.com/xauravww/beatflow-native)
- Still having issues? Contact the maker anytime:
  sauravmaheshwari8@gmail.com · [Discord server](https://discord.gg/jcaVcarRU5)

## How it works

| Endpoint | What it does |
|---|---|
| `GET /api/ytmusic?q=…` | Searches YouTube Music via `ytmusic-api` (falls back to a `yt-dlp` ytsearch scrape when YouTube Music blocks the server IP), returns songs as JSON |
| `GET /api/stream?id=…` | Resolves a **validated** playable audio URL (302 redirect). Chain: `yt-dlp` (5 player clients) → Piped public instances → `play-dl` pipe |

## Streaming internals

Stream extraction uses a **real `yt-dlp` binary** — the standalone static
build at `backend/bin/yt-dlp` (from `npm run setup`, no Python required),
then the system `yt-dlp` on PATH, then `$YTDLP_BIN`. It mirrors the exact
approach that's proven to work in the [portfolio music app](https://github.com/xauravww/portfolio-xauravww-nextjs).

The backend is careful not to upset YouTube:
- **Caches** resolved stream URLs for 15 minutes — replaying a song never
  re-extracts it.
- **Dedupes** concurrent requests for the same video (one extraction, shared
  by everyone).
- **Validates every URL** (cheap ranged GET) before redirecting — a dead or
  blocked URL never reaches the app; the chain moves to the next source.
- **Retries with different player clients** (`android`, `ios`, `tv`, `web`)
  with a gentle backoff — the mobile clients usually pass the bot check.

## Streams failing with 429 / "Sign in to confirm you're not a bot"?

YouTube rate-limits and bot-checks the server's IP when it sees too many
anonymous extraction requests (the old default was to re-extract on every
play — that's what trips it). Fixes, in order:

1. **Give it a few minutes.** 429s are temporary — the built-in cache and
   backoff stop the hammering, so it usually clears on its own.
2. **Provide cookies.** Export a `cookies.txt` for youtube.com from your
   browser (e.g. the “Get cookies.txt LOCALLY” extension, or see the
   [yt-dlp FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp))
   and start the server with it:
   ```sh
   YT_COOKIES=/path/to/cookies.txt npm start
   ```
3. **Update yt-dlp** (YouTube changes often):
   ```sh
   npm run update-ytdlp
   ```
4. If you're behind a VPN / cloud host, try a different IP — some ranges
   are pre-flagged by YouTube.

## Deploying on a VPS (the short version)

```sh
# 1. get the code
git clone https://github.com/xauravww/beatflow-native.git
cd beatflow-native/backend

# 2. install everything (deps + standalone yt-dlp, no Python needed)
npm run setup

# 3. run it (use a process manager so it stays alive)
npm install -g pm2
pm2 start "npm start" --name beatflow-backend
pm2 save
pm2 startup   # follow the printed instructions so it survives reboots
```

Then open the firewall port if your VPS has one (`ufw allow 3000`), and in
the app set **Settings → Backend URL** to `http://<vps-ip>:3000`.

### Fixing common VPS errors

| Error | Cause | Fix |
|---|---|---|
| `Cannot find package 'express'` | deps never installed (or `node_modules` wasn't copied) | run `npm run setup` / `npm install` inside `backend/` |
| `Deprecated Feature: Support for Python version 3.10…` | old `youtube-dl-exec` wrapper needs Python 3.11+ | use the standalone binary — `npm run setup` (static build, **no Python**) |
| `ytmusic search error: Request failed with status code 400` | YouTube Music blocks datacenter IPs | automatic — search falls back to a `yt-dlp` ytsearch scrape |
| `Sign in to confirm you're not a bot` | YouTube bot-checks the server IP | `YT_COOKIES=/path/to/cookies.txt npm start` (see below), or a different IP range |

## Hosting

You can run this on **any always-on machine** that has Node 18+ — a VPS, a
home PC, a Raspberry Pi, or a container — and point the app at its IP or
domain.

> 🚫 **Avoid serverless platforms like Vercel.** Streaming needs a real
> running process (bundled `yt-dlp` extraction) and won't work reliably on
> serverless — this is exactly why the backend is designed to be
> self-hosted on a normal server.

> ⚠️ **For educational, personal use only.** This server extracts streams
> from YouTube using unofficial tools (`yt-dlp`/`play-dl`) that may violate
> YouTube's terms of service. It contains no copyrighted media — only use it
> to play content you're authorized to access, don't redistribute anything,
> don't hammer the underlying services, and support the artists you love on
> official platforms.
