import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ERROR_COPY,
  errorCodeOf,
  errorCopy,
  isTerminalCode,
  uploadErrorCopy,
} from './errors';

describe('errorCodeOf', () => {
  it('reads postgrest message codes', () =>
    expect(errorCodeOf({ message: 'invite_expired', code: 'P0001' })).toBe('invite_expired'));
  it('reads auth error codes', () =>
    expect(
      errorCodeOf({
        message: 'Anonymous sign-ins are disabled',
        code: 'anonymous_provider_disabled',
      }),
    ).toBe('anonymous_provider_disabled'));
  it('reads edge function bodies', () =>
    expect(errorCodeOf({ error: { code: 'uploads_disabled', message: 'x' } })).toBe(
      'uploads_disabled',
    ));
  it('maps fetch failures to network', () =>
    expect(errorCodeOf(new TypeError('Failed to fetch'))).toBe('network'));
  it('ignores sqlstate and prose', () => {
    expect(errorCodeOf({ message: 'Something broke badly', code: 'P0001' })).toBeNull();
    expect(errorCodeOf(null)).toBeNull();
  });
  it('accepts plain strings', () => expect(errorCodeOf('invite_full')).toBe('invite_full'));
});

describe('errorCopy', () => {
  it('maps the join codes', () => {
    expect(errorCopy({ message: 'guests_not_allowed' })).toBe(
      'This Roll is members-only. Get the app to ask the host.',
    );
    expect(errorCopy('invite_expired')).toContain('expired');
    expect(errorCopy('invite_revoked')).toContain('turned this invite link off');
    expect(errorCopy('invite_full')).toContain('limit');
  });
  it('never blames the user and has a default', () => {
    expect(errorCopy(new Error('weird'))).toBe(DEFAULT_ERROR_COPY);
    expect(errorCopy('unknown_code_xyz')).toBe(DEFAULT_ERROR_COPY);
  });
});

describe('misc', () => {
  it('terminal codes', () => {
    expect(isTerminalCode('guests_not_allowed')).toBe(true);
    expect(isTerminalCode('network')).toBe(false);
    expect(isTerminalCode(null)).toBe(false);
  });
  it('upload tile copy', () => {
    expect(uploadErrorCopy('storage_full')).toBe('No room left');
    expect(uploadErrorCopy(undefined)).toBe('Tap to retry');
  });
  it('non-retryable tiles never say tap to retry', () => {
    expect(uploadErrorCopy('heic_unsupported', false)).not.toMatch(/retry/i);
    expect(uploadErrorCopy('unsupported_type', false)).toBe('Not supported');
    expect(uploadErrorCopy('something_else', false)).not.toMatch(/retry/i);
  });
  it('has copy for a join request made too soon', () => {
    expect(errorCopy('request_cooldown')).toContain('Try again tomorrow');
  });
});
