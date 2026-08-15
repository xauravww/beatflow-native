import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCacheValue,
  hasCacheValue,
  setCacheValue,
} from './cacheStore';
import { setScreenCache } from '../db/screenCache';

interface UseCachedDataOptions {
  /** Persist to SQLite so the data survives app restarts. */
  persist?: boolean;
}

interface UseCachedDataResult<T> {
  data: T | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Loads data with a smart cache: once a key has been loaded (this session,
 * or from SQLite when `persist` is set), every later visit renders the
 * cached value instantly and refreshes in the background — so the user
 * never sees a skeleton/loader flash after the first load.
 */
export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: UseCachedDataOptions,
): UseCachedDataResult<T> {
  const persist = options?.persist ?? false;
  const initial = getCacheValue<T>(key);
  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState(!hasCacheValue(key));

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Re-fetch. Never shows a skeleton when data is already known. */
  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      if (!mountedRef.current) {
        return;
      }
      setCacheValue(key, result);
      if (persistRef.current) {
        setScreenCache(key, result); // fire & forget
      }
      setData(result);
      setLoading(false);
    } catch (e) {
      console.warn(`useCachedData(${key}) failed:`, e);
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [key]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, refresh };
}

export { invalidateCache } from './cacheStore';
