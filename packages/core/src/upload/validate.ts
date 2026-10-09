// Request validation shared by upload-init / upload-complete and the clients (fail fast locally).

import {
  ACCEPTED_IMAGE_MIME,
  BLURHASH_MAX_CHARS,
  DEFAULT_MAX_PHOTO_BYTES,
  DEFAULT_MAX_UPLOAD_PARTS,
  MAX_CAPTION_CHARS,
  MAX_DISPLAY_BYTES,
  MAX_THUMB_BYTES,
  S3_MAX_PARTS,
} from './constants.ts';
import type { UploadCompleteRequest, UploadContext, UploadInitRequest, UploadPartEtag } from './types.ts';

export type Validated<T> = { ok: true; value: T } | { ok: false; code: 'invalid_input'; field: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_HASH_RE = /^md5:[0-9a-f]{32}$/;
// Blurhash base83 alphabet.
const BLURHASH_RE = /^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,}$/;
const MAX_DIMENSION = 100_000;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function isContentHash(v: unknown): v is string {
  return typeof v === 'string' && CONTENT_HASH_RE.test(v);
}

/** 'md5:<hex>' → '<hex>' (lowercase), or null when malformed. */
export function md5HexFromContentHash(hash: string): string | null {
  const h = hash.trim().toLowerCase();
  return CONTENT_HASH_RE.test(h) ? h.slice(4) : null;
}

/** Builds 'md5:<hex>' from a hex digest (any case). Throws on malformed input. */
export function contentHashFromMd5Hex(hex: string): string {
  const h = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) throw new RangeError('md5 hex digest expected');
  return `md5:${h}`;
}

