#!/usr/bin/env bash
# =============================================================================
# BeatFlow backend — one-command setup for a fresh machine / VPS.
#
#   npm run setup     (or:  bash setup.sh)
#
# Does two things:
#   1. npm install        — installs express/cors/ytmusic-api/play-dl etc.
#   2. downloads a STANDALONE yt-dlp binary into backend/bin/yt-dlp
#
# Why the standalone binary? The `youtube-dl-exec` npm wrapper's bundled
# yt-dlp runs through the system Python, and newer yt-dlp releases refuse to
# run on Python < 3.11 ("Deprecated Feature: Support for Python version 3.10
# has been deprecated"). A static yt-dlp build needs NO Python at all, so it
# just works on any VPS regardless of the installed Python version.
#
# The binary is architecture-aware (x86_64 vs arm64). On macOS it falls back
# to `brew install yt-dlp` (static binaries are Linux-only).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "── Step 1/2: installing npm dependencies ──"
npm install

echo
echo "── Step 2/2: ensuring a standalone yt-dlp binary ──"
if command -v yt-dlp >/dev/null 2>&1; then
  echo "  ✓ system yt-dlp found: $(yt-dlp --version 2>/dev/null | head -1)"
  echo "  (backend prefers backend/bin/yt-dlp when present, then system yt-dlp)"
fi

if [ -x bin/yt-dlp ] && bin/yt-dlp --version >/dev/null 2>&1; then
  echo "  ✓ backend/bin/yt-dlp already present: $(bin/yt-dlp --version 2>/dev/null)"
  exit 0
fi

mkdir -p bin
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)  URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" ;;
  aarch64|arm64) URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64" ;;
  *) echo "  ✖ unsupported arch ($ARCH) for static yt-dlp; install yt-dlp manually"; exit 1 ;;
esac

echo "  downloading standalone yt-dlp ($ARCH)…"
curl -fL --retry 3 -o bin/yt-dlp "$URL"
chmod +x bin/yt-dlp
echo "  ✓ installed backend/bin/yt-dlp: $(bin/yt-dlp --version 2>/dev/null)"

echo
echo "Done! Start with:  npm start   (or  PORT=3001 npm start)"
