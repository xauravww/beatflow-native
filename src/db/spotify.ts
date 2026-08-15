import { getDb } from './database';

const SETTINGS_TABLE = 'spotify_settings';

export async function saveSpotifySetting(
  key: string,
  value: string,
): Promise<void> {
  const database = await getDb();
  await database.executeSql(
    `INSERT OR REPLACE INTO ${SETTINGS_TABLE} (key, value) VALUES (?, ?)`,
    [key, value],
  );
}

export async function getSpotifySetting(
  key: string,
): Promise<string | null> {
  const database = await getDb();
  const [result] = await database.executeSql(
    `SELECT value FROM ${SETTINGS_TABLE} WHERE key = ?`,
    [key],
  );
  const row = result.rows.raw()[0] as { value: string } | undefined;
  return row?.value ?? null;
}

export async function clearSpotifySettings(): Promise<void> {
  const database = await getDb();
  await database.executeSql(`DELETE FROM ${SETTINGS_TABLE}`);
}
