import { assertEquals } from 'jsr:@std/assert@1';
import type { UploadInitRequest } from '../../../packages/core/src/upload/index.ts';
import {
  canReuseMultipart,
  classifyDuplicate,
  classifyExisting,
  type ExistingPhoto,
  planOriginal,
  STALE_PENDING_MS,
  uniqueViolation,
  urlsExpireAt,
} from './logic.ts';

const MiB = 1024 * 1024;
const U = 'user-1';
const req: UploadInitRequest = {
  photo_id: 'p1',
  roll_id: 'r1',
  content_hash: 'md5:0123456789abcdef0123456789abcdef',
  mime: 'image/jpeg',
  bytes: 1000,
  width: 1,
  height: 1,
  display_bytes: 10,
  thumb_bytes: 5,
};
const photo = (patch: Partial<ExistingPhoto> = {}): ExistingPhoto => ({
  id: 'p1',
  uploader_id: U,
  roll_id: 'r1',
  crew_id: 'c1',
  status: 'pending',
  content_hash: req.content_hash,
  bytes: 1000,
  mime: 'image/jpeg',
  original_key: 'o/c1/r1/p1',
  display_key: 'd/c1/r1/p1.jpg',
  thumb_key: 't/c1/r1/p1.jpg',
  created_at: new Date(0).toISOString(),
  ...patch,
});

Deno.test('own pending photo resumes', () => {
  assertEquals(classifyExisting(photo(), req, U), { kind: 'resume' });
});

Deno.test("another user's photo id is a conflict", () => {
  assertEquals(classifyExisting(photo({ uploader_id: 'someone' }), req, U), { kind: 'conflict', code: 'conflict' });
});

Deno.test('same id used for different bytes / roll is a conflict', () => {
  assertEquals(classifyExisting(photo({ roll_id: 'r2' }), req, U).kind, 'conflict');
  assertEquals(classifyExisting(photo({ bytes: 5 }), req, U).kind, 'conflict');
  assertEquals(classifyExisting(photo({ content_hash: 'md5:ffffffffffffffffffffffffffffffff' }), req, U).kind, 'conflict');
});

Deno.test('completed and removed photos', () => {
  assertEquals(classifyExisting(photo({ status: 'ready' }), req, U), { kind: 'complete' });
  assertEquals(classifyExisting(photo({ status: 'review' }), req, U), { kind: 'complete' });
  assertEquals(classifyExisting(photo({ status: 'removed' }), req, U), { kind: 'conflict', code: 'photo_removed' });
});

Deno.test('duplicates: ready/review are duplicates, stale pending rows are replaced', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const fresh = new Date(now - 1000).toISOString();
  const old = new Date(now - STALE_PENDING_MS - 1).toISOString();
  assertEquals(classifyDuplicate({ id: 'x', uploader_id: 'o', status: 'ready', created_at: old }, U, now), 'duplicate');
  assertEquals(classifyDuplicate({ id: 'x', uploader_id: U, status: 'review', created_at: old }, U, now), 'duplicate');
  assertEquals(classifyDuplicate({ id: 'x', uploader_id: 'o', status: 'pending', created_at: fresh }, U, now), 'duplicate');
  assertEquals(classifyDuplicate({ id: 'x', uploader_id: 'o', status: 'pending', created_at: old }, U, now), 'replace_stale');
  assertEquals(classifyDuplicate({ id: 'x', uploader_id: U, status: 'pending', created_at: fresh }, U, now), 'replace_stale');
});

Deno.test('planOriginal: put, new multipart, reuse of an existing one', () => {
  assertEquals(planOriginal(10 * MiB, 100, null), { mode: 'put' });
  assertEquals(planOriginal(20 * MiB, 100, null), { mode: 'multipart', partSize: 8 * MiB, count: 3 });
  const mu = { multipart_upload_id: 'U1', part_size: 10 * MiB, parts: 2 };
  const plan = planOriginal(20 * MiB, 100, mu);
  assertEquals(plan, { mode: 'multipart', partSize: 10 * MiB, count: 2 });
  assertEquals(canReuseMultipart(mu, plan), true);
  // stored geometry that no longer fits → new plan, not reusable
  const bad = { multipart_upload_id: 'U1', part_size: 8 * MiB, parts: 2 };
  const plan2 = planOriginal(20 * MiB, 100, bad);
  assertEquals(plan2, { mode: 'multipart', partSize: 8 * MiB, count: 3 });
  assertEquals(canReuseMultipart(bad, plan2), false);
  assertEquals(canReuseMultipart(null, plan2), false);
  assertEquals(canReuseMultipart(mu, { mode: 'put' }), false);
});

Deno.test('urlsExpireAt', () => {
  const r = urlsExpireAt(0, 'multipart');
  assertEquals(r.expiresAt, new Date(3600_000).toISOString());
  assertEquals(r.multipartExpiresAt, new Date(6 * 3600_000).toISOString());
});

Deno.test('uniqueViolation', () => {
  assertEquals(uniqueViolation(null), null);
  assertEquals(uniqueViolation({ code: '42501' }), null);
  assertEquals(uniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "photos_pkey"' }), 'pkey');
  assertEquals(
    uniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "photos_roll_content_hash_key"' }),
    'hash',
  );
});
