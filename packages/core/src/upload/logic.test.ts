import { describe, expect, it } from 'vitest';
import { nextRetryAt, retryDelayMs } from './backoff.ts';
import { DEFAULT_PART_SIZE, MAX_AUTO_ATTEMPTS, MiB, SINGLE_PUT_MAX_BYTES } from './constants.ts';
import { UploadError, errorFromResponse, errorToState, toUploadError } from './errors.ts';
import { missingParts, partRanges, planParts } from './parts.ts';
import { summarizeUploads } from './summary.ts';
import {
  contentHashFromMd5Hex,
  decideUploadAccess,
  md5HexFromContentHash,
  normalizeEtag,
  parseUploadContext,
  partsAreComplete,
  validateCompleteRequest,
  validateInitRequest,
} from './validate.ts';
import type { UploadContext } from './types.ts';

describe('backoff', () => {
  it('doubles from 5 s, capped at 15 min', () => {
    expect(retryDelayMs(1, 0.5)).toBe(5_000);
    expect(retryDelayMs(2, 0.5)).toBe(10_000);
    expect(retryDelayMs(3, 0.5)).toBe(20_000);
    expect(retryDelayMs(7, 0.5)).toBe(320_000);
    expect(retryDelayMs(9, 0.5)).toBe(900_000);
    expect(retryDelayMs(50, 0.5)).toBe(900_000);
    expect(retryDelayMs(10_000, 0.5)).toBe(900_000);
  });

  it('applies ±20 % jitter', () => {
    expect(retryDelayMs(1, 0)).toBe(4_000);
    expect(retryDelayMs(1, 1)).toBe(6_000);
    expect(retryDelayMs(20, 0)).toBe(720_000);
    expect(retryDelayMs(20, 0.999999)).toBeLessThanOrEqual(1_080_000);
    for (let i = 0; i < 200; i++) {
      const d = retryDelayMs(3);
      expect(d).toBeGreaterThanOrEqual(16_000);
      expect(d).toBeLessThanOrEqual(24_000);
    }
  });

  it('treats attempt 0 like the first failure and clamps rand', () => {
    expect(retryDelayMs(0, 0.5)).toBe(5_000);
    expect(retryDelayMs(1, -3)).toBe(4_000);
    expect(retryDelayMs(1, 7)).toBe(6_000);
  });

  it('stops after the last automatic attempt', () => {
    expect(nextRetryAt(1, 1000, 0.5)).toBe(6000);
    expect(nextRetryAt(MAX_AUTO_ATTEMPTS - 1, 0, 0.5)).not.toBeNull();
    expect(nextRetryAt(MAX_AUTO_ATTEMPTS, 0, 0.5)).toBeNull();
    expect(nextRetryAt(MAX_AUTO_ATTEMPTS + 3, 0, 0.5)).toBeNull();
  });
});

