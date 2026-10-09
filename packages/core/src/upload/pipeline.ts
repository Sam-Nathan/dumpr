// One upload attempt for a prepared photo: init → PUT thumb, display, original (single or
// multipart) → complete. Platform IO is injected, so mobile (expo-file-system) and web (XHR)
// share this logic and it is unit-tested with a fake transport.
//
// Resumability: everything already uploaded is recorded in `UploadProgressState` (persisted by
// the caller through `saveProgress`) and skipped on the next attempt; a fresh init on each attempt
// refreshes expired URLs and keeps the same multipart upload id.

import { UploadError, errorToState, toUploadError } from './errors.ts';
import { partRanges, type PartRange } from './parts.ts';
import type {
  PresignedPut,
  UploadCompleteResponse,
  UploadIncompleteDetails,
  UploadInitRequest,
  UploadInitResponse,
  UploadPartEtag,
  UploadVariant,
} from './types.ts';
import { md5HexFromContentHash, normalizeEtag } from './validate.ts';

// core has no DOM/Node lib types; declare the one global we use.
declare const setTimeout: (fn: () => void, ms: number) => unknown;

export interface AbortLike {
  readonly aborted: boolean;
}

/** Everything upload-init needs, produced by the platform's prepare step. */
export interface PreparedUpload {
  photoId: string;
  rollId: string;
  chapterId?: string | null;
  caption?: string | null;
  contentHash: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  takenAt?: string | null;
  displayBytes: number;
  thumbBytes: number;
  blurhash?: string | null;
}

export interface MultipartProgress {
  uploadId: string;
  partSize: number;
  partsDone: UploadPartEtag[];
}

export interface UploadProgressState {
  /** Variants whose single PUT finished (the multipart original is never listed here). */
  variantsDone: UploadVariant[];
  multipart: MultipartProgress | null;
}

export const emptyProgress = (): UploadProgressState => ({ variantsDone: [], multipart: null });

export interface UploadTransport {
  init(req: UploadInitRequest): Promise<UploadInitResponse>;
  complete(req: { photo_id: string; parts?: UploadPartEtag[]; blurhash?: string | null }): Promise<UploadCompleteResponse>;
  /** PUT one whole variant. Resolves with the response ETag (null if not readable). */
  putVariant(
    variant: UploadVariant,
    target: PresignedPut,
    onProgress: (sentBytes: number) => void,
  ): Promise<{ etag: string | null }>;
  /** PUT one byte range of the original to a presigned part URL. */
  putPart(part: PartRange, url: string, onProgress: (sentBytes: number) => void): Promise<{ etag: string | null }>;
}

export type UploadStage = 'initiating' | 'uploading' | 'completing';

