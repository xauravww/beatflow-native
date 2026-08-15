import { getSpotifySetting } from '../db/spotify';
import { buildSpotifyTotpParams } from './totp';

/**
 * Mint a Spotify access token the same way the web player does
 * (reverse-engineered — no developer app, no OAuth, no premium owner).
 *
 * - No cookie  → anonymous token (public playlists, search, metadata).
 * - sp_dc      → user token (liked songs, private playlists, profile).
 *
 * Primary endpoint: `open.spotify.com/api/token` (TOTP-protected — the
 * current web-player flow, same as SpotAPI). Falls back to the legacy
 * `open.spotify.com/get_access_token` on networks where one of them is
 * blocked. Some networks block both — the error message tells the user
 * to try mobile data / a different network.
 */
const LEGACY_TOKEN_URL =
  'https://open.spotify.com/get_access_token?reason=transport&productType=web_player';

export interface SpotifyToken {
  accessToken: string;
  isAnonymous: boolean;
  username: string | null;
  expiresAt: number;
  /** Web-player client id returned by the token endpoint (used for Client-Token). */
  clientId: string;
}

let cached: SpotifyToken | null = null;

function parseToken(text: string): SpotifyToken | null {
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data?.accessToken) {
    return null;
  }
  return {
    accessToken: data.accessToken,
    isAnonymous: !!data.isAnonymous,
    username: data.username || null,
    expiresAt:
      data.accessTokenExpirationTimestampMs || Date.now() + 60 * 60 * 1000,
    clientId: data.clientId || '',
  };
}

async function mintViaTotp(spDc: string | null): Promise<SpotifyToken | null> {
  const params = await buildSpotifyTotpParams();
  const query =
    `reason=init&productType=web-player` +
    `&totp=${params.totp}&totpVer=${params.totpVer}&totpServer=${params.totpServer}`;
  const headers: Record<string, string> = {};
  if (spDc) {
    headers.Cookie = `sp_dc=${spDc}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://open.spotify.com/api/token?${query}`, {
      headers,
      signal: controller.signal,
    });
    return parseToken(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function mintViaLegacy(spDc: string | null): Promise<SpotifyToken | null> {
  const headers: Record<string, string> = {};
  if (spDc) {
    headers.Cookie = `sp_dc=${spDc}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(LEGACY_TOKEN_URL, {
      headers,
      signal: controller.signal,
    });
    return parseToken(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function mint(spDc: string | null): Promise<SpotifyToken> {
  // Try the current TOTP endpoint first, then the legacy one.
  for (const fn of [() => mintViaTotp(spDc), () => mintViaLegacy(spDc)]) {
    const token = await fn();
    if (token) {
      return token;
    }
  }
  throw new Error(
    'Could not get a Spotify token. Try mobile data or a different network.',
  );
}

/** Return a valid token, minting a fresh one when needed. */
export async function getSpotifyToken(force = false): Promise<SpotifyToken> {
  const spDc = await getSpotifySetting('sp_dc');
  if (
    !force &&
    cached &&
    cached.expiresAt > Date.now() + 60 * 1000 &&
    cached.isAnonymous === !spDc
  ) {
    return cached;
  }
  const token = await mint(spDc);
  cached = token;
  return token;
}

export function clearCachedToken(): void {
  cached = null;
}