describe('planParts', () => {
  it('single PUT up to 16 MiB', () => {
    expect(planParts(1)).toEqual({ mode: 'put', bytes: 1 });
    expect(planParts(SINGLE_PUT_MAX_BYTES)).toEqual({ mode: 'put', bytes: SINGLE_PUT_MAX_BYTES });
  });

  it('8 MiB parts above 16 MiB', () => {
    expect(planParts(SINGLE_PUT_MAX_BYTES + 1)).toEqual({
      mode: 'multipart',
      bytes: SINGLE_PUT_MAX_BYTES + 1,
      partSize: DEFAULT_PART_SIZE,
      count: 3,
    });
    expect(planParts(50 * MiB)).toMatchObject({ partSize: 8 * MiB, count: 7 });
    expect(planParts(48 * MiB)).toMatchObject({ partSize: 8 * MiB, count: 6 });
  });

  it('grows the part size to stay within maxParts', () => {
    const plan = planParts(2000 * MiB, { maxParts: 100 });
    expect(plan).toEqual({ mode: 'multipart', bytes: 2000 * MiB, partSize: 20 * MiB, count: 100 });
    const odd = planParts(1001 * MiB, { maxParts: 100 });
    expect(odd.mode).toBe('multipart');
    if (odd.mode === 'multipart') {
      expect(odd.count).toBeLessThanOrEqual(100);
      expect(odd.partSize % MiB).toBe(0);
    }
    expect(planParts(40 * MiB, { maxParts: 2 })).toMatchObject({ partSize: 20 * MiB, count: 2 });
  });

  it('rejects non-positive sizes', () => {
    expect(() => planParts(0)).toThrow(RangeError);
    expect(() => planParts(-1)).toThrow(RangeError);
    expect(() => planParts(1.5)).toThrow(RangeError);
  });

  it('partRanges covers every byte exactly once', () => {
    const bytes = 20 * MiB + 123;
    const ranges = partRanges(bytes, 8 * MiB);
    expect(ranges.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(ranges[0]).toEqual({ n: 1, start: 0, end: 8 * MiB });
    expect(ranges[2]).toEqual({ n: 3, start: 16 * MiB, end: bytes });
    expect(ranges.reduce((s, r) => s + (r.end - r.start), 0)).toBe(bytes);
    expect(partRanges(16 * MiB, 8 * MiB)).toHaveLength(2);
    expect(() => partRanges(10, 0)).toThrow(RangeError);
  });

  it('missingParts', () => {
    expect(missingParts(4, [{ n: 2 }, { n: 4 }])).toEqual([1, 3]);
    expect(missingParts(2, [{ n: 1 }, { n: 2 }])).toEqual([]);
  });
});

describe('errorToState', () => {
  it('blocks on permission / quota / config codes', () => {
    for (const code of [
      'storage_full',
      'uploads_disabled',
      'not_a_member',
      'guest_not_allowed',
      'guests_not_allowed',
      'storage_not_configured',
      'payload_too_large',
      'heic_unsupported',
      'guest_limit_reached',
    ]) {
      expect(errorToState(code)).toEqual({ kind: 'blocked', code });
    }
  });

  it('fatal codes need a manual retry', () => {
    expect(errorToState('invalid_input')).toEqual({ kind: 'fatal', code: 'invalid_input' });
    expect(errorToState('conflict').kind).toBe('fatal');
    expect(errorToState('file_missing').kind).toBe('fatal');
  });

  it('everything else retries', () => {
    for (const code of [
      'network',
      'timeout',
      'internal',
      'upload_incomplete',
      'url_expired',
      'not_authenticated',
      'whatever',
    ]) {
      expect(errorToState(code)).toEqual({ kind: 'retryable', code });
    }
    expect(errorToState(null)).toEqual({ kind: 'retryable', code: 'unknown' });
    expect(errorToState('  ')).toEqual({ kind: 'retryable', code: 'unknown' });
  });

  it('errorFromResponse reads the envelope or falls back on status', () => {
    const e = errorFromResponse(422, {
      error: { code: 'upload_incomplete', message: 'm', details: { missing: ['thumb'] } },
    });
    expect(e.code).toBe('upload_incomplete');
    expect(e.status).toBe(422);
    expect(e.details).toEqual({ missing: ['thumb'] });
    expect(errorFromResponse(401, null).code).toBe('not_authenticated');
    expect(errorFromResponse(413, 'x').code).toBe('payload_too_large');
    expect(errorFromResponse(429, {}).code).toBe('rate_limited');
    expect(errorFromResponse(502, {}).code).toBe('internal');
    expect(errorFromResponse(418, {}).code).toBe('unknown');
  });

  it('toUploadError normalises thrown values', () => {
    const u = new UploadError('storage_full');
    expect(toUploadError(u)).toBe(u);
    expect(toUploadError(new TypeError('Network request failed')).code).toBe('network');
    expect(toUploadError({ name: 'AbortError' }).code).toBe('cancelled');
    expect(toUploadError({ code: 'storage_full' }).code).toBe('storage_full');
    expect(toUploadError(new Error('boom')).code).toBe('unknown');
    expect(toUploadError('x').code).toBe('unknown');
  });
});

const PHOTO = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b';
const ROLL = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const validInit = {
  photo_id: PHOTO,
  roll_id: ROLL,
  content_hash: 'md5:0123456789abcdef0123456789abcdef',
  mime: 'image/jpeg',
  bytes: 4_000_000,
  width: 4032,
  height: 3024,
  taken_at: '2026-03-12T18:20:00.000Z',
  chapter_id: null,
  caption: '  sunset  ',
  display_bytes: 600_000,
  thumb_bytes: 40_000,
};

describe('validateInitRequest', () => {
  it('accepts a valid body and normalises it', () => {
    const r = validateInitRequest({
      ...validInit,
      mime: 'IMAGE/JPEG',
      photo_id: PHOTO.toUpperCase(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mime).toBe('image/jpeg');
      expect(r.value.photo_id).toBe(PHOTO);
      expect(r.value.caption).toBe('sunset');
      expect(r.value.chapter_id).toBeNull();
    }
  });

  it('optional fields may be missing', () => {
    const { taken_at: _t, chapter_id: _c, caption: _cap, ...rest } = validInit;
    const r = validateInitRequest({ ...rest, width: null, height: undefined });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.taken_at).toBeNull();
      expect(r.value.width).toBeNull();
      expect(r.value.height).toBeNull();
      expect(r.value.caption).toBeNull();
    }
  });

  const bad: [string, Record<string, unknown>][] = [
    ['photo_id', { photo_id: 'nope' }],
    ['roll_id', { roll_id: 42 }],
    ['content_hash', { content_hash: '0123456789abcdef0123456789abcdef' }],
    ['content_hash', { content_hash: 'md5:XYZ' }],
    ['content_hash', { content_hash: 'md5:0123456789ABCDEF0123456789ABCDEF' }],
    ['mime', { mime: 'video/mp4' }],
    ['mime', { mime: 'application/octet-stream' }],
    ['bytes', { bytes: 0 }],
    ['bytes', { bytes: 1.5 }],
    ['bytes', { bytes: '100' }],
    ['width', { width: -1 }],
    ['height', { height: 200_000 }],
    ['taken_at', { taken_at: 'yesterday' }],
    ['taken_at', { taken_at: 12 }],
    ['chapter_id', { chapter_id: 'x' }],
    ['caption', { caption: 'x'.repeat(281) }],
    ['caption', { caption: 5 }],
    ['display_bytes', { display_bytes: 0 }],
    ['display_bytes', { display_bytes: 100 * MiB }],
    ['thumb_bytes', { thumb_bytes: undefined }],
  ];
  for (const [field, patch] of bad) {
    it(`rejects bad ${field} (${JSON.stringify(patch)})`, () => {
      expect(validateInitRequest({ ...validInit, ...patch })).toEqual({
        ok: false,
        code: 'invalid_input',
        field,
      });
    });
  }

  it('rejects non-objects', () => {
    expect(validateInitRequest(null)).toMatchObject({ ok: false, field: 'body' });
    expect(validateInitRequest([])).toMatchObject({ ok: false, field: 'body' });
    expect(validateInitRequest('x')).toMatchObject({ ok: false, field: 'body' });
  });

  it('counts caption length in code points', () => {
    expect(validateInitRequest({ ...validInit, caption: '😀'.repeat(280) }).ok).toBe(true);
  });
});

