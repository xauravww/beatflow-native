import { getDb } from './database';

export interface CachedLyrics {
  syncedLyrics: string | null;
  plainLyrics: string | null;
  /** Runtime (s) of the lyric version we matched; 0 when unknown. */
  matchedDuration: number;
}

export async function getCachedLyrics(
  songId: string,
): Promise<CachedLyrics | null> {
  const database = await getDb();
  const [result] = await database.executeSql(
    'SELECT syncedLyrics, plainLyrics, matchedDuration FROM lyrics_cache WHERE songId = ?',
    [songId],
  );
  const rows = result.rows.raw() as CachedLyrics[];
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { ...row, matchedDuration: Number(row.matchedDuration) || 0 };
}

export async function cacheLyrics(
  songId: string,
  syncedLyrics: string | null,
  plainLyrics: string | null,
  matchedDuration = 0,
): Promise<void> {
  const database = await getDb();
  await database.executeSql(
    `INSERT OR REPLACE INTO lyrics_cache (songId, syncedLyrics, plainLyrics, cachedAt, matchedDuration)
     VALUES (?, ?, ?, ?, ?)`,
    [songId, syncedLyrics, plainLyrics, Date.now(), matchedDuration],
  );
}
