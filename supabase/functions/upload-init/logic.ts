// Pure decisions for upload-init (unit-tested in logic.test.ts; no IO here).
import {
  PART_URL_TTL_SECONDS,
  PUT_URL_TTL_SECONDS,
  planParts,
  type UploadInitRequest,
} from '../../../packages/core/src/upload/index.ts';

/** A pending photo with the same hash, owned by someone else, older than this is abandoned. */
export const STALE_PENDING_MS = 24 * 60 * 60 * 1000;

export interface ExistingPhoto {
  id: string;
  uploader_id: string;
  roll_id: string | null;
  crew_id: string;
  status: 'pending' | 'ready' | 'review' | 'removed';
  content_hash: string;
  bytes: number;
  mime: string;
  original_key: string;
  display_key: string;
  thumb_key: string;
  created_at: string;
}

export type ExistingDecision =
  /** photo_id belongs to someone else, or was used for a different file. */
  | { kind: 'conflict'; code: 'conflict' | 'photo_removed' }
  /** Already uploaded by the caller: answer duplicate with its own id (client treats it as done). */
  | { kind: 'complete' }
  /** Caller's own pending photo: hand out fresh URLs. */
  | { kind: 'resume' };

/** Idempotency on photo_id. */
export function classifyExisting(existing: ExistingPhoto, req: UploadInitRequest, userId: string): ExistingDecision {
  if (existing.uploader_id !== userId) return { kind: 'conflict', code: 'conflict' };
  if (existing.roll_id !== req.roll_id || existing.content_hash !== req.content_hash || existing.bytes !== req.bytes) {
    return { kind: 'conflict', code: 'conflict' };
  }
  if (existing.status === 'removed') return { kind: 'conflict', code: 'photo_removed' };
  if (existing.status === 'ready' || existing.status === 'review') return { kind: 'complete' };
  return { kind: 'resume' };
}

export interface DuplicateCandidate {
  id: string;
  uploader_id: string;
  status: 'pending' | 'ready' | 'review' | 'removed';
  created_at: string;
}

/**
 * Same bytes already in the Roll (unique (roll_id, content_hash) where status <> 'removed').
 * A *pending* duplicate that will never finish would otherwise block the photo forever, so:
 *  - the caller's own pending row under another photo_id (re-picked file, cancelled item) is replaced;
 *  - someone else's pending row older than STALE_PENDING_MS is replaced.
 */
export function classifyDuplicate(
  dup: DuplicateCandidate,
  userId: string,
  now: number,
): 'duplicate' | 'replace_stale' {
  if (dup.status !== 'pending') return 'duplicate';
  if (dup.uploader_id === userId) return 'replace_stale';
  const age = now - Date.parse(dup.created_at);
  return Number.isFinite(age) && age > STALE_PENDING_MS ? 'replace_stale' : 'duplicate';
}

export type OriginalPlan =
  | { mode: 'put' }
  | { mode: 'multipart'; partSize: number; count: number };

export interface MediaUploadRow {
  multipart_upload_id: string | null;
  part_size: number | null;
  parts: number | null;
}

/**
 * How the original goes up. An existing multipart upload (resume) is reused as long as its
 * geometry still covers the file; otherwise a new one is planned.
 */
export function planOriginal(bytes: number, maxParts: number, existing: MediaUploadRow | null): OriginalPlan {
  const plan = planParts(bytes, { maxParts });
  if (plan.mode === 'put') return { mode: 'put' };
  if (
    existing?.multipart_upload_id &&
    existing.part_size &&
    existing.parts &&
    Math.ceil(bytes / existing.part_size) === existing.parts
  ) {
    return { mode: 'multipart', partSize: existing.part_size, count: existing.parts };
  }
  return { mode: 'multipart', partSize: plan.partSize, count: plan.count };
}

/** True when the stored multipart upload can be reused for this plan. */
export function canReuseMultipart(existing: MediaUploadRow | null, plan: OriginalPlan): existing is MediaUploadRow & {
  multipart_upload_id: string;
} {
  return (
    plan.mode === 'multipart' &&
    !!existing?.multipart_upload_id &&
    existing.part_size === plan.partSize &&
    existing.parts === plan.count
  );
}

/** URLs expire at the earliest TTL handed out. */
export function urlsExpireAt(now: number, mode: 'put' | 'multipart'): { expiresAt: string; multipartExpiresAt: string } {
  return {
    expiresAt: new Date(now + PUT_URL_TTL_SECONDS * 1000).toISOString(),
    multipartExpiresAt: new Date(now + (mode === 'multipart' ? PART_URL_TTL_SECONDS : PUT_URL_TTL_SECONDS) * 1000).toISOString(),
  };
}

/** Postgres unique-violation helpers (PostgREST surfaces SQLSTATE in `code`). */
export function uniqueViolation(err: { code?: string; message?: string; details?: string } | null): 'pkey' | 'hash' | null {
  if (!err || err.code !== '23505') return null;
  const text = `${err.message ?? ''} ${err.details ?? ''}`;
  if (/content_hash/.test(text)) return 'hash';
  if (/pkey|\(id\)/.test(text)) return 'pkey';
  return 'hash';
}
