// Upload pipeline constants (architecture §8, §9). Shared by edge functions and clients.

export const MiB = 1024 * 1024;

/** Originals up to this size go up in one presigned PUT; larger ones use multipart. */
export const SINGLE_PUT_MAX_BYTES = 16 * MiB;
/** Default multipart part size. R2 requires equal-sized parts (except the last) of >= 5 MiB. */
export const DEFAULT_PART_SIZE = 8 * MiB;
/** S3/R2 minimum part size (except the last part). */
export const MIN_PART_SIZE = 5 * MiB;
/** S3/R2 hard limit on parts per upload. */
export const S3_MAX_PARTS = 10_000;
/** Fallback when app_settings.limits.max_upload_parts is unknown. */
export const DEFAULT_MAX_UPLOAD_PARTS = 100;
/** Fallback when app_settings.limits.max_photo_bytes is unknown (50 MiB). */
export const DEFAULT_MAX_PHOTO_BYTES = 50 * MiB;

/** Derived JPEG variants. */
export const DISPLAY_LONG_EDGE = 2048;
export const DISPLAY_QUALITY = 0.85;
export const THUMB_LONG_EDGE = 480;
export const THUMB_QUALITY = 0.7;
/** Upper bounds the server accepts for the derived variants. */
export const MAX_DISPLAY_BYTES = 15 * MiB;
export const MAX_THUMB_BYTES = 3 * MiB;

/** Retry policy: min(5 s · 2^n, 15 min) ± 20 %, at most 8 automatic attempts. */
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 15 * 60_000;
export const RETRY_JITTER = 0.2;
export const MAX_AUTO_ATTEMPTS = 8;

/** Items uploaded at the same time. */
export const UPLOAD_CONCURRENCY = 3;

/** Presigned PUT lifetime the server uses for single PUTs (parts live longer). */
export const PUT_URL_TTL_SECONDS = 60 * 60;
export const PART_URL_TTL_SECONDS = 6 * 60 * 60;

export const MAX_CAPTION_CHARS = 280;
export const BLURHASH_MAX_CHARS = 100;

/** Accepted original MIME types (photos only at MVP). */
export const ACCEPTED_IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'image/gif',
  'image/avif',
] as const;
export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIME)[number];
