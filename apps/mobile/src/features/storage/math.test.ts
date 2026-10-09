import { describe, expect, it } from 'vitest';
import type { MyStorage } from '../../data/types-cf';
import { cacheLabel, planLine, storageBar } from './math';

const storage = (over: Partial<MyStorage> = {}): MyStorage => ({
  used_bytes: 12_400_000_000,
  limit_bytes: null,
  by_crew: [
    { crew_id: 'a', name: 'Ananya × Rohan', tint: 'peach', bytes: 6_800_000_000 },
    { crew_id: 'b', name: 'Goa Gang', tint: 'lilac', bytes: 3_100_000_000 },
    { crew_id: 'c', name: 'Hostel Block C', tint: 'lime', bytes: 1_900_000_000 },
  ],
  ...over,
});

describe('storageBar', () => {
  it('fills the bar with proportions when there is no limit and adds an "other" segment', () => {
    const bar = storageBar(storage());
    expect(bar.segments.map((s) => s.label)).toEqual([
      'Ananya × Rohan',
      'Goa Gang',
      'Hostel Block C',
      'Snaps & chat media',
    ]);
    expect(bar.otherBytes).toBe(600_000_000);
    const sum = bar.segments.reduce((n, s) => n + s.fraction, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(bar.usedFraction).toBe(0);
    expect(bar.nearLimit).toBe(false);
  });
  it('scales to the limit when one is set and flags near-full', () => {
    const bar = storageBar(storage({ limit_bytes: 13_000_000_000 }));
    const sum = bar.segments.reduce((n, s) => n + s.fraction, 0);
    expect(sum).toBeCloseTo(12.4 / 13, 3);
    expect(bar.nearLimit).toBe(true);
    expect(bar.full).toBe(false);
    expect(storageBar(storage({ limit_bytes: 12_000_000_000 })).full).toBe(true);
  });
  it('handles an empty account', () => {
    const bar = storageBar({ used_bytes: 0, limit_bytes: null, by_crew: [] });
    expect(bar.segments).toEqual([]);
    expect(bar.usedFraction).toBe(0);
  });
});

describe('copy', () => {
  it('never hardcodes a plan limit', () => {
    expect(planLine(null)).toBe('used · No limit yet');
    expect(planLine(0)).toBe('used · No limit yet');
    expect(planLine(15_000_000_000)).toBe('of 15 GB used');
    expect(cacheLabel(null)).toBe('Calculating…');
    expect(cacheLabel(860_000_000)).toBe('860 MB');
  });
});
