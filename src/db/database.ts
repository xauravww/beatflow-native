import SQLite, { SQLiteDatabase } from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let db: SQLiteDatabase | null = null;

/** Lazily open (and cache) the database connection. */
export async function getDb(): Promise<SQLiteDatabase> {
  if (db) {
    return db;
  }
  db = await SQLite.openDatabase({ name: 'beatflow.db', location: 'default' });
  return db;
}

export async function initDb(): Promise<void> {
  const database = await getDb();
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT,
      cover TEXT,
      album TEXT,
      duration INTEGER,
      isDownloaded INTEGER DEFAULT 0,
      localPath TEXT,
      addedAt INTEGER
    );
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      createdAt INTEGER
    );
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS playlist_songs (
      playlistId INTEGER NOT NULL,
      songId TEXT NOT NULL,
      position INTEGER,
      PRIMARY KEY (playlistId, songId)
    );
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS lyrics_cache (
      songId TEXT PRIMARY KEY,
      syncedLyrics TEXT,
      plainLyrics TEXT,
      cachedAt INTEGER,
      matchedDuration REAL NOT NULL DEFAULT 0
    );
  `);

  // Migration: older installs lack matchedDuration (the runtime of the lyric
  // version we matched — used to decide whether the timestamps can be trusted
  // for auto-highlight/auto-scroll).
  const [lyricsInfo] = await database.executeSql(
    'PRAGMA table_info(lyrics_cache)',
  );
  const lyricsColumns = lyricsInfo.rows.raw() as { name: string }[];
  if (!lyricsColumns.some((c) => c.name === 'matchedDuration')) {
    await database.executeSql(
      'ALTER TABLE lyrics_cache ADD COLUMN matchedDuration REAL NOT NULL DEFAULT 0',
    );
  }
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      songId TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT,
      cover TEXT,
      duration INTEGER,
      playedSeconds INTEGER NOT NULL DEFAULT 0,
      playedAt INTEGER
    );
  `);

  // Migration: older installs lack the playedSeconds column.
  const [infoResult] = await database.executeSql(
    'PRAGMA table_info(history)',
  );
  const columns = infoResult.rows.raw() as { name: string }[];
  if (!columns.some((c) => c.name === 'playedSeconds')) {
    await database.executeSql(
      'ALTER TABLE history ADD COLUMN playedSeconds INTEGER NOT NULL DEFAULT 0',
    );
  }
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS recent_searches (
      query TEXT PRIMARY KEY,
      searchedAt INTEGER
    );
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS spotify_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS screen_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      cachedAt INTEGER
    );
  `);

  // Liked/saved songs live in their own table — the `songs` table is just a
  // metadata catalog (playlist members, downloads) and must NOT imply "liked".
  const [savedTableResult] = await database.executeSql(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'saved_songs'",
  );
  const savedTableExists =
    (savedTableResult.rows.raw() as { name: string }[]).length > 0;
  if (!savedTableExists) {
    await database.executeSql(`
      CREATE TABLE saved_songs (
        id TEXT PRIMARY KEY,
        savedAt INTEGER
      );
    `);
    // One-time backfill: keep songs that were never added to a playlist
    // (those were genuinely saved), un-like the playlist-only ones.
    await database.executeSql(`
      INSERT OR IGNORE INTO saved_songs (id, savedAt)
      SELECT id, addedAt FROM songs
      WHERE id NOT IN (SELECT songId FROM playlist_songs)
    `);
  }
}
