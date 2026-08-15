# 🎵 BeatFlow

A personal music player for Android/iOS built with React Native — a study
project exploring media playback, background audio, and offline caching.
It lets **you** play and organize music **you have the right to listen to**,
with synced lyrics, playlist management, and listening stats.

> **What this project is:** an educational, personal-use music player.
> **What it is not:** a way to pirate music. No music files are bundled or
distributed in this repository, and you are responsible for only playing
content you're authorized to access.

## ✨ Features

- **Playback** — stream music and control it from the lock screen (`react-native-track-player`)
- **Personal offline cache** — cache tracks for offline listening when you're on the go (for content you have permission to use)
- **Synced lyrics** — karaoke-style highlighting (LRCLIB provider)
- **Spotify import** — bring in public playlists/albums/artists by pasting a link, matched to their YouTube equivalents
- **Search & Library** — find tracks, create playlists, queue, play-next, save to your library
- **Listening stats** — see your most-played tracks & artists
- **No login, no tracking** — your data never leaves your device (SQLite storage)

> ⚠️ **Disclaimer** — This is a **for-education, personal-use** project. It
> relies on **unofficial APIs** (YouTube Music search, direct audio
> extraction via `yt-dlp`/`play-dl`, Spotify's web-player endpoint) that may
> violate the terms of service of those platforms. Use it **only with music
> you're allowed to play**, don't resell or redistribute it, and support the
> artists you love on official platforms.

## ⚖️ Legal & Fair Use

Please read this before using or sharing the project:

- **This repository contains only code** — no copyrighted audio, video, or
  artwork is included. All media is fetched at runtime from third-party
  sources by **you**, the user.
- **You are responsible for what you play.** Only use the app with music you
  own or are otherwise authorized to stream. Do not use it to download or
  redistribute content you don't have rights to.
- **Unofficial APIs may break or be blocked.** The project uses community
  tools (`ytmusic-api`, `yt-dlp`, `play-dl`) that interact with platforms in
  ways those platforms may not permit. Use at your own risk, and don't
  hammer or abuse the underlying services.
- **Respect the platforms.** Don't use this project commercially, don't
  impersonate Spotify or YouTube, and don't build services on top of it that
  redistribute scraped content.
- **Support the artists.** Streaming music has real costs. If you enjoy an
  artist, buy or stream their work through official channels.
- **Not affiliated.** BeatFlow is an independent project and is not
  affiliated with, endorsed by, or connected to Spotify, YouTube, or Google.

If you receive a takedown notice, comply promptly and remove the relevant
parts — this project is meant to be a learning tool, not a legal headache
for anyone.

## 🛠 Tech Stack

| Layer | Choice |
|---|---|
| Framework | React Native 0.86 (CLI) + TypeScript |
| Styling | NativeWind (Tailwind) |
| Playback | react-native-track-player (background + lock-screen) |
| Storage | react-native-sqlite-storage |
| Streaming | `ytmusic-api` (search) + `play-dl` / `yt-dlp` (audio URLs) |
| Lyrics | LRCLIB |
| Spotify | Anonymous TOTP token flow + private web-player API (`api-partner.spotify.com`) |

## 🚀 Getting Started

### Prerequisites

- Node.js 18+, JDK 17+, Android SDK (for Android) / Xcode + CocoaPods (for iOS)
- A backend serving `/api/ytmusic` (search) and `/api/stream` (audio) — the app ships one in [`backend/`](backend/README.md) (see below).

### Install & run

```sh
npm install

# Android (with Metro running in another terminal: npm start)
npm run android

# iOS
bundle install
bundle exec pod install
npm run ios
```

## 🖥 Self-host the backend

The app calls a music backend for search (`/api/ytmusic`) and streaming
(`/api/stream`). A ready-to-run **Node + Express** server lives in
[`backend/`](backend/README.md) — same API as the hosted fallback, but
self-contained so you control search and streaming.

Source: [github.com/xauravww/beatflow-native](https://github.com/xauravww/beatflow-native)

```sh
cd backend
npm install
npm start        # serves http://localhost:3000
```

Then point the app at it:

1. Open BeatFlow → **Your Library → ⚙️ Settings → Custom backend URL**.
2. Enter your server's address and tap **Save**.
3. Done — search, streaming and downloads all use your server. Reset the
   override anytime to go back to the built-in defaults.

### Finding your PC's IP (local setup)

Your PC and your phone must be connected to the **same Wi-Fi network**, and
you need your PC's LAN IP — it usually looks like **`192.168.x.x`**. Never
use `localhost` / `127.0.0.1` from the phone.

- **Windows:** press `Win + R`, type `cmd` and hit Enter. Run `ipconfig` and
  look for **“IPv4 Address”** under your Wi-Fi adapter (starts with `192.168`).
- **Mac:** open Terminal and run `ipconfig getifaddr en0` — it prints the IP
  directly.
- **Linux:** run `ip a` and look for the `inet 192.168.x.x` line.

### Prefer a remote server?

You can deploy the backend on any always-on machine — a **VPS, home PC, or
Raspberry Pi** — and enter its IP or domain in the app. **Avoid serverless
platforms like Vercel**: streaming needs a real running process (bundled
`yt-dlp` extraction) and won't work reliably there.

> Still having issues? Contact the maker anytime:
> sauravmaheshwari8@gmail.com · Join the [Discord server](https://discord.gg/jcaVcarRU5)

> 🚨 **Streams failing with 429 / “Sign in to confirm you’re not a bot”?**
> That's YouTube rate-limiting the server. The backend now caches stream
> URLs and retries with different player clients so it stops happening, and
> exporting cookies fixes it permanently — see [`backend/README.md`](backend/README.md).

> Without an override, the app uses the built-in default backend. Streams
> need a non-serverless host (yt-dlp is bundled with the backend), which is
> why the in-repo backend is the recommended setup.

## 📦 Build a release APK

```sh
cd android && ./gradlew assembleRelease
```

The APK lands at `android/app/build/outputs/apk/release/app-release.apk`. It is signed with the debug keystore (fine for sideloading/sharing). For Play Store distribution, generate your own keystore and point `signingConfigs` at it.

## 🔬 Project structure

```
backend/        # Self-hosted Express server (search + streaming)
src/
├── api/          # Backend API client + types
├── components/
│   ├── player/   # Full player modal, mini player
│   ├── screens/  # Home, Search, Library, Playlist, Artist, Stats, Credits, Settings, Spotify Sync
│   └── ui/       # TrackRow, TrackCard, BottomNav, TrackOptionsSheet, ...
├── context/      # PlayerContext (playback state, queue, toasts)
├── db/           # SQLite (songs, playlists, history, settings)
├── navigation/   # React Navigation stack
├── services/     # track-player, downloads, lyrics, spotify token/data/sync, TOTP
└── theme/        # Spotify-inspired palette
```

## 🧪 Tests & checks

```sh
npx tsc --noEmit   # typecheck
npm run lint       # eslint
npx jest           # unit tests (TOTP/RFC 6238 vectors)
```

## 👤 Credits

Built with ❤️ by [xauravww](https://github.com/xauravww) — [portfolio](https://xauravww.vercel.app) · sauravmaheshwari8@gmail.com

Powered by: `ytmusic-api`, `play-dl`, LRCLIB, `react-native-track-player`, React Native + NativeWind.
