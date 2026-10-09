import { describe, expect, it } from 'vitest';
import {
  bannerTitle,
  dayKey,
  dayLabel,
  estimateBytes,
  flattenSections,
  groupByDay,
  importedKey,
  preselect,
  presetWindow,
  recentWindow,
  rollWindow,
  shiftWindow,
  shouldSuggestWifi,
} from './window';

const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = local(2026, 3, 20);

describe('rollWindow', () => {
  it('covers whole local days of the roll dates', () => {
    const w = rollWindow('2026-03-12', '2026-03-15', NOW);
    expect(w.from).toBe(local(2026, 3, 12, 0));
    expect(new Date(w.to).getDate()).toBe(15);
    expect(new Date(w.to).getHours()).toBe(23);
    expect(w.label).toBe('12–15 Mar');
    expect(w.isFallback).toBe(false);
  });
  it('falls back to the last 3 days without dates', () => {
    const w = rollWindow(null, null, NOW);
    expect(w.isFallback).toBe(true);
    expect(w.label).toBe('Last 3 days');
    expect(w.from).toBe(local(2026, 3, 18, 0));
  });
  it('treats one date as a single day / open window', () => {
    const w = rollWindow('2026-03-12', null, NOW);
    expect(w.from).toBe(local(2026, 3, 12, 0));
    expect(new Date(w.to).getDate()).toBe(20);
    const single = rollWindow(null, '2026-03-12', NOW);
    expect(new Date(single.from).getDate()).toBe(12);
  });
});

describe('window editing', () => {
  it('shifts edges and keeps from <= to', () => {
    const w = rollWindow('2026-03-12', '2026-03-13', NOW);
    const wider = shiftWindow(w, 'to', 2);
    expect(new Date(wider.to).getDate()).toBe(15);
    expect(wider.label).toBe('12–15 Mar');
    expect(shiftWindow(w, 'from', 5)).toBe(w);
  });
  it('presets', () => {
    expect(presetWindow('7d', NOW).label).toBe('Last 7 days');
    expect(presetWindow('all', NOW).from).toBe(0);
    expect(recentWindow(1, NOW).label).toBe('Today');
  });
});

describe('grouping', () => {
  const a = (id: string, t: number) => ({ id, creationTime: t });
  it('groups by local day ascending', () => {
    const items = [
      a('3', local(2026, 3, 13, 9)),
      a('1', local(2026, 3, 12, 10)),
      a('2', local(2026, 3, 12, 8)),
    ];
    const s = groupByDay(items);
    expect(s.map((x) => x.key)).toEqual(['2026-03-12', '2026-03-13']);
    expect(s[0]?.items.map((i) => i.id)).toEqual(['2', '1']);
    expect(s[0]?.label).toBe('Thu 12 Mar');
    expect(dayLabel(local(2026, 3, 13))).toBe('Fri 13 Mar');
    expect(dayKey(local(2026, 3, 5))).toBe('2026-03-05');
  });
  it('flattens into header + rows of four', () => {
    const items = Array.from({ length: 6 }, (_, i) => a(String(i), local(2026, 3, 12, i + 1)));
    const rows = flattenSections(groupByDay(items));
    expect(rows.map((r) => r.type)).toEqual(['header', 'row', 'row']);
    expect(rows[1]?.type === 'row' && rows[1].items.length).toBe(4);
    expect(rows[2]?.type === 'row' && rows[2].items.length).toBe(2);
  });
});

describe('duplicates, size, wifi', () => {
  it('preselects everything not already imported', () => {
    const assets = [
      { id: 'a', filename: 'IMG_1.HEIC', creationTime: 1_000_000 },
      { id: 'b', filename: 'IMG_2.HEIC', creationTime: 2_000_000 },
    ];
    const imported = new Set([importedKey('img_1.heic', 1_000_400)]);
    expect([...preselect(assets, imported)]).toEqual(['b']);
  });
  it('estimates bytes and suggests wifi over 200', () => {
    expect(estimateBytes([{ width: 4000, height: 3000 }])).toBe(4_200_000);
    expect(estimateBytes([{}])).toBe(4_000_000);
    expect(shouldSuggestWifi(200)).toBe(false);
    expect(shouldSuggestWifi(201)).toBe(true);
  });
  it('banner copy', () => {
    expect(bannerTitle(142, "Goa '26")).toBe("142 photos look like Goa '26");
    expect(bannerTitle(1, 'Trip')).toBe('1 photo looks like Trip');
  });
});
