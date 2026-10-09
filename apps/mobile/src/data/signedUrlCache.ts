/**
 * Batching + caching core for signed media URLs. Pure (no React / RN imports) so it is unit-tested.
 *
 * Many components ask for URLs in the same frame (a 60-tile grid). Requests are collected for one
 * short tick and sent as a single `media-sign` call (<= 300 keys per call). Resolved URLs are cached
 * in memory until `expires_at - 5 min`.
 */

export interface SignBatchResponse {
  urls: Record<string, string>;
  /** ISO timestamp shared by every URL in this response. */
  expires_at: string;
  /** Requested keys that were not signed (not visible / removed / downloads disabled). */
  unavailable?: Record<string, string>;
}

export interface SignedUrlCacheOptions {
  /** Performs one network call for <= maxPerCall keys. */
  fetchBatch: (keys: string[]) => Promise<SignBatchResponse>;
  /** Collect window in ms. Default 16 (one frame). */
  tickMs?: number;
  /** Max keys per call. Default 300 (media-sign limit). */
  maxPerCall?: number;
  /** Stop using a URL this long before expiry. Default 5 minutes. */
  refreshMarginMs?: number;
  /** After a failed batch, do not retry the same key for this long. Default 8 s. */
  failureCooldownMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

interface Entry {
  url: string;
  expiresAt: number;
}

export class SignedUrlCache {
  private readonly fetchBatch: SignedUrlCacheOptions['fetchBatch'];
  private readonly tickMs: number;
  private readonly maxPerCall: number;
  private readonly margin: number;
  private readonly cooldown: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;

  private readonly entries = new Map<string, Entry>();
  private readonly unavailable = new Map<string, string>();
  private readonly failedAt = new Map<string, number>();
  private readonly inflight = new Set<string>();
  private queue = new Set<string>();
  private timerArmed = false;
  private readonly listeners = new Set<() => void>();
  /** Number of network calls made (exposed for tests / diagnostics). */
  calls = 0;

  constructor(opts: SignedUrlCacheOptions) {
    this.fetchBatch = opts.fetchBatch;
    this.tickMs = opts.tickMs ?? 16;
    this.maxPerCall = opts.maxPerCall ?? 300;
    this.margin = opts.refreshMarginMs ?? 5 * 60_000;
    this.cooldown = opts.failureCooldownMs ?? 8_000;
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  }

  /** Cached URL if it is still fresh, else undefined. */
  peek(key: string): string | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (this.now() >= e.expiresAt - this.margin) return undefined;
    return e.url;
  }

  /** Why a key will never get a URL (e.g. "not_found"), if the server said so. */
  reasonUnavailable(key: string): string | undefined {
    return this.unavailable.get(key);
  }

  /** Queue keys that are missing, stale and not already in flight. Safe to call on every render. */
  request(keys: readonly string[]): void {
    let added = false;
    const t = this.now();
    for (const key of keys) {
      if (!key) continue;
      if (this.peek(key) !== undefined) continue;
      if (this.inflight.has(key) || this.queue.has(key)) continue;
      if (this.unavailable.has(key)) continue;
      const failed = this.failedAt.get(key);
      if (failed !== undefined && t - failed < this.cooldown) continue;
      this.queue.add(key);
      added = true;
    }
    if (added) this.arm();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Forget everything (sign-out). */
  clear(): void {
    this.entries.clear();
    this.unavailable.clear();
    this.failedAt.clear();
    this.emit();
  }

  /** Resolves when the queue is empty and nothing is in flight (tests). */
  async idle(): Promise<void> {
    while (this.timerArmed || this.queue.size > 0 || this.inflight.size > 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  private arm() {
    if (this.timerArmed) return;
    this.timerArmed = true;
    this.setTimer(() => this.flush(), this.tickMs);
  }

  private flush() {
    this.timerArmed = false;
    const keys = [...this.queue];
    this.queue = new Set();
    for (let i = 0; i < keys.length; i += this.maxPerCall) {
      void this.send(keys.slice(i, i + this.maxPerCall));
    }
  }

  private async send(keys: string[]) {
    for (const k of keys) this.inflight.add(k);
    this.calls += 1;
    try {
      const res = await this.fetchBatch(keys);
      const expiresAt = Date.parse(res.expires_at);
      const exp = Number.isFinite(expiresAt) ? expiresAt : this.now() + 6 * 3600_000;
      for (const k of keys) {
        const url = res.urls[k];
        if (url) {
          this.entries.set(k, { url, expiresAt: exp });
          this.failedAt.delete(k);
        } else {
          this.unavailable.set(k, res.unavailable?.[k] ?? 'not_found');
        }
      }
    } catch {
      const t = this.now();
      for (const k of keys) this.failedAt.set(k, t);
    } finally {
      for (const k of keys) this.inflight.delete(k);
      this.emit();
    }
  }

  private emit() {
    for (const l of [...this.listeners]) l();
  }
}

/** Map key for a photo URL: `<photoId>:<variant>` (also the expo-image `cacheKey`). */
export function signedKey(photoId: string, variant: string): string {
  return `${photoId}:${variant}`;
}

/** Inverse of `signedKey`; null when malformed. */
export function parseSignedKey(key: string): { photo_id: string; variant: string } | null {
  const i = key.lastIndexOf(':');
  if (i <= 0 || i === key.length - 1) return null;
  return { photo_id: key.slice(0, i), variant: key.slice(i + 1) };
}
