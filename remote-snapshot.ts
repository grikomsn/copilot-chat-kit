/** Persisted, stale-while-revalidate snapshots of public metadata such as models.dev. */

export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MODELS_DEV_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** The subset of `vscode.Memento` a snapshot needs. */
export interface SnapshotStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** A store that persists nothing, for hosts without global state (tests, harnesses). */
export function ephemeralSnapshotStore(): SnapshotStore {
  return { get: () => undefined, update: async () => undefined };
}

export interface TimestampedSnapshot {
  readonly fetchedAt: number;
}

export interface RemoteSnapshotOptions<T extends TimestampedSnapshot> {
  readonly cacheKey: string;
  readonly store: SnapshotStore;
  /** Throws when the payload is unusable, so a bad response never replaces a good snapshot. */
  readonly normalize: (payload: unknown, fetchedAt: number) => T;
  /** Returns undefined for any malformed persisted value. */
  readonly parseCached: (value: unknown) => T | undefined;
  /** Returned when no snapshot was ever loaded and the refresh failed. */
  readonly empty: () => T;
  readonly url?: string;
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Persisted form; defaults to the snapshot itself. */
  readonly serialize?: (snapshot: T) => unknown;
}

/**
 * Loads the persisted snapshot lazily, serves it while a stale copy refreshes
 * in the background, shares one in-flight refresh, and never lets a failed
 * fetch or cache write discard the last good snapshot.
 */
export class RemoteSnapshot<T extends TimestampedSnapshot> {
  private snapshot: T | undefined;
  private refreshPromise: Promise<T> | undefined;
  private loaded = false;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: RemoteSnapshotOptions<T>) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  /** The loaded snapshot, without triggering a refresh. */
  get current(): T | undefined {
    this.load();
    return this.snapshot;
  }

  async getOrRefresh(): Promise<T> {
    this.load();
    if (!this.snapshot) return this.refresh();
    if (this.now() - this.snapshot.fetchedAt >= (this.options.ttlMs ?? MODELS_DEV_CACHE_TTL_MS)) void this.refresh();
    return this.snapshot;
  }

  refresh(): Promise<T> {
    this.load();
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchAndCache().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async fetchAndCache(): Promise<T> {
    try {
      const response = await this.fetchImpl(this.options.url ?? MODELS_DEV_API_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
      if (!response.ok) throw new Error(`Metadata request failed: ${response.status}`);
      const next = this.options.normalize(await response.json(), this.now());
      this.snapshot = next;
      try {
        await this.options.store.update(this.options.cacheKey, this.options.serialize ? this.options.serialize(next) : next);
      } catch {
        // A cache write must not hide a successful refresh.
      }
      return next;
    } catch {
      return this.snapshot ?? this.options.empty();
    }
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.snapshot = this.options.parseCached(this.options.store.get<unknown>(this.options.cacheKey));
    } catch {
      this.snapshot = undefined;
    }
  }
}
