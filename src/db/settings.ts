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

/** Saved custom backend URL override (null = use the built-in defaults). */
export function getBackendBaseUrlSetting(): Promise<string | null> {
  return getSetting(BACKEND_BASE_URL_KEY);
}

export function setBackendBaseUrlSetting(
  url: string | null,
): Promise<void> {
  return setSetting(BACKEND_BASE_URL_KEY, url);
}
