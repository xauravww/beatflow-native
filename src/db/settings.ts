import { getDb } from './database';

/** Generic key-value settings backed by the `settings` table. */
export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const [res] = await db.executeSql(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  );
  const row = res.rows.item(0);
  return row ? (row.value as string) : null;
}

export async function setSetting(
  key: string,
  value: string | null,
): Promise<void> {
  const db = await getDb();
  if (value == null) {
    await db.executeSql('DELETE FROM settings WHERE key = ?', [key]);
  } else {
    await db.executeSql(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [key, value],
    );
  }
}

const BACKEND_BASE_URL_KEY = 'backendBaseUrl';
const YT_COOKIES_KEY = 'ytCookies';
const AUTOPLAY_KEY = 'autoplay';

/** Saved custom backend URL override (null = use the built-in defaults). */
export function getBackendBaseUrlSetting(): Promise<string | null> {
  return getSetting(BACKEND_BASE_URL_KEY);
}

export function setBackendBaseUrlSetting(
  url: string | null,
): Promise<void> {
  return setSetting(BACKEND_BASE_URL_KEY, url);
}

/**
 * Saved YouTube cookies (Netscape cookies.txt from a browser logged into
 * YouTube, or a raw `name=value; …` string). Sent with on-device player
 * requests — mirrors the backend's YT_COOKIES and lifts YouTube's ~1MB
 * anonymous-stream cap on flagged networks.
 */
export function getYtCookiesSetting(): Promise<string | null> {
  return getSetting(YT_COOKIES_KEY);
}

export function setYtCookiesSetting(cookies: string | null): Promise<void> {
  return setSetting(YT_COOKIES_KEY, cookies);
}

/**
 * Keep playing similar songs when the queue runs out (YouTube Music radio
 * seeded from the last track). On by default, like Spotify's autoplay — a
 * queue that just stops dead is the single most noticeable difference from a
 * real music app.
 */
export async function getAutoplaySetting(): Promise<boolean> {
  return (await getSetting(AUTOPLAY_KEY)) !== '0';
}

export function setAutoplaySetting(enabled: boolean): Promise<void> {
  return setSetting(AUTOPLAY_KEY, enabled ? '1' : '0');
}
