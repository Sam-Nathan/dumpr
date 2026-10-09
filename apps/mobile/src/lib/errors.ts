/**
 * Error codes -> friendly copy. Pure module (no React Native imports) so it is unit-tested.
 *
 * Rules (docs/blueprint/flows.md flow 12): never blame the user, say what happened, keep their data,
 * name the person when a person did it, always leave a way out.
 */

/** Codes raised by Postgres RPCs (`raise exception using errcode='P0001', message='<code>'`). */
export const RPC_ERROR_CODES = [
  'not_authenticated',
  'guest_not_allowed',
  'not_a_member',
  'not_admin',
  'invite_not_found',
  'invite_expired',
  'invite_revoked',
  'invite_full',
  'guests_not_allowed',
  'uploads_disabled',
  'downloads_disabled',
  'already_member',
  'blocked',
  'last_host',
  'invalid_input',
  'handle_taken',
  'crew_deleted',
] as const;

/** Codes returned by Edge Functions (`{ error: { code } }`) in addition to the RPC codes. */
export const FUNCTION_ERROR_CODES = [
  'storage_full',
  'storage_not_configured',
  'rate_limited',
  'payload_too_large',
  'invalid_json',
  'method_not_allowed',
  'not_found',
  'forbidden',
  'internal',
] as const;

/** Client-side codes (network, auth provider, cancelled flows). */
export const CLIENT_ERROR_CODES = [
  'network',
  'timeout',
  'cancelled',
  'otp_invalid',
  'otp_expired',
  'sms_failed',
  'auth_failed',
  'phone_invalid',
  'unknown',
] as const;

export type ErrorCode =
  | (typeof RPC_ERROR_CODES)[number]
  | (typeof FUNCTION_ERROR_CODES)[number]
  | (typeof CLIENT_ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode | (string & {});
  readonly status?: number;
  readonly details?: unknown;

  constructor(code: string, message?: string, opts?: { status?: number; details?: unknown }) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.status = opts?.status;
    this.details = opts?.details;
  }
}

export interface ErrorCopy {
  /** Short headline, fits an EdgeState title. */
  title: string;
  /** One sentence. */
  message: string;
}

const COPY: Record<ErrorCode, ErrorCopy> = {
  // --- RPC codes ---
  not_authenticated: {
    title: 'Please sign in again',
    message: 'Your session ended on our side. Sign in to carry on where you left off.',
  },
  guest_not_allowed: {
    title: 'That needs an account',
    message: 'Guests can view and add photos. Sign up with your number to do this.',
  },
  not_a_member: {
    title: "You're not in this one",
    message: 'Ask someone inside for an invite and it will show up here.',
  },
  not_admin: {
    title: 'Only hosts can do that',
    message: 'Ask a host of this Crew or Roll to make the change.',
  },
  invite_not_found: {
    title: "We can't find that link",
    message: 'It may have been copied incompletely. Ask for it to be sent again.',
  },
  invite_expired: {
    title: 'This invite link has expired',
    message: 'Links last 7 days unless the host changes it.',
  },
  invite_revoked: {
    title: 'This invite link was turned off',
    message: 'The host switched it off. They can send you a fresh one.',
  },
  invite_full: {
    title: 'This link is full',
    message: 'It reached its limit of people. The host can make a new one.',
  },
  guests_not_allowed: {
    title: 'This Roll needs an account',
    message: 'The host only lets Dumpr members in. Sign up with your number to join.',
  },
  uploads_disabled: {
    title: 'Uploads are closed here',
    message: 'The host paused adding photos to this Roll. Your photos are safe on your phone.',
  },
  downloads_disabled: {
    title: 'Downloads are off for this Roll',
    message: 'The host turned them off. You can still save photos you added yourself.',
  },
  already_member: {
    title: "You're already in",
    message: 'Taking you there now.',
  },
  blocked: {
    title: "That didn't go through",
    message: "We couldn't complete this one. Nothing on your side needs fixing.",
  },
  last_host: {
    title: 'Make someone else host first',
    message: 'This Crew needs at least one host. Pick a new host, then try again.',
  },
  invalid_input: {
    title: "That didn't look right to us",
    message: 'Check the details and try again.',
  },
  handle_taken: {
    title: 'Someone already has that username',
    message: 'Pick one of the suggestions, or try another.',
  },
  crew_deleted: {
    title: 'This Crew was deleted',
    message: 'Members have 30 days to download the photos they can see.',
  },
  // --- Function codes ---
  storage_full: {
    title: 'Your storage is full',
    message: 'Uploads wait safely on your phone. Free up space or get more to carry on.',
  },
  storage_not_configured: {
    title: 'Uploads are paused',
    message: "We're setting up storage. Your photos stay on your phone and will upload soon.",
  },
  rate_limited: {
    title: 'Too many tries, quick breather',
    message: 'Wait a moment, then try again.',
  },
  payload_too_large: {
    title: 'That file is too big for us',
    message: 'It is over our size limit. Try a smaller version.',
  },
  invalid_json: {
    title: 'Something went wrong on our side',
    message: 'Try again in a moment.',
  },
  method_not_allowed: {
    title: 'Something went wrong on our side',
    message: 'Try again in a moment.',
  },
  not_found: {
    title: "We can't find that",
    message: 'It may have been removed.',
  },
  forbidden: {
    title: "You can't open this one",
    message: 'Ask someone inside to invite you.',
  },
  internal: {
    title: 'Something went wrong on our side',
    message: 'We have noted it. Try again in a moment.',
  },
  // --- Client codes ---
  network: {
    title: "Can't reach Dumpr",
    message: 'Check your connection. Anything you added is saved and will sync.',
  },
  timeout: {
    title: 'That is taking longer than usual',
    message: 'Your connection may be slow. Try again.',
  },
  cancelled: { title: 'Cancelled', message: 'No changes were made.' },
  otp_invalid: {
    title: "Code didn't match",
    message: 'Check the code in your message and try again.',
  },
  otp_expired: {
    title: 'That code has expired',
    message: 'Codes last 10 minutes. We can send a new one.',
  },
  sms_failed: {
    title: "We couldn't send the code",
    message: 'Your network may be blocking texts. Try again, or use Apple or Google.',
  },
  auth_failed: {
    title: "We couldn't sign you in",
    message: 'Try again, or pick another way to continue.',
  },
  phone_invalid: {
    title: "That number doesn't look complete",
    message: 'Check the digits and the country, then try again.',
  },
  unknown: {
    title: 'Something went wrong',
    message: 'Try again in a moment.',
  },
};

