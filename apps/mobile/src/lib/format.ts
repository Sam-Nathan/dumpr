/** Formatting helpers. Pure (no React Native imports) so they are unit-tested. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthShort(monthIndex0: number): string {
  return MONTHS[monthIndex0] ?? '';
}
export function monthLong(monthIndex0: number): string {
  return MONTHS_LONG[monthIndex0] ?? '';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Thousands separators: 1204 -> "1,204". */
export function formatCount(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "1 photo" / "142 photos". */
export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** Bytes -> "412 MB", "6.8 GB". Decimal units (what phones and the design show). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i += 1;
  }
  if (i === 0) return `${Math.round(value)} B`;
  const digits = i <= 1 || value >= 100 ? 0 : 1;
  const text = value.toFixed(digits).replace(/\.0$/, '');
  return `${text} ${units[i]}`;
}

type DateInput = Date | string | number;

function toDate(d: DateInput): Date {
  return d instanceof Date ? d : new Date(d);
}

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function parts(date: Date, utc: boolean): Parts {
  return utc
    ? {
        y: date.getUTCFullYear(),
        m: date.getUTCMonth(),
        d: date.getUTCDate(),
        h: date.getUTCHours(),
        mi: date.getUTCMinutes(),
        s: date.getUTCSeconds(),
      }
    : {
        y: date.getFullYear(),
        m: date.getMonth(),
        d: date.getDate(),
        h: date.getHours(),
        mi: date.getMinutes(),
        s: date.getSeconds(),
      };
}

/** Parse a Postgres `date` ("2026-03-12") as a calendar day with no timezone shift. */
export function parseDay(day: string | null | undefined): Date | null {
  if (!day) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/**
 * Roll date range from Postgres dates:
 * same month "12–15 Mar" · across months "28 Feb – 2 Mar" · across years "28 Dec '25 – 2 Jan '26"
 * · one day "12 Mar" · open ended "From 12 Mar" · none "".
 */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const a = parseDay(start);
  const b = parseDay(end);
  if (!a && !b) return '';
  if (a && !b) return `From ${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`;
  if (!a && b) return `Until ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
  if (!a || !b) return '';
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  const sameDay = sameMonth && a.getUTCDate() === b.getUTCDate();
  const mon = (d: Date) => MONTHS[d.getUTCMonth()];
  const yy = (d: Date) => `'${pad2(d.getUTCFullYear() % 100)}`;
  if (sameDay) return `${a.getUTCDate()} ${mon(a)}`;
  if (sameMonth) return `${a.getUTCDate()}–${b.getUTCDate()} ${mon(a)}`;
  if (sameYear) return `${a.getUTCDate()} ${mon(a)} – ${b.getUTCDate()} ${mon(b)}`;
  return `${a.getUTCDate()} ${mon(a)} ${yy(a)} – ${b.getUTCDate()} ${mon(b)} ${yy(b)}`;
}

/** Compact relative time: "now", "5m", "2h", "3d", "2w", then "12 Mar". */
export function formatRelative(
  when: DateInput | null | undefined,
  now: DateInput = Date.now(),
  opts: { utc?: boolean } = {},
): string {
  if (when == null) return '';
  const t = toDate(when).getTime();
  const n = toDate(now).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, n - t);
  const min = 60_000;
  if (diff < min) return 'now';
  if (diff < 60 * min) return `${Math.floor(diff / min)}m`;
  if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))}h`;
  if (diff < 7 * 24 * 60 * min) return `${Math.floor(diff / (24 * 60 * min))}d`;
  if (diff < 28 * 24 * 60 * min) return `${Math.floor(diff / (7 * 24 * 60 * min))}w`;
  const p = parts(toDate(when), opts.utc ?? false);
  const pn = parts(toDate(now), opts.utc ?? false);
  return p.y === pn.y ? `${p.d} ${MONTHS[p.m]}` : `${p.d} ${MONTHS[p.m]} '${pad2(p.y % 100)}`;
}

/**
 * Date stamp in the mono orange style: "14 03 '26 · 07:42:10" (day month 'yy · time).
 * `seconds: false` gives "14 03 '26 · 07:42"; `time: false` gives "14 03 '26".
 */
export function formatStamp(
  when: DateInput | null | undefined,
  opts: { seconds?: boolean; time?: boolean; utc?: boolean } = {},
): string {
  if (when == null) return '';
  const date = toDate(when);
  if (Number.isNaN(date.getTime())) return '';
  const p = parts(date, opts.utc ?? false);
  const day = `${pad2(p.d)} ${pad2(p.m + 1)} '${pad2(p.y % 100)}`;
  if (opts.time === false) return day;
  const time = `${pad2(p.h)}:${pad2(p.mi)}${opts.seconds === false ? '' : `:${pad2(p.s)}`}`;
  return `${day} · ${time}`;
}

/** "07:42:10" from milliseconds (reveal countdowns). Hours grow past 99 without wrapping. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/** "0:24" resend timer. */
export function formatResend(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** "Meera Iyer" -> "MI", "diya" -> "D", "" -> "?". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0] ?? '')[0] ?? '';
  if (words.length === 1) return first.toUpperCase();
  const last = Array.from(words[words.length - 1] ?? '')[0] ?? '';
  return (first + last).toUpperCase();
}

/** "12 August" from day (1-31) + month (1-12). */
export function formatBirthday(day: number | null, month: number | null): string {
  if (!day || !month || month < 1 || month > 12) return '';
  return `${day} ${MONTHS_LONG[month - 1]}`;
}

/** Days in a month (leap-year tolerant: February allows 29, birthdays have no year). */
export function daysInMonth(month: number): number {
  if (month === 2) return 29;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
