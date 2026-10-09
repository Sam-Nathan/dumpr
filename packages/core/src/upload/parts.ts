import {
  DEFAULT_MAX_UPLOAD_PARTS,
  DEFAULT_PART_SIZE,
  MiB,
  S3_MAX_PARTS,
  SINGLE_PUT_MAX_BYTES,
} from './constants.ts';

export interface PartRange {
  /** 1-based part number. */
  n: number;
  /** Inclusive start byte offset. */
  start: number;
  /** Exclusive end byte offset. */
  end: number;
}

export type PartPlan =
  | { mode: 'put'; bytes: number }
  | { mode: 'multipart'; bytes: number; partSize: number; count: number };

/**
 * How an original of `bytes` goes up: one PUT when <= 16 MiB, else 8 MiB parts. When 8 MiB parts
 * would exceed `maxParts`, the part size grows (rounded up to a whole MiB) so the count fits.
 */
export function planParts(
  bytes: number,
  opts: { maxParts?: number; partSize?: number } = {},
): PartPlan {
  if (!Number.isSafeInteger(bytes) || bytes <= 0)
    throw new RangeError('bytes must be a positive integer');
  if (bytes <= SINGLE_PUT_MAX_BYTES) return { mode: 'put', bytes };
  const maxParts = Math.min(
    Math.max(1, Math.floor(opts.maxParts ?? DEFAULT_MAX_UPLOAD_PARTS)),
    S3_MAX_PARTS,
  );
  let partSize = opts.partSize ?? DEFAULT_PART_SIZE;
  if (Math.ceil(bytes / partSize) > maxParts) {
    partSize = Math.ceil(bytes / maxParts / MiB) * MiB;
  }
  return { mode: 'multipart', bytes, partSize, count: Math.ceil(bytes / partSize) };
}

/** The byte range of every part for a multipart upload of `bytes` with `partSize`. */
export function partRanges(bytes: number, partSize: number): PartRange[] {
  if (partSize <= 0) throw new RangeError('partSize must be positive');
  const out: PartRange[] = [];
  for (let n = 1, start = 0; start < bytes; n++, start += partSize) {
    out.push({ n, start, end: Math.min(start + partSize, bytes) });
  }
  return out;
}

/** Part numbers of 1..count that are not yet in `done`. */
export function missingParts(count: number, done: ReadonlyArray<{ n: number }>): number[] {
  const have = new Set(done.map((p) => p.n));
  const out: number[] = [];
  for (let n = 1; n <= count; n++) if (!have.has(n)) out.push(n);
  return out;
}
