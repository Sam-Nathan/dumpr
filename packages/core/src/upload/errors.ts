// Error classification for the upload queue: which failures retry by themselves (backoff),
// which stop the item until a person acts (blocked), and which need a manual retry (fatal).

/** Codes that stop an item until the situation changes; shown with a reason, never auto-retried. */
export const BLOCKED_CODES = [
  'storage_full',
  'uploads_disabled',
  'not_a_member',
  'guest_not_allowed',
  'guests_not_allowed',
  'guest_limit_reached',
  'storage_not_configured',
  'payload_too_large',
  'file_too_large',
  'unsupported_type',
  'heic_unsupported',
  'not_found',
  'crew_deleted',
] as const;
export type BlockedCode = (typeof BLOCKED_CODES)[number];

/** Codes that will not succeed on an automatic retry but may after a manual one. */
export const FATAL_CODES = [
  'invalid_input',
  'invalid_json',
  'conflict',
  'photo_removed',
  'file_missing',
  'prepare_failed',
  'method_not_allowed',
] as const;
export type FatalCode = (typeof FATAL_CODES)[number];

/**
 * Everything else is retryable with backoff: network, timeout, internal, rate_limited,
 * not_authenticated (session refresh), upload_incomplete, url_expired, put_failed, unknown, …
 */
export type ErrorDisposition =
  | { kind: 'blocked'; code: BlockedCode }
  | { kind: 'retryable'; code: string }
  | { kind: 'fatal'; code: string };

const blockedSet: ReadonlySet<string> = new Set(BLOCKED_CODES);
const fatalSet: ReadonlySet<string> = new Set(FATAL_CODES);

export function isBlockedCode(code: string): code is BlockedCode {
  return blockedSet.has(code);
}

/** Maps a server / client error code to what the queue should do with the item. */
export function errorToState(code: string | null | undefined): ErrorDisposition {
  const c = (code ?? '').trim() || 'unknown';
  if (blockedSet.has(c)) return { kind: 'blocked', code: c as BlockedCode };
  if (fatalSet.has(c)) return { kind: 'fatal', code: c };
  return { kind: 'retryable', code: c };
}

/** Codes that mean "the device lost connectivity", which pause rather than burn an attempt. */
export const NETWORK_CODES: ReadonlySet<string> = new Set(['network', 'timeout', 'offline']);

/** Error thrown by the upload pipeline and its IO adapters. */
export class UploadError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly details: unknown;
  constructor(code: string, opts: { status?: number; details?: unknown; message?: string } = {}) {
    super(opts.message ?? code);
    this.name = 'UploadError';
    this.code = code;
    this.status = opts.status;
    this.details = opts.details;
  }
}

/** Best-effort conversion of anything thrown into an UploadError. */
export function toUploadError(e: unknown): UploadError {
  if (e instanceof UploadError) return e;
  if (e && typeof e === 'object') {
    const o = e as { name?: unknown; code?: unknown; message?: unknown };
    if (o.name === 'AbortError') return new UploadError('cancelled');
    if (typeof o.code === 'string' && /^[a-z_]+$/.test(o.code)) return new UploadError(o.code);
    if (
      o.name === 'TypeError' ||
      /network|fetch|timed? ?out|offline|connection/i.test(String(o.message ?? ''))
    ) {
      return new UploadError('network', { message: String(o.message ?? 'network') });
    }
  }
  return new UploadError('unknown', { message: e instanceof Error ? e.message : String(e) });
}

/**
 * Parses an Edge Function error response (`{ error: { code, message, details } }`).
 * Falls back to a status-derived code.
 */
export function errorFromResponse(status: number, body: unknown): UploadError {
  const env = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)
    ?.error;
  if (env && typeof env.code === 'string') {
    return new UploadError(env.code, {
      status,
      details: env.details,
      message: typeof env.message === 'string' ? env.message : env.code,
    });
  }
  const code =
    status === 401
      ? 'not_authenticated'
      : status === 413
        ? 'payload_too_large'
        : status === 429
          ? 'rate_limited'
          : status >= 500
            ? 'internal'
            : 'unknown';
  return new UploadError(code, { status });
}
