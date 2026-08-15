import { getDb } from './database';

export interface CachedLyrics {
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

export async function getCachedLyrics(
  songId: string,
): Promise<CachedLyrics | null> {
  const database = await getDb();
  const [result] = await database.executeSql(
    'SELECT syncedLyrics, plainLyrics FROM lyrics_cache WHERE songId = ?',
    [songId],
  );
  const rows = result.rows.raw() as CachedLyrics[];
  return rows[0] || null;
}

export async function cacheLyrics(
  songId: string,
  syncedLyrics: string | null,
  plainLyrics: string | null,
): Promise<void> {
  const database = await getDb();
  await database.executeSql(
    `INSERT OR REPLACE INTO lyrics_cache (songId, syncedLyrics, plainLyrics, cachedAt)
     VALUES (?, ?, ?, ?)`,
    [songId, syncedLyrics, plainLyrics, Date.now()],
  );
}