describe('validateCompleteRequest', () => {
  it('accepts parts, sorts and de-duplicates them', () => {
    const r = validateCompleteRequest({
      photo_id: PHOTO,
      parts: [
        { n: 2, etag: '"bbb"' },
        { n: 1, etag: 'aaa' },
        { n: 2, etag: '"ccc"' },
      ],
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    });
    expect(r).toEqual({
      ok: true,
      value: {
        photo_id: PHOTO,
        parts: [
          { n: 1, etag: 'aaa' },
          { n: 2, etag: '"ccc"' },
        ],
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      },
    });
  });

  it('accepts a bare photo id', () => {
    expect(validateCompleteRequest({ photo_id: PHOTO })).toEqual({
      ok: true,
      value: { photo_id: PHOTO },
    });
    expect(validateCompleteRequest({ photo_id: PHOTO, parts: null, blurhash: null })).toEqual({
      ok: true,
      value: { photo_id: PHOTO },
    });
  });

  it('rejects malformed input', () => {
    expect(validateCompleteRequest({ photo_id: 'x' })).toMatchObject({ field: 'photo_id' });
    expect(validateCompleteRequest({ photo_id: PHOTO, parts: 'x' })).toMatchObject({
      field: 'parts',
    });
    expect(
      validateCompleteRequest({ photo_id: PHOTO, parts: [{ n: 0, etag: 'a' }] }),
    ).toMatchObject({ field: 'parts' });
    expect(validateCompleteRequest({ photo_id: PHOTO, parts: [{ n: 1, etag: '' }] })).toMatchObject(
      { field: 'parts' },
    );
    expect(
      validateCompleteRequest({ photo_id: PHOTO, parts: [{ n: 1, etag: '<x>' }] }),
    ).toMatchObject({ field: 'parts' });
    expect(validateCompleteRequest({ photo_id: PHOTO, blurhash: 'short' })).toMatchObject({
      field: 'blurhash',
    });
    expect(validateCompleteRequest({ photo_id: PHOTO, blurhash: 'L'.repeat(101) })).toMatchObject({
      field: 'blurhash',
    });
  });

  it('partsAreComplete', () => {
    expect(partsAreComplete([{ n: 1 }, { n: 2 }, { n: 3 }], 3)).toBe(true);
    expect(partsAreComplete([{ n: 1 }, { n: 3 }], 3)).toBe(false);
    expect(partsAreComplete([{ n: 1 }, { n: 1 }, { n: 2 }], 3)).toBe(false);
    expect(partsAreComplete([{ n: 0 }, { n: 1 }], 2)).toBe(false);
  });
});

