interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  async getOrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (entry && Date.now() < entry.expiry) {
      return entry.data;
    }
    const data = await fetcher();
    this.store.set(key, { data, expiry: Date.now() + ttlMs });
    return data;
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const CACHE_TTL = {
  MARKETS: 60_000,
  TICKER: 5_000,
  ORDERBOOK: 3_000,
} as const;

export const cache = new MemoryCache();
