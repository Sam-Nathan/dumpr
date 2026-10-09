import { describe, expect, it } from 'vitest';
import {
  AppError,
  CLIENT_ERROR_CODES,
  errorCopy,
  FUNCTION_ERROR_CODES,
  friendlyMessage,
  isRetryable,
  parseFunctionError,
  RPC_ERROR_CODES,
  toAppError,
} from './errors';

const ALL = [...RPC_ERROR_CODES, ...FUNCTION_ERROR_CODES, ...CLIENT_ERROR_CODES];

describe('errorCopy', () => {
  it('has specific copy for every documented code', () => {
    const fallback = errorCopy('definitely_unknown');
    for (const code of ALL) {
      const c = errorCopy(code);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.message.length).toBeGreaterThan(0);
      if (code !== 'unknown') expect(c).not.toBe(fallback);
    }
  });

  it('never blames the user', () => {
    const blaming = /\byou (did|made|entered|typed) (it|something|that)? ?wrong|your fault|invalid input|you failed|illegal/i;
    for (const code of ALL) {
      const c = errorCopy(code);
      expect(`${c.title} ${c.message}`).not.toMatch(blaming);
      expect(`${c.title} ${c.message}`).not.toMatch(/[a-z]+_[a-z]+/); // no raw codes in copy
    }
  });

  it('falls back for unknown / empty codes', () => {
    expect(errorCopy(undefined)).toEqual(errorCopy('unknown'));
    expect(errorCopy('nope')).toEqual(errorCopy('unknown'));
  });
});

describe('toAppError', () => {
  it('maps P0001 snake codes', () => {
    const e = toAppError({ code: 'P0001', message: 'invite_expired', details: null });
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe('invite_expired');
  });

  it('does not treat non-snake P0001 messages as codes', () => {
    expect(toAppError({ code: 'P0001', message: 'Something Broke' }).code).toBe('unknown');
  });

  it('maps network failures', () => {
    expect(toAppError(new TypeError('Network request failed')).code).toBe('network');
    expect(toAppError({ message: 'Failed to fetch' }).code).toBe('network');
  });

  it('maps aborts to timeout', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    expect(toAppError(e).code).toBe('timeout');
  });

  it('maps Supabase auth errors', () => {
    expect(toAppError({ name: 'AuthApiError', code: 'otp_expired', status: 403, message: 'x' }).code).toBe('otp_invalid');
    expect(toAppError({ name: 'AuthApiError', code: 'over_sms_send_rate_limit', status: 429, message: 'x' }).code).toBe('rate_limited');
    expect(toAppError({ name: 'AuthApiError', code: 'sms_send_failed', status: 500, message: 'x' }).code).toBe('sms_failed');
    expect(toAppError({ name: 'AuthApiError', code: 'whatever', status: 400, message: 'x' }).code).toBe('auth_failed');
    expect(toAppError({ name: 'AuthRetryableFetchError', message: 'x' }).code).toBe('network');
  });

  it('maps PostgREST auth / permission errors', () => {
    expect(toAppError({ code: 'PGRST301', message: 'JWT expired' }).code).toBe('not_authenticated');
    expect(toAppError({ code: '42501', message: 'denied' }).code).toBe('forbidden');
  });

  it('passes AppError through and handles junk', () => {
    const a = new AppError('storage_full');
    expect(toAppError(a)).toBe(a);
    expect(toAppError(null).code).toBe('unknown');
    expect(toAppError('boom').code).toBe('unknown');
  });

  it('friendlyMessage / isRetryable', () => {
    expect(friendlyMessage({ code: 'P0001', message: 'uploads_disabled' })).toBe(errorCopy('uploads_disabled').message);
    expect(isRetryable(new TypeError('Network request failed'))).toBe(true);
    expect(isRetryable({ code: 'P0001', message: 'not_admin' })).toBe(false);
  });
});

describe('parseFunctionError', () => {
  it('reads the { error: { code } } envelope', () => {
    const e = parseFunctionError({ error: { code: 'storage_full', message: 'Full' } }, 413);
    expect(e?.code).toBe('storage_full');
    expect(e?.status).toBe(413);
  });
  it('returns null for non-envelopes', () => {
    expect(parseFunctionError({ urls: {} })).toBeNull();
    expect(parseFunctionError(null)).toBeNull();
    expect(parseFunctionError({ error: 'x' })).toBeNull();
  });
});