export interface RunUploadHooks {
  signal?: AbortLike;
  onStage?(stage: UploadStage, info: { totalBytes: number; sentBytes: number }): void;
  onProgress?(sentBytes: number, totalBytes: number): void;
  saveProgress?(p: UploadProgressState): Promise<void> | void;
  /** Quick retries per multipart part before the attempt fails (default 3). */
  partRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type RunUploadResult =
  | { kind: 'done'; status: 'ready' | 'review'; response: UploadCompleteResponse | null }
  | { kind: 'duplicate'; existingPhotoId: string };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function toInitRequest(job: PreparedUpload): UploadInitRequest {
  return {
    photo_id: job.photoId,
    roll_id: job.rollId,
    content_hash: job.contentHash,
    mime: job.mime,
    bytes: job.bytes,
    width: job.width,
    height: job.height,
    taken_at: job.takenAt ?? null,
    chapter_id: job.chapterId ?? null,
    caption: job.caption ?? null,
    display_bytes: job.displayBytes,
    thumb_bytes: job.thumbBytes,
  };
}

function variantSize(job: PreparedUpload, v: UploadVariant): number {
  return v === 'thumb' ? job.thumbBytes : v === 'display' ? job.displayBytes : job.bytes;
}

function parseIncomplete(details: unknown): UploadIncompleteDetails {
  const d = (details ?? {}) as Partial<UploadIncompleteDetails>;
  const missing = Array.isArray(d.missing)
    ? d.missing.filter((v): v is UploadVariant => v === 'thumb' || v === 'display' || v === 'original')
    : [];
  return {
    missing: missing.length ? missing : ['thumb', 'display', 'original'],
    reset_parts: d.reset_parts === true,
    restart_multipart: d.restart_multipart === true,
  };
}

function checkAbort(signal?: AbortLike) {
  if (signal?.aborted) throw new UploadError('cancelled');
}

/**
 * Runs one attempt. Throws UploadError on failure (the caller feeds `error.code` to the reducer).
 * `progress` is not mutated; every change is reported through `saveProgress` with a new object.
 */
export async function runUpload(
  job: PreparedUpload,
  initialProgress: UploadProgressState,
  transport: UploadTransport,
  hooks: RunUploadHooks = {},
): Promise<RunUploadResult> {
  const sleep = hooks.sleep ?? defaultSleep;
  const partRetries = hooks.partRetries ?? 3;
  let p: UploadProgressState = {
    variantsDone: [...initialProgress.variantsDone],
    multipart: initialProgress.multipart
      ? { ...initialProgress.multipart, partsDone: [...initialProgress.multipart.partsDone] }
      : null,
  };
  const save = async (next: UploadProgressState) => {
    p = next;
    await hooks.saveProgress?.(next);
  };
  const totalBytes = job.thumbBytes + job.displayBytes + job.bytes;

  // At most 3 rounds: a 422 upload_incomplete re-inits and re-sends only what is missing.
  for (let round = 0; round < 3; round++) {
    checkAbort(hooks.signal);
    hooks.onStage?.('initiating', { totalBytes, sentBytes: 0 });
    const res = await transport.init(toInitRequest(job));
    if (res.status === 'duplicate') {
      if (res.existing_photo_id === job.photoId) return { kind: 'done', status: 'ready', response: null };
      return { kind: 'duplicate', existingPhotoId: res.existing_photo_id };
    }
    checkAbort(hooks.signal);

    const original = res.original;
    if (original.mode === 'multipart') {
      const mp = p.multipart;
      if (!mp || mp.uploadId !== original.upload_id || mp.partSize !== original.part_size) {
        await save({
          variantsDone: p.variantsDone.filter((v) => v !== 'original'),
          multipart: { uploadId: original.upload_id, partSize: original.part_size, partsDone: [] },
        });
      }
    } else if (p.multipart) {
      await save({ ...p, multipart: null });
    }

    const ranges = original.mode === 'multipart' ? partRanges(job.bytes, original.part_size) : [];
    const doneBytes = () => {
      let s = 0;
      for (const v of p.variantsDone) s += variantSize(job, v);
      if (p.multipart) {
        const done = new Set(p.multipart.partsDone.map((x) => x.n));
        for (const r of ranges) if (done.has(r.n)) s += r.end - r.start;
      }
      return Math.min(s, totalBytes);
    };
    hooks.onStage?.('uploading', { totalBytes, sentBytes: doneBytes() });
    const report = (inflight: number) => hooks.onProgress?.(Math.min(totalBytes, doneBytes() + inflight), totalBytes);

    // Small variants first so the tile has something to show as early as possible.
    for (const v of ['thumb', 'display'] as const) {
      if (p.variantsDone.includes(v)) continue;
      checkAbort(hooks.signal);
      await transport.putVariant(v, res[v], report);
      await save({ ...p, variantsDone: [...p.variantsDone, v] });
      report(0);
    }

    if (original.mode === 'put') {
      if (!p.variantsDone.includes('original')) {
        checkAbort(hooks.signal);
        const { etag } = await transport.putVariant('original', original, report);
        const want = md5HexFromContentHash(job.contentHash);
        // R2's single-PUT ETag is the MD5 of the bytes: a mismatch means they changed in transit.
        if (etag && want && normalizeEtag(etag) !== want) throw new UploadError('checksum_mismatch');
        await save({ ...p, variantsDone: [...p.variantsDone, 'original'] });
        report(0);
      }
    } else {
      const urls = new Map(original.parts.map((x) => [x.n, x.url]));
      for (const range of ranges) {
        if (p.multipart!.partsDone.some((x) => x.n === range.n)) continue;
        const url = urls.get(range.n);
        if (!url) throw new UploadError('internal', { message: `no url for part ${range.n}` });
        let etag: string | null = null;
        for (let t = 0; ; t++) {
          checkAbort(hooks.signal);
          try {
            etag = (await transport.putPart(range, url, report)).etag;
            break;
          } catch (e) {
            const err = toUploadError(e);
            if (err.code === 'cancelled' || errorToState(err.code).kind !== 'retryable' || t + 1 >= partRetries) {
              throw err;
            }
            await sleep(1000 * 2 ** t);
          }
        }
        if (!etag) throw new UploadError('missing_etag');
        const mp = p.multipart!;
        await save({ ...p, multipart: { ...mp, partsDone: [...mp.partsDone, { n: range.n, etag }] } });
        report(0);
      }
    }

    checkAbort(hooks.signal);
    hooks.onStage?.('completing', { totalBytes, sentBytes: totalBytes });
    try {
      const done = await transport.complete({
        photo_id: job.photoId,
        ...(p.multipart ? { parts: [...p.multipart.partsDone].sort((a, b) => a.n - b.n) } : {}),
        ...(job.blurhash ? { blurhash: job.blurhash } : {}),
      });
      return { kind: 'done', status: done.status, response: done };
    } catch (e) {
      const err = toUploadError(e);
      if (err.code !== 'upload_incomplete') throw err;
      const d = parseIncomplete(err.details);
      let multipart = p.multipart;
      if (multipart && d.restart_multipart) multipart = null;
      else if (multipart && d.reset_parts) multipart = { ...multipart, partsDone: [] };
      await save({ variantsDone: p.variantsDone.filter((v) => !d.missing.includes(v)), multipart });
    }
  }
  throw new UploadError('upload_incomplete');
}
