/** Smart gallery import helpers (C3). Pure, unit-tested; no React Native imports. */
import { formatDateRange, monthShort, parseDay } from '../../lib/format';

const DAY_MS = 24 * 60 * 60 * 1000;
export const WIFI_SUGGEST_THRESHOLD = 200;

export interface ImportWindow {
  /** Inclusive, ms since epoch (local midnight of the first day). */
  from: number;
  /** Inclusive, ms since epoch (last millisecond of the last day). */
  to: number;
  /** "12–15 Mar" or "Last 3 days". */
  label: string;
  /** True when the roll has no dates and a recent window was used. */
  isFallback: boolean;
}

/** Local midnight of the calendar day in a Postgres `date` ("2026-03-12"). */
function localDayStart(day: string): number | null {
  const d = parseDay(day);
  if (!d) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Last `days` days ending today (inclusive of today). */
export function recentWindow(days: number, now: number = Date.now()): ImportWindow {
  const from = startOfLocalDay(now) - (days - 1) * DAY_MS;
  return {
    from,
    to: startOfLocalDay(now) + DAY_MS - 1,
    label: days === 1 ? 'Today' : `Last ${days} days`,
    isFallback: true,
  };
}

/**
 * The date window for a roll: its starts_on..ends_on (whole local days), else the last 3 days.
 * A roll with only one of the two dates uses it as a single day (or from it until today).
 */
export function rollWindow(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
  now: number = Date.now(),
  fallbackDays = 3,
): ImportWindow {
  const a = startsOn ? localDayStart(startsOn) : null;
  const b = endsOn ? localDayStart(endsOn) : null;
  if (a === null && b === null) return recentWindow(fallbackDays, now);
  const first = a ?? (b as number);
  const last = b ?? Math.max(first, startOfLocalDay(now));
  const lo = Math.min(first, last);
  const hi = Math.max(first, last);
  return {
    from: lo,
    to: hi + DAY_MS - 1,
    label: formatDateRange(startsOn, endsOn) || 'Roll dates',
    isFallback: false,
  };
}

/** Shift one edge of the window by whole days (date stepper). Keeps from <= to. */
export function shiftWindow(w: ImportWindow, edge: 'from' | 'to', days: number): ImportWindow {
  const from = edge === 'from' ? w.from + days * DAY_MS : w.from;
  const to = edge === 'to' ? w.to + days * DAY_MS : w.to;
  if (from > to) return w;
  return { from, to, label: windowLabel(from, to), isFallback: false };
}

/** "12–15 Mar" for a custom window. */
export function windowLabel(from: number, to: number): string {
  const iso = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  return formatDateRange(iso(from), iso(to));
}

export type WindowPreset = '3d' | '7d' | '30d' | 'all';

export function presetWindow(preset: WindowPreset, now: number = Date.now()): ImportWindow {
  if (preset === 'all') {
    return {
      from: 0,
      to: startOfLocalDay(now) + DAY_MS - 1,
      label: 'Everything',
      isFallback: true,
    };
  }
  return recentWindow(preset === '3d' ? 3 : preset === '7d' ? 7 : 30, now);
}

// ---------------------------------------------------------------- grouping

export interface DatedAsset {
  id: string;
  creationTime: number;
}

export interface DaySection<T extends DatedAsset> {
  key: string;
  label: string;
  items: T[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "Thu 12 Mar". */
export function dayLabel(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${monthShort(d.getMonth())}`;
}

/** Groups by local day, days ascending, photos ascending inside a day. */
export function groupByDay<T extends DatedAsset>(assets: readonly T[]): DaySection<T>[] {
  const map = new Map<string, DaySection<T>>();
  for (const a of [...assets].sort((x, y) => x.creationTime - y.creationTime)) {
    const key = dayKey(a.creationTime);
    let s = map.get(key);
    if (!s) {
      s = { key, label: dayLabel(a.creationTime), items: [] };
      map.set(key, s);
    }
    s.items.push(a);
  }
  return [...map.values()];
}

export type ListRow<T> =
  | { type: 'header'; key: string; dayKey: string; label: string; total: number }
  | { type: 'row'; key: string; dayKey: string; items: T[] };

/** Flattens sections into list rows: a header per day, then rows of `columns` tiles. */
export function flattenSections<T extends DatedAsset>(
  sections: readonly DaySection<T>[],
  columns = 4,
): ListRow<T>[] {
  const rows: ListRow<T>[] = [];
  for (const s of sections) {
    rows.push({
      type: 'header',
      key: `h:${s.key}`,
      dayKey: s.key,
      label: s.label,
      total: s.items.length,
    });
    for (let i = 0; i < s.items.length; i += columns) {
      rows.push({
        type: 'row',
        key: `r:${s.key}:${i}`,
        dayKey: s.key,
        items: s.items.slice(i, i + columns),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- duplicates + selection

/** Best-effort local duplicate key: filename + capture second (the server dedupes by hash). */
export function importedKey(fileName: string | null | undefined, creationTimeMs: number): string {
  return `${(fileName ?? '').toLowerCase()}|${Math.round(creationTimeMs / 1000)}`;
}

/** Ids to select on open: everything not already in the roll (per the local cache). */
export function preselect<T extends { id: string; filename?: string | null; creationTime: number }>(
  assets: readonly T[],
  imported: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const a of assets) if (!imported.has(importedKey(a.filename, a.creationTime))) out.add(a.id);
  return out;
}

/** Rough upload size from pixel dimensions (the library API gives no file size). */
export function estimateBytes(assets: readonly { width?: number; height?: number }[]): number {
  let total = 0;
  for (const a of assets) {
    const px = (a.width ?? 0) * (a.height ?? 0);
    total += px > 0 ? px * 0.35 : 4_000_000;
  }
  return Math.round(total);
}

/** "> 200 photos → suggest Wi-Fi only". */
export function shouldSuggestWifi(selected: number): boolean {
  return selected > WIFI_SUGGEST_THRESHOLD;
}

/** Banner text: "142 photos look like Goa '26". */
export function bannerTitle(total: number, rollName: string): string {
  return `${total} ${total === 1 ? 'photo looks' : 'photos look'} like ${rollName}`;
}
