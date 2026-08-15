/**
 * Session-level in-memory cache shared across screen mounts (tab switches,
 * goBack, re-navigation). Hydrated from SQLite at app startup so cached
 * screens render instantly even after a cold launch.
 */
const moduleCache = new Map<string, unknown>();

export function getCacheValue<T>(key: string): T | null {
  return moduleCache.has(key) ? (moduleCache.get(key) as T) : null;
}

export function hasCacheValue(key: string): boolean {
  return moduleCache.has(key);
}

export function setCacheValue(key: string, value: unknown): void {
  moduleCache.set(key, value);
}

export function invalidateCache(key: string): void {
  moduleCache.delete(key);
}
