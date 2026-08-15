import { Song } from '../api/types';
import { getDb } from './database';

interface SongRow {
  id: string;
  title: string;
  artist: string | null;
  cover: string | null;
  album: string | null;
  duration: number | null;
  isDownloaded: number;
  localPath: string | null;
  addedAt: number | null;
}

function rowToSong(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist || 'Unknown Artist',
    cover: row.cover || '',
    album: row.album || undefined,
    duration: row.duration ?? undefined,
    isDownloaded: row.isDownloaded === 1,
    localPath: row.localPath,
  };
}

/**
 * Ensure a song's metadata lives in the catalog (`songs` table). This is
 * the shared metadata store for playlists + downloads — it does NOT mean
 * the song is liked/saved to Your Library.
 */
export async function upsertSong(song: Song): Promise<void> {
  const database = await getDb();
  const existing = await getSongRow(song.id);
  await database.executeSql(
    `INSERT OR REPLACE INTO songs
       (id, title, artist, cover, album, duration, isDownloaded, localPath, addedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      song.id,
      song.title,
      song.artist,
      song.cover,
      song.album || null,
      song.duration ?? null,
      existing?.isDownloaded ?? 0,
      existing?.localPath ?? null,
      existing?.addedAt ?? Date.now(),
    ],
  );
}

/** Like/save a song to "Your Library" (saved_songs) + ensure catalog metadata. */
export async function saveSong(song: Song): Promise<void> {
  const database = await getDb();
  await upsertSong(song);
  await database.executeSql(
    'INSERT OR IGNORE INTO saved_songs (id, savedAt) VALUES (?, ?)',
    [song.id, Date.now()],
  );
}

export async function getSavedSongs(): Promise<Song[]> {
  const database = await getDb();
  const [result] = await database.executeSql(
    `SELECT s.* FROM saved_songs sv
     JOIN songs s ON s.id = sv.id
     ORDER BY sv.savedAt DESC`,
  );
  const rows = result.rows.raw() as SongRow[];
  return rows.map(rowToSong);
}

export async function getDownloadedSongs(): Promise<Song[]> {
  const database = await getDb();
  const [result] = await database.executeSql(
    'SELECT * FROM songs WHERE isDownloaded = 1 ORDER BY addedAt DESC',
  );
  const rows = result.rows.raw() as SongRow[];
  return rows.map(rowToSong);
}

export async function isSongSaved(id: string): Promise<boolean> {
  const database = await getDb();
  const [result] = await database.executeSql(
    'SELECT 1 FROM saved_songs WHERE id = ?',
    [id],
  );
  const rows = result.rows.raw() as { '1': number }[];
  return rows.length > 0;
}

export async function removeSavedSong(id: string): Promise<void> {
  const database = await getDb();
  await database.executeSql('DELETE FROM saved_songs WHERE id = ?', [id]);
}

async function getSongRow(id: string): Promise<SongRow | null> {
  const database = await getDb();
  const [result] = await database.executeSql(
    'SELECT * FROM songs WHERE id = ?',
    [id],
  );
  const rows = result.rows.raw() as SongRow[];
  return rows[0] || null;
}

export async function markDownloaded(
  id: string,
  localPath: string,
): Promise<void> {
  const database = await getDb();
  await database.executeSql(
    'UPDATE songs SET isDownloaded = 1, localPath = ? WHERE id = ?',
    [localPath, id],
  );
}

export async function clearDownload(id: string): Promise<void> {
  const database = await getDb();
  await database.executeSql(
    'UPDATE songs SET isDownloaded = 0, localPath = NULL WHERE id = ?',
    [id],
  );
}
