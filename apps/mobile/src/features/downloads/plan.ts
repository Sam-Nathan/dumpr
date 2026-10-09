/** F1 download planning: batching, resume, estimates, album names. Pure + unit-tested. */

/** Originals are signed this many ids per `media-sign` call (the function allows 300). */
export const SIGN_BATCH = 100;
export const DOWNLOAD_CONCURRENCY = 3;

export type DownloadQuality = 'original' | 'high';
export type DownloadScope = 'photo' | 'selected' | 'roll';

/** What a download job needs to (re)start: persisted so an interrupted job can resume. */
export interface DownloadDescriptor {
  id: string;
  scope: DownloadScope;
  rollId: string | null;
  rollName: string;
  /** photo / selected scopes. */
  photoIds: string[];
  chapterId: string | null;
  /** "Downloads are off for this Roll": only the viewer's own photos. */
  onlyMine: boolean;
  quality: DownloadQuality;
  wifiOnly: boolean;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Ids still to download, in order, skipping the ones already saved (resume). */
export function remainingIds(all: readonly string[], saved: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of all) {
    if (saved.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Batches of ids for signing, resume-aware. */
export function planBatches(
  all: readonly string[],
  saved: ReadonlySet<string>,
  size: number = SIGN_BATCH,
): string[][] {
  return chunk(remainingIds(all, saved), size);
}

/** Variant to sign for a quality. */
export function variantFor(q: DownloadQuality): 'original' | 'display' {
  return q === 'original' ? 'original' : 'display';
}

/** Android defaults to High (smaller), iOS to Original. */
export function defaultQuality(platform: 'ios' | 'android' | string): DownloadQuality {
  return platform === 'android' ? 'high' : 'original';
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** File extension of the saved file: High is always a JPEG, originals keep their type. */
export function extensionFor(mime: string | null | undefined, quality: DownloadQuality): string {
  if (quality === 'high') return 'jpg';
  return EXT[(mime ?? '').toLowerCase()] ?? 'jpg';
}

function safePart(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || 'Roll';
}

/** Android: "Dumpr/Goa '26" (a Dumpr folder in Pictures). iOS: one album per Roll. */
export function albumName(platform: 'ios' | 'android' | string, rollName: string): string {
  const roll = safePart(rollName);
  return platform === 'android' ? `Dumpr/${roll}` : `Dumpr – ${roll}`;
}

const HIGH_BYTES = 650_000;
const DEFAULT_ORIGINAL_BYTES = 4_000_000;
/** Effective Wi-Fi throughput used for the time estimate (bits per second). */
const EFFECTIVE_BPS = 50_000_000;

export interface Estimate {
  bytes: number;
  seconds: number;
}

/**
 * Size + time estimate. `knownOriginalBytes` (sum of `photos.bytes`) is used for Original when we
 * have it; otherwise an average. High is a ~2048 px JPEG.
 */
export function estimateDownload(opts: {
  count: number;
  quality: DownloadQuality;
  knownOriginalBytes?: number | null;
}): Estimate {
  const count = Math.max(0, opts.count);
  const bytes =
    opts.quality === 'high'
      ? count * HIGH_BYTES
      : opts.knownOriginalBytes && opts.knownOriginalBytes > 0
        ? opts.knownOriginalBytes
        : count * DEFAULT_ORIGINAL_BYTES;
  return { bytes, seconds: Math.round((bytes * 8) / EFFECTIVE_BPS) };
}

/** "~14 MIN ON WI-FI" style duration: "<1 MIN", "14 MIN", "1 H 20 MIN". */
export function formatEta(seconds: number): string {
  if (seconds < 60) return '<1 MIN';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} MIN`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} H ${m} MIN` : `${h} H`;
}

export interface SpaceCheck {
  fits: boolean;
  /** Bytes needed including headroom. */
  needBytes: number;
  /** Switching to High would fit. */
  highWouldFit: boolean;
}

/** Keeps 10 % + 200 MB free so the phone does not run dry. */
export function checkSpace(opts: {
  bytes: number;
  freeBytes: number | null;
  count: number;
}): SpaceCheck {
  const need = Math.round(opts.bytes * 1.1) + 200_000_000;
  if (opts.freeBytes == null) return { fits: true, needBytes: need, highWouldFit: true };
  const highNeed = Math.round(opts.count * HIGH_BYTES * 1.1) + 200_000_000;
  return {
    fits: need <= opts.freeBytes,
    needBytes: need,
    highWouldFit: highNeed <= opts.freeBytes,
  };
}

export function progressFraction(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, done / total));
}

/** "Downloads · 1 running · 62%". */
export function jobStatusLine(
  status: 'idle' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled',
  done: number,
  total: number,
): string {
  const pct = Math.round(progressFraction(done, total) * 100);
  switch (status) {
    case 'running':
      return `1 running · ${pct}%`;
    case 'paused':
      return `Paused · ${pct}%`;
    case 'done':
      return 'Saved to your gallery';
    case 'failed':
      return `Stopped · ${pct}% · tap to resume`;
    default:
      return 'Nothing downloading';
  }
}

/** Storage key for the ids already saved by an unfinished job. */
export function savedKey(d: Pick<DownloadDescriptor, 'scope' | 'rollId' | 'quality'>): string {
  return `dumpr.dl.saved.${d.scope}.${d.rollId ?? '_'}.${d.quality}`;
}

/** Whole-roll button copy: "Download 1,204 photos". */
export function downloadLabel(count: number): string {
  if (count <= 0) return 'Download';
  return `Download ${count.toLocaleString('en-US')} ${count === 1 ? 'photo' : 'photos'}`;
}
