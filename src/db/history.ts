import { Song } from '../api/types';
import { getDb } from './database';

/**
 * Record that a song started playing.
 * Returns the new row id so callers can accumulate real play time onto it.
 */
export async function logPlay(song: Song): Promise<number> {
  const database = await getDb();
  const [result] = await database.executeSql(
    `INSERT INTO history (songId, title, artist, cover, duration, playedSeconds, playedAt)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [
      song.id,
      song.title,
      song.artist,
      song.cover,
      song.duration ?? null,
      Date.now(),
    ],
  );
  return result.insertId;
}

/** Add real listening seconds to an existing history row. */
export async function addPlayedSeconds(
  rowId: number,
  seconds: number,
): Promise<void> {
  if (seconds <= 0) {
    return;
  }
  const database = await getDb();
  await database.executeSql(
    'UPDATE history SET playedSeconds = playedSeconds + ? WHERE id = ?',
    [Math.round(seconds), rowId],
  );
}

/** Distinct recently played songs (latest first), deduped by song id. */
export async function getRecentPlays(limit = 12): Promise<Song[]> {
  const database = await getDb();
  const [result] = await database.executeSql(
    'SELECT * FROM history ORDER BY playedAt DESC LIMIT 200',
  );
  const rows = result.rows.raw() as any[];
  const seen = new Set<string>();
  const songs: Song[] = [];
  for (const row of rows) {
    if (seen.has(row.songId)) {
      continue;
    }
    seen.add(row.songId);
    songs.push({
      id: row.songId,
      title: row.title,
      artist: row.artist || 'Unknown Artist',
      cover: row.cover || '',
      duration: row.duration ?? undefined,
    });
    if (songs.length >= limit) {
      break;
    }
  }
  return songs;
}

export interface PlayStats {
  totalPlays: number;
  totalMinutes: number;
  topArtists: { name: string; plays: number }[];
  topSongs: { song: Song; plays: number }[];
}

export async function getStats(): Promise<PlayStats> {
  const database = await getDb();
  const [totalResult] = await database.executeSql(
    'SELECT COUNT(*) AS plays, COALESCE(SUM(playedSeconds), 0) AS seconds FROM history',
  );
  const totals = totalResult.rows.item(0) as {
    plays: number;
    seconds: number;
  };

  const [artistsResult] = await database.executeSql(
    `SELECT artist, COUNT(*) AS plays FROM history
     WHERE artist IS NOT NULL AND artist != ''
     GROUP BY artist ORDER BY plays DESC, MAX(playedAt) DESC LIMIT 6`,
  );
  const topArtists = (artistsResult.rows.raw() as any[]).map((r) => ({
    name: r.artist,
    plays: r.plays,
  }));

  const [songsResult] = await database.executeSql(
    `SELECT songId, title, artist, cover, COUNT(*) AS plays
     FROM history GROUP BY songId
     ORDER BY plays DESC, MAX(playedAt) DESC LIMIT 6`,
  );
  const topSongs = (songsResult.rows.raw() as any[]).map((r) => ({
    song: {
      id: r.songId,
      title: r.title,
      artist: r.artist || 'Unknown Artist',
      cover: r.cover || '',
    } as Song,
    plays: r.plays,
  }));

  return {
    totalPlays: totals.plays,
    totalMinutes: Math.round(totals.seconds / 60),
    topArtists,
    topSongs,
  };
}
