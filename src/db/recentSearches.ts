import { getDb } from './database';

const MAX = 10;

export async function addRecentSearch(query: string): Promise<void> {
  const database = await getDb();
  await database.executeSql(
    'INSERT OR REPLACE INTO recent_searches (query, searchedAt) VALUES (?, ?)',
    [query, Date.now()],
  );
  // keep only the 10 most recent
  await database.executeSql(
    `DELETE FROM recent_searches WHERE query NOT IN (
       SELECT query FROM recent_searches ORDER BY searchedAt DESC LIMIT ?
     )`,
    [MAX],
  );
}

export async function getRecentSearches(): Promise<string[]> {
  const database = await getDb();
  const [result] = await database.executeSql(
    'SELECT query FROM recent_searches ORDER BY searchedAt DESC LIMIT ?',
    [MAX],
  );
  return (result.rows.raw() as { query: string }[]).map((r) => r.query);
}

export async function clearRecentSearches(): Promise<void> {
  const database = await getDb();
  await database.executeSql('DELETE FROM recent_searches');
}
