// Pure verification logic for upload-complete (unit-tested in logic.test.ts; no IO here).
import {
  MAX_DISPLAY_BYTES,
  MAX_THUMB_BYTES,
  md5HexFromContentHash,
  normalizeEtag,
  type UploadIncompleteDetails,
  type UploadVariant,
} from '../../../packages/core/src/upload/index.ts';

export interface HeadResult {
  size: number;
  etag: string;
  contentType: string | null;
}

export interface VerifyInput {
  bytes: number;
  contentHash: string;
  /** Original went up as multipart: its ETag is not an MD5, only the size is checked. */
  multipart: boolean;
  heads: Record<UploadVariant, HeadResult | null>;
}

/** Variants that are missing or fail verification, in upload order. */
export function verifyObjects(v: VerifyInput): UploadVariant[] {
  const missing: UploadVariant[] = [];
  const thumb = v.heads.thumb;
  if (!thumb || thumb.size <= 0 || thumb.size > MAX_THUMB_BYTES) missing.push('thumb');
  const display = v.heads.display;
  if (!display || display.size <= 0 || display.size > MAX_DISPLAY_BYTES) missing.push('display');
  const o = v.heads.original;
  if (!o || o.size !== v.bytes) {
    missing.push('original');
  } else if (!v.multipart) {
    const want = md5HexFromContentHash(v.contentHash);
    if (!want || normalizeEtag(o.etag) !== want) missing.push('original');
  }
  return missing;
}

export type CompleteMultipartFailure = 'restart' | 'reset_parts' | 'transient';

/**
 * Classifies an error thrown by r2.completeMultipart:
 *  - the multipart upload is gone (404 / NoSuchUpload) → start a new one;
 *  - R2 rejected the part list (400 InvalidPart / InvalidPartOrder / EntityTooSmall) → re-send parts;
 *  - anything else (5xx, network) → transient, the client retries with backoff.
 */
export function classifyCompleteMultipartError(err: unknown): CompleteMultipartFailure {
  const msg = err instanceof Error ? err.message : String(err);
  if (/NoSuchUpload/i.test(msg) || /completeMultipart failed/.test(msg) || /\br2 POST 404\b/.test(msg)) return 'restart';
  if (/InvalidPart|InvalidPartOrder|EntityTooSmall|MalformedXML/i.test(msg) || /\br2 POST 400\b/.test(msg)) {
    return 'reset_parts';
  }
  return 'transient';
}

export function incompleteDetails(
  missing: UploadVariant[],
  extra: Omit<UploadIncompleteDetails, 'missing'> = {},
): UploadIncompleteDetails {
  const d: UploadIncompleteDetails = { missing };
  if (extra.reset_parts) d.reset_parts = true;
  if (extra.restart_multipart) d.restart_multipart = true;
  return d;
}
