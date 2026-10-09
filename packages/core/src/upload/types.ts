// Wire types for the upload-init / upload-complete Edge Functions (architecture §8).
// Server and both clients import exactly these.

export type UploadVariant = 'thumb' | 'display' | 'original';
export const UPLOAD_VARIANTS: readonly UploadVariant[] = ['thumb', 'display', 'original'];

export interface UploadInitRequest {
  /** Client-generated uuid v4; the idempotency key. */
  photo_id: string;
  roll_id: string;
  /** 'md5:<32 lowercase hex>' of the original bytes. */
  content_hash: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  taken_at?: string | null;
  chapter_id?: string | null;
  caption?: string | null;
  display_bytes: number;
  thumb_bytes: number;
}

/**
 * A presigned single PUT. The URL signs `content-type` and `content-length`: the client must send exactly
 * `headers` and a body of exactly `content_length` bytes (browsers / native uploaders set the Content-Length
 * header themselves from the body, so it is not part of `headers`). Anything else is rejected by R2.
 */
export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
  /** Signed body length in bytes. */
  content_length: number;
}

export interface MultipartTarget {
  mode: 'multipart';
  upload_id: string;
  part_size: number;
  /**
   * Every part of the upload, 1-based, with a fresh URL. Already-uploaded parts may be skipped.
   * `content_length` is the signed body length of that part (`part_size`, the last part is shorter).
   */
  parts: { n: number; url: string; content_length: number }[];
}

export type OriginalTarget = ({ mode: 'put' } & PresignedPut) | MultipartTarget;

export interface UploadInitDuplicate {
  status: 'duplicate';
  /**
   * The photo already in the Roll with the same content hash. When it equals the request's
   * `photo_id`, the caller's own photo is already complete (idempotent re-init after a crash).
   * Omitted when the caller is not allowed to see that photo (someone else's only-me / in-review photo).
   */
  existing_photo_id?: string;
}

export interface UploadInitUpload {
  status: 'upload';
  photo_id: string;
  original: OriginalTarget;
  display: PresignedPut;
  thumb: PresignedPut;
  /** ISO timestamp; the earliest expiry among the returned URLs. Re-init before it to refresh. */
  expires_at: string;
}

export type UploadInitResponse = UploadInitDuplicate | UploadInitUpload;

export interface UploadPartEtag {
  n: number;
  etag: string;
}

export interface UploadCompleteRequest {
  photo_id: string;
  /** Required for multipart originals: every part with the ETag R2 returned. */
  parts?: UploadPartEtag[];
  blurhash?: string | null;
}

/** The photo row as the uploader sees it after completion. */
export interface UploadedPhoto {
  id: string;
  crew_id: string;
  roll_id: string | null;
  uploader_id: string;
  chapter_id: string | null;
  status: 'pending' | 'ready' | 'review' | 'removed';
  visibility: 'everyone' | 'selected' | 'only_me';
  content_hash: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  sort_at: string;
  thumb_key: string;
  display_key: string;
  blurhash: string | null;
  caption: string | null;
  created_at: string;
}

export interface UploadCompleteResponse {
  status: 'ready' | 'review';
  photo: UploadedPhoto;
}

/** `details` of a 422 `upload_incomplete` error from upload-complete. */
export interface UploadIncompleteDetails {
  /** Variants that are missing or failed verification; re-PUT only these. */
  missing: UploadVariant[];
  /** Multipart: the uploaded parts were rejected (bad ETags) — upload every part again. */
  reset_parts?: boolean;
  /** Multipart: the multipart upload is gone; the next init starts a new one. */
  restart_multipart?: boolean;
}

/** Error envelope every function returns (supabase/functions/_shared/http.ts). */
export interface FunctionErrorBody {
  error: { code: string; message?: string; details?: unknown };
}

/**
 * Access context returned by the service-role RPC `svc_upload_context(p_user, p_roll)`.
 * `crew_id` is null when the roll does not exist (or is deleted).
 */
export interface UploadContext {
  can_upload: boolean;
  crew_id: string | null;
  is_admin: boolean;
  is_guest: boolean;
  allow_uploads: boolean;
  guests_allowed: boolean;
  guest_uploads_review: boolean;
  guest_photo_count: number;
  storage_used_bytes: number;
  storage_limit_bytes: number | null;
  max_photo_bytes: number;
  max_upload_parts: number;
  /** Optional; when absent the server reads app_settings.limits.guest_max_photos_per_roll. */
  guest_max_photos_per_roll?: number | null;
  /** The caller's unfinished (status 'pending') uploads and their bytes; not yet in storage_used_bytes. */
  pending_count?: number;
  pending_bytes?: number;
}