/** ETags come quoted (and sometimes weak, W/"…"); compare them bare and lowercase. */
export function normalizeEtag(etag: string | null | undefined): string {
  return (etag ?? '')
    .trim()
    .replace(/^W\//i, '')
    .replace(/"/g, '')
    .toLowerCase();
}

export function isAcceptedMime(mime: unknown): mime is string {
  return typeof mime === 'string' && (ACCEPTED_IMAGE_MIME as readonly string[]).includes(mime.toLowerCase());
}

export function isValidBlurhash(v: unknown): v is string {
  return typeof v === 'string' && v.length <= BLURHASH_MAX_CHARS && BLURHASH_RE.test(v);
}

function posInt(v: unknown, max = Number.MAX_SAFE_INTEGER): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= max;
}

function optDimension(v: unknown): v is number | null | undefined {
  return v === null || v === undefined || posInt(v, MAX_DIMENSION);
}

function isIsoTimestamp(v: string): boolean {
  if (v.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

/**
 * Validates an upload-init body. Size limits that depend on settings (max_photo_bytes, quota) are
 * checked by the server against `svc_upload_context`, not here.
 */
export function validateInitRequest(input: unknown): Validated<UploadInitRequest> {
  const bad = (field: string): Validated<UploadInitRequest> => ({ ok: false, code: 'invalid_input', field });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('body');
  const b = input as Record<string, unknown>;
  if (!isUuid(b.photo_id)) return bad('photo_id');
  if (!isUuid(b.roll_id)) return bad('roll_id');
  if (!isContentHash(b.content_hash)) return bad('content_hash');
  if (!isAcceptedMime(b.mime)) return bad('mime');
  if (!posInt(b.bytes)) return bad('bytes');
  if (!optDimension(b.width)) return bad('width');
  if (!optDimension(b.height)) return bad('height');
  if (b.taken_at !== undefined && b.taken_at !== null && (typeof b.taken_at !== 'string' || !isIsoTimestamp(b.taken_at))) {
    return bad('taken_at');
  }
  if (b.chapter_id !== undefined && b.chapter_id !== null && !isUuid(b.chapter_id)) return bad('chapter_id');
  if (b.caption !== undefined && b.caption !== null) {
    if (typeof b.caption !== 'string' || [...b.caption].length > MAX_CAPTION_CHARS) return bad('caption');
  }
  if (!posInt(b.display_bytes, MAX_DISPLAY_BYTES)) return bad('display_bytes');
  if (!posInt(b.thumb_bytes, MAX_THUMB_BYTES)) return bad('thumb_bytes');
  const caption = typeof b.caption === 'string' ? b.caption.trim() : null;
  return {
    ok: true,
    value: {
      photo_id: (b.photo_id as string).toLowerCase(),
      roll_id: (b.roll_id as string).toLowerCase(),
      content_hash: b.content_hash as string,
      mime: (b.mime as string).toLowerCase(),
      bytes: b.bytes as number,
      width: (b.width as number | null | undefined) ?? null,
      height: (b.height as number | null | undefined) ?? null,
      taken_at: (b.taken_at as string | null | undefined) ?? null,
      chapter_id: b.chapter_id ? (b.chapter_id as string).toLowerCase() : null,
      caption: caption ? caption : null,
      display_bytes: b.display_bytes as number,
      thumb_bytes: b.thumb_bytes as number,
    },
  };
}

/** Validates an upload-complete body. Parts are returned sorted and de-duplicated by `n`. */
export function validateCompleteRequest(input: unknown): Validated<UploadCompleteRequest> {
  const bad = (field: string): Validated<UploadCompleteRequest> => ({ ok: false, code: 'invalid_input', field });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('body');
  const b = input as Record<string, unknown>;
  if (!isUuid(b.photo_id)) return bad('photo_id');
  let parts: UploadPartEtag[] | undefined;
  if (b.parts !== undefined && b.parts !== null) {
    if (!Array.isArray(b.parts) || b.parts.length > S3_MAX_PARTS) return bad('parts');
    const byN = new Map<number, string>();
    for (const p of b.parts as unknown[]) {
      const o = p as { n?: unknown; etag?: unknown } | null;
      if (!o || !posInt(o.n, S3_MAX_PARTS) || typeof o.etag !== 'string') return bad('parts');
      const etag = o.etag.trim();
      if (etag.length === 0 || etag.length > 128 || /[<>&\s]/.test(etag.replace(/"/g, ''))) return bad('parts');
      byN.set(o.n, etag);
    }
    parts = [...byN.entries()].sort((a, b2) => a[0] - b2[0]).map(([n, etag]) => ({ n, etag }));
  }
  if (b.blurhash !== undefined && b.blurhash !== null && !isValidBlurhash(b.blurhash)) return bad('blurhash');
  const value: UploadCompleteRequest = { photo_id: (b.photo_id as string).toLowerCase() };
  if (parts) value.parts = parts;
  if (typeof b.blurhash === 'string') value.blurhash = b.blurhash;
  return { ok: true, value };
}

/** True when `parts` are exactly 1..count. */
export function partsAreComplete(parts: ReadonlyArray<{ n: number }>, count: number): boolean {
  if (parts.length !== count) return false;
  const seen = new Set<number>();
  for (const p of parts) {
    if (p.n < 1 || p.n > count || seen.has(p.n)) return false;
    seen.add(p.n);
  }
  return true;
}

export type UploadAccessDecision =
  | { ok: true; reviewFirst: boolean }
  | { ok: false; status: 403 | 404 | 413; code: string };

/**
 * Upload permission from `svc_upload_context` (null = RPC returned nothing). Pure so both
 * functions and tests share it. Size/quota are checked only when `bytes` is given (init).
 */
export function decideUploadAccess(
  ctx: UploadContext | null,
  opts: { bytes?: number; guestMaxPhotos?: number | null } = {},
): UploadAccessDecision {
  if (!ctx || !ctx.crew_id) return { ok: false, status: 404, code: 'not_found' };
  if (!ctx.can_upload) {
    if (ctx.is_guest && !ctx.guests_allowed) return { ok: false, status: 403, code: 'guests_not_allowed' };
    if (!ctx.allow_uploads && !ctx.is_admin) return { ok: false, status: 403, code: 'uploads_disabled' };
    return { ok: false, status: 403, code: 'not_a_member' };
  }
  if (opts.bytes !== undefined) {
    if (ctx.max_photo_bytes > 0 && opts.bytes > ctx.max_photo_bytes) {
      return { ok: false, status: 413, code: 'payload_too_large' };
    }
    if (ctx.storage_limit_bytes !== null && ctx.storage_limit_bytes !== undefined) {
      if (ctx.storage_used_bytes + opts.bytes > ctx.storage_limit_bytes) {
        return { ok: false, status: 413, code: 'storage_full' };
      }
    }
    const guestMax = opts.guestMaxPhotos ?? ctx.guest_max_photos_per_roll ?? null;
    if (ctx.is_guest && guestMax !== null && guestMax > 0 && ctx.guest_photo_count >= guestMax) {
      return { ok: false, status: 403, code: 'guest_limit_reached' };
    }
  }
  return { ok: true, reviewFirst: ctx.is_guest && ctx.guest_uploads_review };
}

/** Coerces the raw jsonb from `svc_upload_context` into an UploadContext (null if unusable). */
export function parseUploadContext(raw: unknown): UploadContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  const bool = (v: unknown) => v === true;
  const limit = r.storage_limit_bytes;
  return {
    can_upload: bool(r.can_upload),
    crew_id: typeof r.crew_id === 'string' ? r.crew_id : null,
    is_admin: bool(r.is_admin),
    is_guest: bool(r.is_guest),
    allow_uploads: r.allow_uploads !== false,
    guests_allowed: bool(r.guests_allowed),
    guest_uploads_review: bool(r.guest_uploads_review),
    guest_photo_count: num(r.guest_photo_count, 0),
    storage_used_bytes: num(r.storage_used_bytes, 0),
    storage_limit_bytes: limit === null || limit === undefined ? null : num(limit, 0),
    max_photo_bytes: num(r.max_photo_bytes, DEFAULT_MAX_PHOTO_BYTES),
    max_upload_parts: num(r.max_upload_parts, DEFAULT_MAX_UPLOAD_PARTS),
    guest_max_photos_per_roll:
      r.guest_max_photos_per_roll === null || r.guest_max_photos_per_roll === undefined
        ? null
        : num(r.guest_max_photos_per_roll, 0),
  };
}
