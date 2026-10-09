import { describe, expect, it } from 'vitest';
import { photoIdFromKey } from './keys';
import {
  chapterPresets,
  dayCount,
  monthGrid,
  pickRangeDay,
  rollKindFor,
  suggestRollNames,
} from './names';

const today = (iso: string) => new Date(`${iso}T12:00:00`);

describe('name suggestions', () => {
  it('calls Fri-Sun a weekend', () => {
    // 12 Oct 2026 is a Monday; 10 Oct 2026 is a Saturday.
    expect(suggestRollNames({ today: today('2026-10-10') })[0]).toBe('Weekend · 10 Oct');
  });

  it('uses the weekday name midweek', () => {
    expect(suggestRollNames({ today: today('2026-10-12') })[0]).toBe('Monday · 12 Oct');
  });

  it('prefers the chosen start date over today', () => {
    expect(suggestRollNames({ start: '2026-03-14', today: today('2026-10-12') })[0]).toBe(
      'Weekend · 14 Mar',
    );
  });

  it('puts the place first and keeps at most three unique ideas', () => {
    const names = suggestRollNames({
      place: 'Goa',
      start: '2026-03-14',
      today: today('2026-10-12'),
    });
    expect(names[0]).toBe("Goa '26");
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
  });

  it('reads a multi-day range as a trip', () => {
    const names = suggestRollNames({ start: '2026-07-18', end: '2026-07-20' });
    expect(names).toContain('July trip');
    expect(names).toContain('18–20 Jul');
  });
});

describe('presets and dates', () => {
  it('has the wedding chapters', () => {
    expect(chapterPresets('wedding')).toEqual(['Haldi', 'Mehendi', 'Sangeet', 'Reception']);
  });

  it('numbers trip days from the date range', () => {
    expect(chapterPresets('trip', dayCount('2026-07-18', '2026-07-20'))).toEqual([
      'Day 1',
      'Day 2',
      'Day 3',
    ]);
    expect(chapterPresets('trip', 40)).toHaveLength(14);
    expect(chapterPresets('casual')).toEqual([]);
  });

  it('maps type chips to roll_kind', () => {
    expect(rollKindFor('casual')).toBe('everyday');
    expect(rollKindFor('birthday')).toBe('other');
    expect(rollKindFor('trip')).toBe('trip');
  });

  it('counts inclusive days', () => {
    expect(dayCount('2026-07-18', '2026-07-18')).toBe(1);
    expect(dayCount('2026-07-18', null)).toBe(1);
    expect(dayCount('2026-02-27', '2026-03-02')).toBe(4);
  });

  it('lays a month out Monday first', () => {
    const weeks = monthGrid(2026, 9); // Oct 2026 starts on a Thursday
    expect(weeks[0]?.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('picks a range with taps', () => {
    let r = pickRangeDay({ start: null, end: null }, '2026-07-18');
    expect(r).toEqual({ start: '2026-07-18', end: null });
    r = pickRangeDay(r, '2026-07-20');
    expect(r).toEqual({ start: '2026-07-18', end: '2026-07-20' });
    r = pickRangeDay(r, '2026-07-25');
    expect(r).toEqual({ start: '2026-07-25', end: null });
    expect(pickRangeDay({ start: '2026-07-18', end: null }, '2026-07-10')).toEqual({
      start: '2026-07-10',
      end: null,
    });
  });
});

describe('photoIdFromKey', () => {
  const id = '3f0c9f5e-8b2a-4c1d-9a77-1d2e3f4a5b6c';
  it('reads the photo id out of an R2 key', () => {
    expect(photoIdFromKey(`t/crew/roll/${id}.jpg`)).toBe(id);
    expect(photoIdFromKey(`d/crew/roll/${id}.jpg`)).toBe(id);
  });
  it('is null for anything else', () => {
    expect(photoIdFromKey(null)).toBeNull();
    expect(photoIdFromKey('t/crew/roll/not-a-uuid.jpg')).toBeNull();
  });
});
