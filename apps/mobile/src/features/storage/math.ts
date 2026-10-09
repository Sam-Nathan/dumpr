/** F4 storage bar math. Pure + unit-tested. */
import type { CrewTint } from '../../data/types';
import type { MyStorage } from '../../data/types-cf';
import { formatBytes } from '../../lib/format';

/** Saturated bar colours per Crew tint (the pastel tints are too faint for a bar). */
export const CREW_BAR_COLORS: Record<CrewTint, string> = {
  lilac: '#B79BFF',
  lime: '#9ADB3A',
  sky: '#6FC6F5',
  peach: '#FF9F6B',
  pink: '#FF86B6',
  mint: '#5FD3A4',
};
export const OTHER_BAR_COLOR = '#8C8794';

export interface BarSegment {
  key: string;
  label: string;
  bytes: number;
  color: string;
  /** 0..1 of the bar. */
  fraction: number;
}

export interface StorageBar {
  segments: BarSegment[];
  usedBytes: number;
  /** Bytes in use that no Crew accounts for (Snaps & chat media). */
  otherBytes: number;
  /** used / limit (0 when there is no limit). */
  usedFraction: number;
  nearLimit: boolean;
  full: boolean;
}

const NEAR_LIMIT = 0.9;

/**
 * Segments for the usage bar. With a limit the bar is the limit; without one it is the used total
 * (so the colours fill the bar and still show the proportions).
 */
export function storageBar(s: MyStorage): StorageBar {
  const used = Math.max(0, s.used_bytes);
  const limit = s.limit_bytes && s.limit_bytes > 0 ? s.limit_bytes : null;
  const total = limit ?? used;
  const crewSum = s.by_crew.reduce((n, c) => n + Math.max(0, c.bytes), 0);
  const other = Math.max(0, used - crewSum);
  const denom = Math.max(total, crewSum + other, 1);

  const segments: BarSegment[] = s.by_crew
    .filter((c) => c.bytes > 0)
    .map((c) => ({
      key: c.crew_id,
      label: c.name,
      bytes: c.bytes,
      color: CREW_BAR_COLORS[c.tint] ?? OTHER_BAR_COLOR,
      fraction: c.bytes / denom,
    }));
  if (other > 0) {
    segments.push({
      key: 'other',
      label: 'Snaps & chat media',
      bytes: other,
      color: OTHER_BAR_COLOR,
      fraction: other / denom,
    });
  }
  const usedFraction = limit ? Math.min(1, used / limit) : 0;
  return {
    segments,
    usedBytes: used,
    otherBytes: other,
    usedFraction,
    nearLimit: !!limit && used / limit >= NEAR_LIMIT,
    full: !!limit && used >= limit,
  };
}

/** "of [PLAN LIMIT] used" is a design placeholder: with no limit configured say so plainly. */
export function planLine(limitBytes: number | null | undefined): string {
  return limitBytes && limitBytes > 0
    ? `of ${formatBytes(limitBytes)} used`
    : 'used · No limit yet';
}

/** "Free up 9.6 GB" style amount, or null when there is nothing to show. */
export function cacheLabel(bytes: number | null | undefined): string {
  if (bytes == null) return 'Calculating…';
  return formatBytes(bytes);
}
