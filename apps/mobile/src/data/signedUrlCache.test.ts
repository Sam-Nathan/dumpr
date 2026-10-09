import { describe, expect, it, vi } from 'vitest';
import { parseSignedKey, SignedUrlCache, signedKey } from './signedUrlCache';

function setup(opts: { now?: () => number; fail?: boolean } = {}) {
  const calls: string[][] = [];
  const fetchBatch = vi.fn(async (keys: string[]) => {
    calls.push(keys);
    if (opts.fail) throw new Error('Network request failed');
    const urls: Record<string, string> = {};
    for (const k of keys) if (!k.startsWith('gone')) urls[k] = `https://r2/${k}?sig=${calls.length}`;
    return { urls, unavailable: { 'gone:thumb': 'not_found' }, expires_at: new Date(6 * 3600_000).toISOString() };
  });
  const cache = new SignedUrlCache({ fetchBatch, tickMs: 1, now: opts.now ?? (() => 0) });
  return { cache, calls, fetchBatch };
}

describe('SignedUrlCache', () => {
  it('batches requests from many callers in one tick into one call', async () => {
    const { cache, calls } = setup();
    cache.request([signedKey('a', 'thumb')]);
    cache.request([signedKey('b', 'thumb')]);
    cache.request([signedKey('a', 'thumb'), signedKey('c', 'display')]);
    await cache.idle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['a:thumb', 'b:thumb', 'c:display']);
    expect(cache.peek('a:thumb')).toBe('https://r2/a:thumb?sig=1');
  });

  it('splits into chunks of at most 300', async () => {
    const { cache, calls } = setup();
    cache.request(Array.from({ length: 650 }, (_, i) => `p${i}:thumb`));
    await cache.idle();
    expect(calls.map((c) => c.length)).toEqual([300, 300, 50]);
  });

  it('serves from cache until expires_at - 5 min, then refetches', async () => {
    let now = 0;
    const { cache, calls } = setup({ now: () => now });
    cache.request(['a:thumb']);
    await cache.idle();
    cache.request(['a:thumb']);
    await cache.idle();
    expect(calls).toHaveLength(1);
    now = 6 * 3600_000 - 5 * 60_000 - 1;
    expect(cache.peek('a:thumb')).toBeDefined();
    now = 6 * 3600_000 - 5 * 60_000;
    expect(cache.peek('a:thumb')).toBeUndefined();
    cache.request(['a:thumb']);
    await cache.idle();
    expect(calls).toHaveLength(2);
  });

  it('does not request in-flight or unavailable keys again', async () => {
    const { cache, calls } = setup();
    cache.request(['gone:thumb']);
    await cache.idle();
    expect(cache.reasonUnavailable('gone:thumb')).toBe('not_found');
    cache.request(['gone:thumb']);
    await cache.idle();
    expect(calls).toHaveLength(1);
  });

  it('backs off after a failed batch and notifies listeners', async () => {
    let now = 0;
    const { cache, calls } = setup({ now: () => now, fail: true });
    const listener = vi.fn();
    cache.subscribe(listener);
    cache.request(['a:thumb']);
    await cache.idle();
    expect(listener).toHaveBeenCalled();
    cache.request(['a:thumb']);
    await cache.idle();
    expect(calls).toHaveLength(1);
    now = 10_000;
    cache.request(['a:thumb']);
    await cache.idle();
    expect(calls).toHaveLength(2);
  });

  it('clear() forgets urls', async () => {
    const { cache } = setup();
    cache.request(['a:thumb']);
    await cache.idle();
    cache.clear();
    expect(cache.peek('a:thumb')).toBeUndefined();
  });

  it('parses keys', () => {
    expect(parseSignedKey('1234-abcd:thumb')).toEqual({ photo_id: '1234-abcd', variant: 'thumb' });
    expect(parseSignedKey('nope')).toBeNull();
  });
});