describe('hash + etag helpers', () => {
  it('converts between hex and content hashes', () => {
    expect(contentHashFromMd5Hex('0123456789ABCDEF0123456789ABCDEF')).toBe(
      'md5:0123456789abcdef0123456789abcdef',
    );
    expect(() => contentHashFromMd5Hex('xyz')).toThrow(RangeError);
    expect(md5HexFromContentHash('md5:0123456789abcdef0123456789abcdef')).toBe(
      '0123456789abcdef0123456789abcdef',
    );
    expect(md5HexFromContentHash('sha1:abc')).toBeNull();
  });

  it('normalises ETags', () => {
    expect(normalizeEtag('"ABC"')).toBe('abc');
    expect(normalizeEtag('W/"abc"')).toBe('abc');
    expect(normalizeEtag(null)).toBe('');
  });
});

const ctx = (patch: Partial<UploadContext> = {}): UploadContext => ({
  can_upload: true,
  crew_id: 'c1',
  is_admin: false,
  is_guest: false,
  allow_uploads: true,
  guests_allowed: true,
  guest_uploads_review: false,
  guest_photo_count: 0,
  storage_used_bytes: 0,
  storage_limit_bytes: null,
  max_photo_bytes: 50 * MiB,
  max_upload_parts: 100,
  ...patch,
});

