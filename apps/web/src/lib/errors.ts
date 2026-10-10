/** Maps stable snake_case backend error codes (architecture §5/§8) to calm, non-blaming copy. */

const COPY: Record<string, string> = {
  not_authenticated: 'Please try that again in a moment.',
  guest_not_allowed: 'Guests can only join and add photos to a single Roll. Get the app for more.',
  guests_not_allowed: 'This Roll is members-only. Get the app to ask the host.',
  not_a_member: "You're not in this Roll yet. Open the invite link again to join.",
  not_admin: 'Only the host can do that.',
  invite_not_found: "We couldn't find this invite. Ask for a new link.",
  invite_expired: 'This invite link has expired. Ask the host for a new one.',
  invite_revoked: 'The host turned this invite link off. Ask them for a new one.',
  invite_full: 'This invite has reached its limit. Ask the host to add you.',
  uploads_disabled: 'The host has closed uploads for this Roll. You can still look around.',
  downloads_disabled: 'The host turned off saving photos for this Roll.',
  already_member: "You're already in this Roll.",
  blocked: "We couldn't add you to this Roll. Get the app to ask the host.",
  crew_deleted: 'This group was deleted by its host.',
  request_cooldown: 'You asked recently \u2014 the host will see your request. Try again tomorrow.',
  invalid_input: 'Something about that looks off. Check it and try again.',
  handle_taken: 'That one is taken.',
  storage_full: 'There is no room left for more photos right now.',
  storage_not_configured: 'Uploads are paused for a moment. Try again soon.',
  anonymous_provider_disabled: "Guest join isn't available right now. Get the app to join.",
  signup_disabled: "Guest join isn't available right now. Get the app to join.",
  over_request_rate_limit: 'Too many tries. Wait a minute and try again.',
  over_anonymous_sign_ins_limit: 'Lots of people are joining right now. Try again in a minute.',
  network: "We couldn't reach Dumpr. Check your connection and try again.",
};

export const DEFAULT_ERROR_COPY = 'Something went wrong. Please try again.';

/** Codes after which retrying with the same invite is pointless (show the get-the-app escape). */
const TERMINAL_CODES = new Set([
  'guests_not_allowed',
  'guest_not_allowed',
  'invite_not_found',
  'invite_expired',
  'invite_revoked',
  'invite_full',
  'blocked',
  'crew_deleted',
  'anonymous_provider_disabled',
  'signup_disabled',
]);

export function isTerminalCode(code: string | null | undefined): boolean {
  return !!code && TERMINAL_CODES.has(code);
}

const SNAKE = /^[a-z][a-z0-9_]{2,60}$/;

/**
 * Pulls a snake_case error code out of whatever the stack throws: Postgrest errors
 * (`{ message: 'invite_expired', code: 'P0001' }`), Auth errors (`{ code: 'anonymous_provider_disabled' }`),
 * edge-function bodies (`{ error: { code } }`) or plain strings. Fetch failures map to `network`.
 */
export function errorCodeOf(err: unknown): string | null {
  if (err == null) return null;
  if (typeof err === 'string') return SNAKE.test(err) ? err : null;
  if (err instanceof TypeError) return 'network';
  if (typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  const nested = e.error;
  if (nested && typeof nested === 'object') {
    const inner = errorCodeOf(nested);
    if (inner) return inner;
  }
  if (typeof e.message === 'string' && SNAKE.test(e.message)) return e.message;
  if (typeof e.code === 'string' && SNAKE.test(e.code) && !/^p\d{4}$/.test(e.code)) return e.code;
  if (typeof e.message === 'string' && /fetch|network|failed to load/i.test(e.message)) {
    return 'network';
  }
  return null;
}

/** User-facing copy for any thrown value or code. */
export function errorCopy(errOrCode: unknown): string {
  const code = typeof errOrCode === 'string' ? errOrCode : errorCodeOf(errOrCode);
  if (code && COPY[code]) return COPY[code];
  return DEFAULT_ERROR_COPY;
}

/** Short copy for a single failed / blocked upload tile. */
export function uploadErrorCopy(code: string | null | undefined, retryable = true): string {
  switch (code) {
    case 'uploads_disabled':
      return 'Uploads closed';
    case 'storage_full':
      return 'No room left';
    case 'storage_not_configured':
      return 'Uploads paused';
    case 'not_a_member':
      return 'Join to upload';
    case 'file_too_large':
    case 'too_large':
      return 'Too big';
    case 'heic_unsupported':
      return "This browser can't read HEIC";
    case 'unsupported_type':
    case 'unsupported_format':
      return 'Not supported';
    case 'no_network':
    case 'network':
      return 'Waiting for network';
    default:
      // A blocked tile has no retry action, so it must not promise one.
      return retryable ? 'Tap to retry' : "Couldn't add this one";
  }
}
