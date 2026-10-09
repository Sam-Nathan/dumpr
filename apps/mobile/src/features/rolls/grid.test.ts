import { describe, expect, it } from 'vitest';
import {
  columnsAfterPinch,
  dayKey,
  flattenSections,
  dayTitle,
  groupIntoSections,
  nextCursor,
  sectionModeFor,
  PHOTOS_PAGE_SIZE,
  toGridRows,
  type GridChapter,
} from './grid';

const photo = (id: string, sortAt: string, chapter: string | null = null) => ({
  id,
  sort_at: sortAt,
  chapter_id: chapter,
});

describe('keyset cursor', () => {
  it('returns a cursor only after a full page', () => {
    const full = Array.from({ length: PHOTOS_PAGE_SIZE }, (_, i) =>
      photo(`p${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`),
    );
    expect(nextCursor(full)).toEqual({
      sortAt: full[full.length - 1]?.sort_at,
      id: `p${PHOTOS_PAGE_SIZE - 1}`,
    });
    expect(nextCursor(full.slice(0, 10))).toBeUndefined();
    expect(nextCursor([])).toBeUndefined();
  });
});

describe('sections', () => {
  const chapters: GridChapter[] = [
    { id: 'c2', name: 'Sangeet', sort: 2, day: '2025-11-23' },
    { id: 'c1', name: 'Haldi', sort: 1, day: null },
    { id: 'c3', name: 'Reception', sort: 3, day: null },
  ];
  const photos = [
    photo('a', '2025-11-23T20:00:00Z', 'c2'),
    photo('b', '2025-11-23T12:00:00Z', 'c1'),
    photo('c', '2025-11-22T12:00:00Z', 'c1'),
    photo('d', '2025-11-22T11:00:00Z'),
  ];

  it('groups by day, newest first', () => {
    const s = groupIntoSections(photos, [], 'day', { utc: true });
    expect(s.map((x) => x.title)).toEqual(['Sun 23 Nov', 'Sat 22 Nov']);
    expect(s[0]?.photos.map((p) => p.id)).toEqual(['a', 'b']);
    expect(s[1]?.photos.map((p) => p.id)).toEqual(['c', 'd']);
  });

  it('groups by chapter in the host order, skips empty chapters, loose photos last', () => {
    const s = groupIntoSections(photos, chapters, 'chapter');
    expect(s.map((x) => x.title)).toEqual(['Haldi', 'Sangeet', 'More photos']);
    expect(s[1]?.subtitle).toBe('Sun 23 Nov');
    expect(s[0]?.photos.map((p) => p.id)).toEqual(['b', 'c']);
    expect(s[2]?.photos.map((p) => p.id)).toEqual(['d']);
  });

  it('falls back to days when the roll has no chapters', () => {
    expect(groupIntoSections(photos, [], 'chapter', { utc: true })).toHaveLength(2);
  });

  it('formats day keys and titles', () => {
    expect(dayKey('2026-03-12T23:30:00Z', { utc: true })).toBe('2026-03-12');
    expect(dayTitle('2026-03-12')).toBe('Thu 12 Mar');
    expect(dayTitle('nope')).toBe('Undated');
  });
});

describe('rows', () => {
  it('chunks each section by column count and tracks the running photo index', () => {
    const sections = [
      { key: 'a', title: 'A', photos: [1, 2, 3, 4, 5] },
      { key: 'b', title: 'B', photos: [6, 7] },
    ];
    const { rows, headerIndices } = toGridRows(sections, 3);
    expect(headerIndices).toEqual([0, 3]);
    expect(rows.map((r) => r.type)).toEqual(['header', 'row', 'row', 'header', 'row']);
    const r = rows.filter((x) => x.type === 'row') as { photos: number[]; start: number }[];
    expect(r.map((x) => x.start)).toEqual([0, 3, 5]);
    expect(r[1]?.photos).toEqual([4, 5]);
  });

  it('clamps columns to 2-5 and pinches one step at a time', () => {
    expect(toGridRows([{ key: 'a', title: 'A', photos: [1, 2, 3, 4, 5, 6] }], 9).rows).toHaveLength(
      3,
    );
    expect(columnsAfterPinch(3, 1.6)).toBe(2);
    expect(columnsAfterPinch(2, 2)).toBe(2);
    expect(columnsAfterPinch(3, 0.5)).toBe(4);
    expect(columnsAfterPinch(5, 0.5)).toBe(5);
    expect(columnsAfterPinch(3, 1.05)).toBe(3);
  });
});

describe('viewer order', () => {
  it('follows the sections, not raw time order, in chapter mode', () => {
    const chapters: GridChapter[] = [
      { id: 'c1', name: 'Haldi', sort: 1, day: null },
      { id: 'c2', name: 'Sangeet', sort: 2, day: null },
    ];
    const photos = [
      photo('a', '2025-11-23T20:00:00Z', 'c2'),
      photo('b', '2025-11-23T12:00:00Z', 'c1'),
    ];
    const mode = sectionModeFor(chapters, null);
    expect(mode).toBe('chapter');
    expect(flattenSections(groupIntoSections(photos, chapters, mode)).map((p) => p.id)).toEqual([
      'b',
      'a',
    ]);
    expect(sectionModeFor(chapters, 'c1')).toBe('day');
    expect(sectionModeFor([], null)).toBe('day');
  });
});
