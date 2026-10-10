import { describe, expect, it, vi } from 'vitest';
import { refreshRollPhotos, trimToFirstPage } from './pages';

describe('trimToFirstPage', () => {
  it('keeps only the first page and its param', () => {
    const data = { pages: [['a'], ['b'], ['c']], pageParams: [null, 'x', 'y'] };
    expect(trimToFirstPage(data)).toEqual({ pages: [['a']], pageParams: [null] });
  });
  it('returns the same object when there is nothing to trim', () => {
    const one = { pages: [['a']], pageParams: [null] };
    expect(trimToFirstPage(one)).toBe(one);
    expect(trimToFirstPage(undefined)).toBeUndefined();
  });
});

describe('refreshRollPhotos', () => {
  it('trims all grids of the roll and then invalidates them', () => {
    const calls: string[] = [];
    let updater: ((o: never) => unknown) | undefined;
    const qc = {
      setQueriesData: vi.fn((f: { queryKey: readonly unknown[] }, u: (o: never) => unknown) => {
        calls.push(`set:${f.queryKey.join('/')}`);
        updater = u;
      }),
      invalidateQueries: vi.fn((f: { queryKey: readonly unknown[] }) => {
        calls.push(`inv:${f.queryKey.join('/')}`);
      }),
    };
    refreshRollPhotos(qc, 'r1');
    expect(calls).toEqual(['set:roll-photos/r1', 'inv:roll-photos/r1']);
    expect(updater?.({ pages: [[1], [2]], pageParams: [null, 'k'] } as never)).toEqual({
      pages: [[1]],
      pageParams: [null],
    });
  });
});
