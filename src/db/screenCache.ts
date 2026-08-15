import { getDb } from './database';

/**
 * SQLite-backed JSON cache for screen data (home feed, library, playlist,
 * artist tracks, stats). Survives app restarts: on launch we hydrate it
 * into memory so screens render instantly instead of showing skeletons.
 */
export async function getScreenCache(key: string): Promise<unknown | null> {
  try {
    const db = await getDb();
    const [res] = await db.executeSql(
      'SELECT value FROM screen_cache WHERE key = ?',
      [key],
    );
    const row = res.rows.item(0);
    if (!row) {
      return null;
    }
    return JSON.parse(row.value as string);
  } catch (e) {
    console.warn(`getScreenCache(${key}) failed:`, e);
    return null;
  }
}

export async function setScreenCache(
  key: string,
  value: unknown,
): Promise<void> {
  try {
    const db = await getDb();
    await db.executeSql(
      'INSERT OR REPLACE INTO screen_cache (key, value, cachedAt) VALUES (?, ?, ?)',
      [key, JSON.stringify(value), Date.now()],
    );
  } catch (e) {
    console.warn(`setScreenCache(${key}) failed:`, e);
  }
}

/**
 * Load every persisted screen cache into the in-memory store. Called once
 * at app startup (after initDb) so the first paint of every screen already
 * has data and never flashes a skeleton.
 */
export async function hydrateScreenCaches(
  hydrate: (key: string, value: unknown) => void,
): Promise<void> {
  try {
    const db = await getDb();
    const [res] = await db.executeSql(
      'SELECT key, value FROM screen_cache',
    );
    const rows = res.rows.raw() as { key: string; value: string }[];
    for (const row of rows) {
      try {
        hydrate(row.key, JSON.parse(row.value));
      } catch {
        // skip corrupt entries
      }
    }
  } catch (e) {
    console.warn('hydrateScreenCaches failed:', e);
  }
}
