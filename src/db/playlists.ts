import { Song } from '../api/types';
import { getDb } from './database';

export interface Playlist {
  id: number;
  name: string;
  createdAt: number;
  songCount: number;
  cover?: string | null;
}

export async function createPlaylist(name: string): Promise<number> {
  const database = await getDb();
  const [result] = await database.executeSql(
    'INSERT INTO playlists (name, createdAt) VALUES (?, ?)',
    [name, Date.now()],
  );
  return result.insertId;
}

export async function getPlaylists(): Promise<Playlist[]> {
  const database = await getDb();
  const [result] = await database.executeSql(
    `SELECT p.*,
       COUNT(ps.songId) AS songCount,
       (SELECT s.cover FROM playlist_songs ps2
        JOIN songs s ON s.id = ps2.songId
        WHERE ps2.playlistId = p.id
        ORDER BY ps2.position ASC LIMIT 1) AS cover
     FROM playlists p
     LEFT JOIN playlist_songs ps ON ps.playlistId = p.id
     GROUP BY p.id
     ORDER BY p.createdAt DESC`,
  );
  return result.rows.raw() as Playlist[];
}

export async function renamePlaylist(id: number, name: string): Promise<void> {
  const database = await getDb();
  await database.executeSql('UPDATE playlists SET name = ? WHERE id = ?', [
    name,
    id,
  ]);
}

/** Rewrite the order of a playlist's songs (songIds in desired order). */
export async function setPlaylistOrder(
  playlistId: number,
  songIds: string[],
): Promise<void> {
  const database = await getDb();
  await database.executeSql('BEGIN TRANSACTION');
  try {
    for (let i = 0; i < songIds.length; i++) {
      await database.executeSql(
        'UPDATE playlist_songs SET position = ? WHERE playlistId = ? AND songId = ?',
        [i, playlistId, songIds[i]],
      );
    }
    await database.executeSql('COMMIT');
  } catch (e) {
    await database.executeSql('ROLLBACK');
    throw e;
  }
}

export async function getPlaylistSongs(playlistId: number): Promise<Song[]> {
  const database = await getDb();
  const [result] = await database.executeSql(
    `SELECT s.* FROM playlist_songs ps
     JOIN songs s ON s.id = ps.songId
     WHERE ps.playlistId = ?
     ORDER BY ps.position ASC`,
    [playlistId],
  );
  const rows = result.rows.raw() as any[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist || 'Unknown Artist',
    cover: r.cover || '',
    album: r.album || undefined,
    duration: r.duration ?? undefined,
    isDownloaded: r.isDownloaded === 1,
    localPath: r.localPath,
  }));
}

export async function addSongToPlaylist(
  playlistId: number,
  song: Song,
): Promise<void> {
  const database = await getDb();
  // ensure the song exists in the songs table first
  await database.executeSql(
    `INSERT OR IGNORE INTO songs (id, title, artist, cover, album, duration, addedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [song.id, song.title, song.artist, song.cover, song.album || null, song.duration ?? null, Date.now()],
  );
  const [countResult] = await database.executeSql(
    'SELECT COUNT(*) AS c FROM playlist_songs WHERE playlistId = ?',
    [playlistId],
  );
  const count = (countResult.rows.item(0) as any).c as number;
  await database.executeSql(
    'INSERT OR IGNORE INTO playlist_songs (playlistId, songId, position) VALUES (?, ?, ?)',
    [playlistId, song.id, count],
  );
}

export async function removeSongFromPlaylist(
  playlistId: number,
  songId: string,
): Promise<void> {
  const database = await getDb();
  await database.executeSql(
    'DELETE FROM playlist_songs WHERE playlistId = ? AND songId = ?',
    [playlistId, songId],
  );
}

export async function deletePlaylist(playlistId: number): Promise<void> {
  const database = await getDb();
  await database.executeSql('DELETE FROM playlist_songs WHERE playlistId = ?', [
    playlistId,
  ]);
  await database.executeSql('DELETE FROM playlists WHERE id = ?', [playlistId]);
}
