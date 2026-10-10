import { describe, expect, it } from 'vitest';
import {
  DONE_GRACE_MS,
  isPurgeableUri,
  keepPending,
  nextDoneExpiry,
  samePending,
  type PendingTileFields,
} from './queueRules';

const it1 = (over: Partial<PendingTileFields> = {}): PendingTileFields => ({
  id: 'p1',
  rollId: 'r1',
  state: 'uploading',
  localUri: 'file:///docs/a.jpg',
  ...over,
});

describe('isPurgeableUri', () => {
  const roots = ['file:///data/user/0/app/cache/'];
  it('flags files in the cache directory', () => {
    expect(isPurgeableUri('file:///data/user/0/app/cache/Camera/abc.jpg', roots)).toBe(true);
    expect(isPurgeableUri('file:///data/user/0/app/cache/ImagePicker/x.png', roots)).toBe(true);
  });
  it('leaves library and document files alone', () => {
    expect(isPurgeableUri('file:///data/user/0/app/files/a.jpg', roots)).toBe(false);
    expect(isPurgeableUri('content://media/external/images/media/12', roots)).toBe(false);
    expect(isPurgeableUri('ph://ABCD-1234', roots)).toBe(false);
    expect(isPurgeableUri('file:///data/user/0/app/cache2/a.jpg', roots)).toBe(false);
    expect(isPurgeableUri('file:///data/user/0/app/cache', roots)).toBe(false);
    expect(isPurgeableUri('file:///x/a.jpg', [''])).toBe(false);
  });
});

describe('keepPending (done-item retention)', () => {
  const now = 1_000_000;
  it('keeps active, failed and duplicate items; drops cancelled and other rolls', () => {
    for (const state of ['queued', 'uploading', 'failed', 'blocked', 'duplicate', 'paused']) {
      expect(keepPending(it1({ state }), 'r1', new Set(), now)).toBe(true);
    }
    expect(keepPending(it1({ state: 'cancelled' }), 'r1', new Set(), now)).toBe(false);
    expect(keepPending(it1({ rollId: 'r2' }), 'r1', new Set(), now)).toBe(false);
  });

  it('keeps a done item until the server grid has it', () => {
    const done = it1({ state: 'done', updatedAt: now - 1000 });
    expect(keepPending(done, 'r1', new Set(), now)).toBe(true);
    expect(keepPending(done, 'r1', new Set(['p1']), now)).toBe(false);
  });

  it('drops a done item after the grace period even when the server never returns it', () => {
    const done = it1({ state: 'done', updatedAt: now - DONE_GRACE_MS });
    expect(keepPending(done, 'r1', new Set(), now)).toBe(false);
    expect(keepPending(it1({ state: 'done' }), 'r1', new Set(), now)).toBe(false);
  });

  it('reports the earliest expiry of the retained done items', () => {
    const items = [
      it1({ id: 'a', state: 'done', updatedAt: now - 3000 }),
      it1({ id: 'b', state: 'done', updatedAt: now - 1000 }),
      it1({ id: 'c', state: 'done', updatedAt: now - 9000 }),
      it1({ id: 'd', state: 'uploading' }),
    ];
    expect(nextDoneExpiry(items, 'r1', new Set(), now)).toBe(now - 3000 + DONE_GRACE_MS);
    expect(nextDoneExpiry(items, 'r1', new Set(['a', 'b']), now)).toBeNull();
  });
});

describe('samePending', () => {
  it('ignores progress ticks (the grid must not re-render for them)', () => {
    const a = [{ ...it1(), progress: 0.1, bytes: 10, attempt: 0 }];
    const b = [{ ...it1(), progress: 0.2, bytes: 10, attempt: 0 }];
    expect(samePending(a, b)).toBe(true);
  });
  it('notices state, membership and uri changes', () => {
    expect(samePending([it1()], [it1({ state: 'failed', errorCode: 'network' })])).toBe(false);
    expect(samePending([it1()], [])).toBe(false);
    expect(samePending([it1()], [it1({ id: 'p2' })])).toBe(false);
    expect(samePending([it1()], [it1({ thumbUri: 'file:///t.jpg' })])).toBe(false);
  });
});
