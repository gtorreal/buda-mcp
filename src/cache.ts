interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();

  async getOrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (entry && Date.now() < entry.expiry) {
      return entry.data;
    }

    // Deduplicate concurrent requests for the same expired/missing key.
    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const promise = fetcher()
      .then((data) => {
        this.store.set(key, { data, expiry: Date.now() + ttlMs });
        this.inflight.delete(key);
        return data;
      })
      .catch((err: unknown) => {
        this.inflight.delete(key);
        throw err;
      });

    this.inflight.set(key, promise as Promise<unknown>);
    return promise;
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
  BANKS: 60_000,
} as const;

export const cache = new MemoryCache();
