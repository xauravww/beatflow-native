import { NativeModules } from 'react-native';

/**
 * Wrapper around the native in-app streaming server (StreamServerModule.kt).
 *
 * The server runs standalone inside the app (bound to 127.0.0.1) and proxies
 * the direct YouTube audio URL. This exists because googlevideo answers the
 * requests ExoPlayer makes natively with 403:
 *
 *   Range: bytes=0-1023  -> 206
 *   Range: bytes=0-       -> 403   <- what ExoPlayer sends
 *   (no Range header)     -> 403
 *
 * The proxy serves the player correct whole-file range/length semantics while
 * fetching upstream in bounded windows. Streaming stays entirely on-device —
 * no backend server.
 */

interface StreamServerNative {
  start(port: number): Promise<boolean>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
  registerUrl(
    videoId: string,
    url: string,
    userAgent: string | null,
    contentLength: number,
    contentType: string | null,
  ): void;
  clearUrls(): void;
}

const native = NativeModules.StreamServer as StreamServerNative | undefined;

export const STREAM_SERVER_PORT = 8642;
export const STREAM_SERVER_BASE = `http://127.0.0.1:${STREAM_SERVER_PORT}`;

let started = false;

/** Start the local server once (idempotent). Returns false if unavailable. */
export async function ensureStreamServer(): Promise<boolean> {
  if (!native) {
    return false;
  }
  if (started) {
    return true;
  }
  try {
    started = await native.start(STREAM_SERVER_PORT);
    if (started) {
      console.log(`in-app stream server listening on :${STREAM_SERVER_PORT}`);
    }
    return started;
  } catch (e) {
    console.warn('in-app stream server start failed:', e);
    return false;
  }
}

/**
 * Register the direct googlevideo URL for a video id and return the local
 * proxy URL ExoPlayer should play from. Returns null when the server isn't
 * available (caller falls back to the backend).
 *
 * `contentLength` lets the proxy answer with the real total size straight
 * away; pass 0 when unknown and it probes upstream instead.
 */
export async function registerStream(
  videoId: string,
  directUrl: string,
  userAgent?: string,
  contentLength = 0,
  contentType?: string,
): Promise<string | null> {
  if (!(await ensureStreamServer())) {
    return null;
  }
  try {
    native!.registerUrl(
      videoId,
      directUrl,
      userAgent ?? null,
      contentLength,
      contentType ?? null,
    );
    return `${STREAM_SERVER_BASE}/stream/${encodeURIComponent(videoId)}`;
  } catch (e) {
    console.warn('in-app stream server register failed:', e);
    return null;
  }
}