describe('decideUploadAccess', () => {
  it('allows members', () => {
    expect(decideUploadAccess(ctx(), { bytes: 10 })).toEqual({ ok: true, reviewFirst: false });
  });

  it('missing roll → 404', () => {
    expect(decideUploadAccess(null)).toEqual({ ok: false, status: 404, code: 'not_found' });
    expect(decideUploadAccess(ctx({ crew_id: null }))).toMatchObject({ code: 'not_found' });
  });

  it('explains why uploading is not allowed', () => {
    expect(
      decideUploadAccess(ctx({ can_upload: false, is_guest: true, guests_allowed: false })),
    ).toEqual({
      ok: false,
      status: 403,
      code: 'guests_not_allowed',
    });
    expect(decideUploadAccess(ctx({ can_upload: false, allow_uploads: false }))).toMatchObject({
      code: 'uploads_disabled',
    });
    expect(decideUploadAccess(ctx({ can_upload: false }))).toMatchObject({ code: 'not_a_member' });
    expect(
      decideUploadAccess(ctx({ can_upload: false, allow_uploads: false, is_admin: true })),
    ).toMatchObject({
      code: 'not_a_member',
    });
  });

  it('size and quota', () => {
    expect(decideUploadAccess(ctx(), { bytes: 50 * MiB + 1 })).toEqual({
      ok: false,
      status: 413,
      code: 'payload_too_large',
    });
    expect(
      decideUploadAccess(ctx({ storage_used_bytes: 90, storage_limit_bytes: 100 }), { bytes: 11 }),
    ).toEqual({
      ok: false,
      status: 413,
      code: 'storage_full',
    });
    expect(
      decideUploadAccess(ctx({ storage_used_bytes: 90, storage_limit_bytes: 100 }), { bytes: 10 })
        .ok,
    ).toBe(true);
    // size is not re-checked at complete (no bytes)
    expect(decideUploadAccess(ctx({ storage_used_bytes: 900, storage_limit_bytes: 100 })).ok).toBe(
      true,
    );
  });

  it('guest rules', () => {
    expect(
      decideUploadAccess(ctx({ is_guest: true, guest_uploads_review: true }), { bytes: 1 }),
    ).toEqual({
      ok: true,
      reviewFirst: true,
    });
    expect(decideUploadAccess(ctx({ guest_uploads_review: true }), { bytes: 1 })).toEqual({
      ok: true,
      reviewFirst: false,
    });
    expect(
      decideUploadAccess(ctx({ is_guest: true, guest_photo_count: 300 }), {
        bytes: 1,
        guestMaxPhotos: 300,
      }),
    ).toEqual({
      ok: false,
      status: 403,
      code: 'guest_limit_reached',
    });
    expect(
      decideUploadAccess(ctx({ is_guest: true, guest_photo_count: 299 }), {
        bytes: 1,
        guestMaxPhotos: 300,
      }).ok,
    ).toBe(true);
    expect(
      decideUploadAccess(
        ctx({ is_guest: true, guest_photo_count: 5, guest_max_photos_per_roll: 5 }),
        { bytes: 1 },
      ),
    ).toMatchObject({ code: 'guest_limit_reached' });
  });

  it('parseUploadContext coerces jsonb', () => {
    expect(parseUploadContext(null)).toBeNull();
    const c = parseUploadContext({
      can_upload: true,
      crew_id: 'c',
      storage_used_bytes: '1024',
      storage_limit_bytes: null,
      max_photo_bytes: 10,
    });
    expect(c).toMatchObject({
      can_upload: true,
      crew_id: 'c',
      storage_used_bytes: 1024,
      storage_limit_bytes: null,
      max_photo_bytes: 10,
      max_upload_parts: 100,
      allow_uploads: true,
      is_guest: false,
      guest_max_photos_per_roll: null,
    });
    expect(parseUploadContext({})!.max_photo_bytes).toBe(50 * MiB);
  });
});

describe('summarizeUploads', () => {
  it('is all caught up when empty', () => {
    const s = summarizeUploads([]);
    expect(s.total).toBe(0);
    expect(s.allDone).toBe(true);
    expect(s.fraction).toBe(0);
  });

  it('counts by state and bytes', () => {
    const s = summarizeUploads([
      { state: 'done', bytes: 100, progress: 0 },
      { state: 'duplicate', bytes: 50, progress: 0 },
      { state: 'uploading', bytes: 200, progress: 0.5 },
      { state: 'queued', bytes: 100, progress: 0 },
      { state: 'paused', bytes: 100, progress: 0 },
      { state: 'failed', bytes: 100, progress: 0 },
      { state: 'blocked', bytes: 100, progress: 0 },
      { state: 'cancelled', bytes: 999, progress: 0 },
    ]);
    expect(s.total).toBe(7);
    expect(s.totalBytes).toBe(750);
    expect(s.doneBytes).toBe(250);
    expect(s.uploaded).toBe(2);
    expect(s.active).toBe(1);
    expect(s.waiting).toBe(2);
    expect(s.failed).toBe(2);
    expect(s.counts.cancelled).toBe(1);
    expect(s.counts.uploading).toBe(1);
    expect(s.allDone).toBe(false);
    expect(s.fraction).toBeCloseTo(250 / 750);
  });

  it('allDone when everything is done or duplicate (cancelled ignored)', () => {
    const s = summarizeUploads([
      { state: 'done', bytes: 1, progress: 1 },
      { state: 'cancelled', bytes: 1, progress: 0 },
    ]);
    expect(s.allDone).toBe(true);
    expect(s.fraction).toBe(1);
  });

  it('ignores bad byte counts and clamps progress', () => {
    const s = summarizeUploads([
      { state: 'uploading', bytes: Number.NaN, progress: 0.5 },
      { state: 'uploading', bytes: 10, progress: 4 },
    ]);
    expect(s.totalBytes).toBe(10);
    expect(s.doneBytes).toBe(10);
  });
});
