/**
 * Pure helpers for the Create sheet (B5): smart name suggestions, Chapter presets and the little
 * calendar used by the date range picker.
 */
import { monthLong, monthShort, parseDay } from '../../lib/format';

const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export type RollTypeChip = 'trip' | 'wedding' | 'fest' | 'birthday' | 'casual';
export type RollKindValue = 'wedding' | 'trip' | 'fest' | 'everyday' | 'other';

export const ROLL_TYPE_CHIPS: readonly { id: RollTypeChip; label: string }[] = [
  { id: 'trip', label: 'Trip' },
  { id: 'wedding', label: 'Wedding' },
  { id: 'fest', label: 'Fest' },
  { id: 'birthday', label: 'Birthday' },
  { id: 'casual', label: 'Just because' },
];

/** `roll_kind` enum value for a type chip (Birthday has no kind of its own yet). */
export function rollKindFor(chip: RollTypeChip): RollKindValue {
  switch (chip) {
    case 'trip':
      return 'trip';
    case 'wedding':
      return 'wedding';
    case 'fest':
      return 'fest';
    case 'casual':
      return 'everyday';
    default:
      return 'other';
  }
}

/** Number of days in an inclusive ISO range ("2026-07-18".."2026-07-20" -> 3); 1 when open ended. */
export function dayCount(start: string | null, end: string | null): number {
  const a = parseDay(start);
  const b = parseDay(end);
  if (!a || !b) return 1;
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
}

/**
 * Name ideas from the date (and place when known): "Weekend · 12 Oct", "Oct '26", "Goa '26".
 * Weekdays other than Fri-Sun use the weekday name ("Tuesday · 7 Oct"). A multi-day range reads
 * as a trip ("18–20 Jul").
 */
export function suggestRollNames(input: {
  start?: string | null;
  end?: string | null;
  today?: Date;
  place?: string | null;
}): string[] {
  const today = input.today ?? new Date();
  const start =
    parseDay(input.start) ??
    new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const end = parseDay(input.end);
  const yy = `'${String(start.getUTCFullYear() % 100).padStart(2, '0')}`;
  const month = monthShort(start.getUTCMonth());
  const out: string[] = [];

  if (input.place?.trim()) out.push(`${input.place.trim()} ${yy}`);

  const multi = !!end && end.getTime() > start.getTime();
  if (multi && end) {
    const sameMonth = end.getUTCMonth() === start.getUTCMonth();
    out.push(
      sameMonth
        ? `${monthLong(start.getUTCMonth())} trip`
        : `${month}–${monthShort(end.getUTCMonth())} trip`,
    );
    out.push(
      sameMonth
        ? `${start.getUTCDate()}–${end.getUTCDate()} ${month}`
        : `${start.getUTCDate()} ${month} – ${end.getUTCDate()} ${monthShort(end.getUTCMonth())}`,
    );
  } else {
    const dow = start.getUTCDay();
    const label =
      dow === 0 || dow === 5 || dow === 6 ? 'Weekend' : (WEEKDAYS_LONG[dow] ?? 'Day out');
    out.push(`${label} · ${start.getUTCDate()} ${month}`);
    out.push(`${month} ${yy}`);
  }
  out.push(`${monthLong(start.getUTCMonth())} dump`);
  return [...new Set(out)].slice(0, 3);
}

/** Preset Chapters: Wedding events, Trip days, Fest days and nights. */
export function chapterPresets(kind: RollTypeChip, days = 3): string[] {
  switch (kind) {
    case 'wedding':
      return ['Haldi', 'Mehendi', 'Sangeet', 'Reception'];
    case 'trip': {
      const n = Math.min(14, Math.max(2, Math.round(days)));
      return Array.from({ length: n }, (_, i) => `Day ${i + 1}`);
    }
    case 'fest':
      return ['Day 1', 'Night 1', 'Day 2', 'Night 2'];
    default:
      return [];
  }
}

// ---- calendar --------------------------------------------------------------------------------

export function toISODate(y: number, monthIndex0: number, day: number): string {
  return `${y}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Weeks (Mon first) of a month; `null` pads the leading / trailing blanks. */
export function monthGrid(year: number, monthIndex0: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => toISODate(year, monthIndex0, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Next state of the range picker after tapping `day`: first tap sets the start, a later day
 * extends the range, an earlier day (or a tap on a finished range) starts over.
 */
export function pickRangeDay(
  range: { start: string | null; end: string | null },
  day: string,
): { start: string | null; end: string | null } {
  if (!range.start || range.end) return { start: day, end: null };
  if (day < range.start) return { start: day, end: null };
  return { start: range.start, end: day };
}