const FALLBACK = COPY.unknown;

/** Copy for a code. Unknown codes fall back to a neutral message (never expose raw codes). */
export function errorCopy(code: string | undefined | null): ErrorCopy {
  if (!code) return FALLBACK;
  return (COPY as Record<string, ErrorCopy | undefined>)[code] ?? FALLBACK;
}

/** True when the code is one we have copy for. */
export function isKnownErrorCode(code: string): code is ErrorCode {
  return code in COPY;
}

const SNAKE = /^[a-z][a-z0-9_]*$/;

interface PostgrestLike {
  code?: string;
  message?: string;
  details?: unknown;
  status?: number;
  name?: string;
}

/** Message fragments that mean "the request never reached the server". */
const NETWORK_HINTS = [
  'network request failed',
  'failed to fetch',
  'networkerror',
  'network error',
  'internet connection',
  'offline',
  'fetch failed',
  'econnreset',
  'enotfound',
  'load failed',
];

/** Map a Supabase Auth error `code` (or status) to one of our codes. */
export function authErrorCode(code: string | undefined, status?: number): ErrorCode {
  switch (code) {
    case 'otp_expired':
      return 'otp_invalid'; // Supabase reports wrong and expired codes identically
    case 'over_sms_send_rate_limit':
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rate_limited';
    case 'sms_send_failed':
    case 'phone_provider_disabled':
      return 'sms_failed';
    case 'validation_failed':
      return 'phone_invalid';
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'bad_jwt':
      return 'not_authenticated';
    default:
      if (status === 429) return 'rate_limited';
      return 'auth_failed';
  }
}

/**
 * Normalise anything thrown (AppError, PostgREST error, Supabase Auth error, fetch failure) into an
 * AppError whose `code` always has copy.
 */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = (e ?? {}) as PostgrestLike;
  const message = typeof err.message === 'string' ? err.message : '';

  // Postgres RPC exception: errcode P0001 and a snake_case code as the message.
  if (err.code === 'P0001' && SNAKE.test(message)) {
    return new AppError(message, message, { details: err.details });
  }
  // Supabase Auth errors carry a string `code` and numeric `status`.
  if (err.name === 'AuthApiError' || err.name === 'AuthRetryableFetchError') {
    if (err.name === 'AuthRetryableFetchError') return new AppError('network', message);
    return new AppError(authErrorCode(err.code, err.status), message, { status: err.status });
  }
  if (err.code === 'PGRST301' || err.code === 'PGRST303') {
    return new AppError('not_authenticated', message);
  }
  if (err.code === '42501') return new AppError('forbidden', message);
  if (err.status === 429) return new AppError('rate_limited', message, { status: 429 });
  if (err.name === 'AbortError') return new AppError('timeout', message);
  const lower = message.toLowerCase();
  if (NETWORK_HINTS.some((h) => lower.includes(h))) return new AppError('network', message);
  if (typeof err.code === 'string' && isKnownErrorCode(err.code)) {
    return new AppError(err.code, message);
  }
  return new AppError('unknown', message || undefined);
}

/** Friendly one-liner for toasts / inline text. */
export function friendlyMessage(e: unknown): string {
  return errorCopy(toAppError(e).code).message;
}

/** True for failures that are worth retrying automatically (connectivity / server hiccup). */
export function isRetryable(e: unknown): boolean {
  const code = toAppError(e).code;
  return code === 'network' || code === 'timeout' || code === 'internal';
}

/**
 * Parse the Edge Function error envelope `{ error: { code, message, details? } }`.
 * Returns null when the body is not an envelope.
 */
export function parseFunctionError(body: unknown, status?: number): AppError | null {
  if (!body || typeof body !== 'object') return null;
  const env = (body as { error?: unknown }).error;
  if (!env || typeof env !== 'object') return null;
  const { code, message, details } = env as { code?: unknown; message?: unknown; details?: unknown };
  if (typeof code !== 'string' || !code) return null;
  return new AppError(code, typeof message === 'string' ? message : code, { status, details });
}
