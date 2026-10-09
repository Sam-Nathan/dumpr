/**
 * Pure helpers for the B3 Roll grid: keyset paging (architecture §5), grouping into day / chapter
 * sections and chunking into rows for the FlashList. No React Native imports (unit-tested).
 */
import { monthShort } from '../../lib/format';

export const PHOTOS_PAGE_SIZE = 60;
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 5;
export const DEFAULT_COLUMNS = 3;

export interface GridCursor {
  sortAt: string;
  id: string;
}

interface Keyed {
  id: string;
  sort_at: string;
}

export interface GridChapter {
  id: string;
  name: string;
  sort: number;
  day: string | null;
}

export function cursorOf(row: Keyed): GridCursor {
  return { sortAt: row.sort_at, id: row.id };
}

/**
 * Cursor for the page after `page`, or `undefined` when the page was short (no more rows).
 * The cursor is the last row's `(sort_at, id)` exactly as the server printed it, so microsecond
 * precision survives the round trip.
 */
export function nextCursor(
  page: readonly Keyed[],
  pageSize = PHOTOS_PAGE_SIZE,
): GridCursor | undefined {
  if (page.length < pageSize) return undefined;
  const last = page[page.length - 1];
  return last ? cursorOf(last) : undefined;
}

/**
 * PostgREST `or=` expression for `(sort_at, id) < (cursor.sortAt, cursor.id)` with the order
 * `sort_at desc, id desc`. Values are double-quoted so `:` `+` `.` in timestamps are safe.
 */
export function keysetFilter(c: GridCursor): string {
  const s = quote(c.sortAt);
  const i = quote(c.id);
  return `sort_at.lt.${s},and(sort_at.eq.${s},id.lt.${i})`;
}

function quote(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ---- sections ------------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DayOptions {
  /** Group by UTC calendar day (tests). Default: the device's local day. */
  utc?: boolean;
}

/** "2026-11-23" for a timestamp (local day by default). */
export function dayKey(iso: string, opts: DayOptions = {}): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const y = opts.utc ? d.getUTCFullYear() : d.getFullYear();
  const m = (opts.utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const day = opts.utc ? d.getUTCDate() : d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "Sat 23 Nov" from a `YYYY-MM-DD` day key. */
export function dayTitle(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return 'Undated';
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${monthShort(date.getUTCMonth())}`;
}

export type SectionMode = 'day' | 'chapter';

export interface GridSection<T> {
  key: string;
  title: string;
  subtitle?: string;
  photos: T[];
}

interface Groupable extends Keyed {
  chapter_id: string | null;
}

/**
 * Group photos (already newest first) into sections.
 *  - 'day': one section per calendar day, newest day first ("Sat 23 Nov").
 *  - 'chapter': one section per Chapter in the host's order (title = chapter name, subtitle = its
 *    day), photos without a Chapter last under "More photos". Empty Chapters are omitted.
 */
export function groupIntoSections<T extends Groupable>(
  photos: readonly T[],
  chapters: readonly GridChapter[],
  mode: SectionMode,
  opts: DayOptions = {},
): GridSection<T>[] {
  if (mode === 'chapter' && chapters.length > 0) {
    const byChapter = new Map<string, T[]>();
    const loose: T[] = [];
    const known = new Set(chapters.map((c) => c.id));
    for (const p of photos) {
      if (p.chapter_id && known.has(p.chapter_id)) {
        const list = byChapter.get(p.chapter_id) ?? [];
        list.push(p);
        byChapter.set(p.chapter_id, list);
      } else {
        loose.push(p);
      }
    }
    const sections: GridSection<T>[] = [];
    for (const c of [...chapters].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))) {
      const list = byChapter.get(c.id);
      if (!list?.length) continue;
      sections.push({
        key: `chapter:${c.id}`,
        title: c.name,
        subtitle: c.day ? dayTitle(c.day.slice(0, 10)) : undefined,
        photos: list,
      });
    }
    if (loose.length) sections.push({ key: 'chapter:none', title: 'More photos', photos: loose });
    return sections;
  }

  const sections: GridSection<T>[] = [];
  let current: GridSection<T> | null = null;
  for (const p of photos) {
    const key = dayKey(p.sort_at, opts);
    if (!current || current.key !== `day:${key}`) {
      current = { key: `day:${key}`, title: dayTitle(key), photos: [] };
      sections.push(current);
    }
    current.photos.push(p);
  }
  return sections;
}

// ---- rows for the list -----------------------------------------------------------------------

export type GridRow<T> =
  | { type: 'header'; key: string; title: string; subtitle?: string }
  | { type: 'row'; key: string; photos: T[]; start: number };

/**
 * Flatten sections into list rows: a header row per section and rows of `columns` tiles.
 * `start` is the index of the row's first photo across the whole (sectioned) order, which the
 * viewer uses to open at the right place.
 */
export function toGridRows<T>(
  sections: readonly GridSection<T>[],
  columns: number,
): { rows: GridRow<T>[]; headerIndices: number[] } {
  const cols = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(columns)));
  const rows: GridRow<T>[] = [];
  const headerIndices: number[] = [];
  let start = 0;
  for (const s of sections) {
    headerIndices.push(rows.length);
    rows.push({ type: 'header', key: `h:${s.key}`, title: s.title, subtitle: s.subtitle });
    for (let i = 0; i < s.photos.length; i += cols) {
      rows.push({
        type: 'row',
        key: `r:${s.key}:${i / cols}`,
        photos: s.photos.slice(i, i + cols),
        start: start + i,
      });
    }
    start += s.photos.length;
  }
  return { rows, headerIndices };
}

/** Column count after a pinch: out (scale > 1) = bigger tiles = fewer columns. */
export function columnsAfterPinch(current: number, scale: number): number {
  let next = current;
  if (scale > 1.25) next = current - 1;
  else if (scale < 0.8) next = current + 1;
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, next));
}

/**
 * Sections follow the Chapters while "All" is selected and the Roll has them; a single Chapter or a
 * Roll without Chapters groups by day.
 */
export function sectionModeFor(
  chapters: readonly unknown[],
  chapterFilter: string | null | undefined,
): SectionMode {
  return chapters.length > 0 && !chapterFilter ? 'chapter' : 'day';
}

/** Photos in the order the grid shows them (the viewer swipes in this order too). */
export function flattenSections<T>(sections: readonly GridSection<T>[]): T[] {
  return sections.flatMap((s) => s.photos);
}
