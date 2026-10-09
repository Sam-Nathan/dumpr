const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

/** Parses a Postgres `date` ("2026-03-12", optionally with a time part). No timezone maths involved. */
export function parseDateOnly(value: string | null | undefined): YMD | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * "12–15 Mar", "28 Feb – 2 Mar", "12 Mar", "28 Dec 2025 – 2 Jan 2026". Empty string when unknown.
 */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const a = parseDateOnly(start);
  const b = parseDateOnly(end);
  if (!a && !b) return '';
  if (a && !b) return `${a.d} ${MONTHS[a.m - 1]}`;
  if (!a && b) return `${b.d} ${MONTHS[b.m - 1]}`;
  if (!a || !b) return '';
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${a.d} ${MONTHS[a.m - 1]}`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[a.m - 1]}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]}`;
  return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

/** "1,204" (Indian digit grouping above 99,999: "1,20,400"). Negative / NaN become 0. */
export function formatCount(n: number): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return new Intl.NumberFormat('en-IN').format(safe);
}

/** "0 photos", "1 photo", "1,204 photos". */
export function formatPhotoCount(n: number): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return `${formatCount(safe)} ${safe === 1 ? 'photo' : 'photos'}`;
}

/** "1 person", "6 people". */
export function formatPeopleCount(n: number): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return `${formatCount(safe)} ${safe === 1 ? 'person' : 'people'}`;
}

/**
 * Human unlock time for sealed Rolls: "9:00 AM" when it is today, otherwise "Sat 14 Mar, 9:00 AM".
 * `timeZone` defaults to the runtime's zone (the browser's, when rendered on the client).
 */
export function formatUnlockTime(
  iso: string | null | undefined,
  now: Date = new Date(),
  timeZone?: string,
): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .replace(/\u202f/g, ' ');
  if (dayKey(date) === dayKey(now)) return time;
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(date)
    .replace(',', '');
  return `${day}, ${time}`;
}

/** Initials for avatar fallbacks: "Kabir Singh" -> "KS", "diya" -> "D". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const firstWord = parts[0] ?? '';
  const lastWord = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  const first = Array.from(firstWord)[0] ?? '';
  const last = Array.from(lastWord)[0] ?? '';
  return (first + last).toUpperCase();
}
