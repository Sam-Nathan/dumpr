import { assert, assertEquals, assertNotEquals, assertThrows } from 'jsr:@std/assert@1';
import { avatarKeyOwner, createR2, isAvatarKeyOf, mediaKeys } from './r2.ts';

const r2 = createR2({
  accountId: 'acct',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret',
  bucket: 'bucket',
  endpoint: 'https://acct.r2.cloudflarestorage.com',
});
const signedHeaders = (url: string) => new URL(url).searchParams.get('X-Amz-SignedHeaders')?.split(';') ?? [];
const sig = (url: string) => new URL(url).searchParams.get('X-Amz-Signature');
const KEY = mediaKeys.display('c', 'r', 'p');

Deno.test('presigned PUT signs content-type and content-length', async () => {
  const url = await r2.presignPut(KEY, { contentType: 'image/jpeg', contentLength: 1234 });
  assertEquals(signedHeaders(url), ['content-length', 'content-type', 'host']);
});

Deno.test('the signature binds the length and the type', async () => {
  const base = await r2.presignPut(KEY, { contentType: 'image/jpeg', contentLength: 1234 });
  const otherLen = await r2.presignPut(KEY, { contentType: 'image/jpeg', contentLength: 1235 });
  const otherType = await r2.presignPut(KEY, { contentType: 'image/png', contentLength: 1234 });
  // the date is part of the signature: compare within one second by re-signing with identical inputs
  const again = await r2.presignPut(KEY, { contentType: 'image/jpeg', contentLength: 1234 });
  if (new URL(base).searchParams.get('X-Amz-Date') === new URL(again).searchParams.get('X-Amz-Date')) {
    assertEquals(sig(base), sig(again));
    if (new URL(otherLen).searchParams.get('X-Amz-Date') === new URL(base).searchParams.get('X-Amz-Date')) {
      assertNotEquals(sig(base), sig(otherLen));
      assertNotEquals(sig(base), sig(otherType));
    }
  }
});

Deno.test('presigned multipart part signs content-length', async () => {
  const url = await r2.presignPart('o/c/r/p', 'UPLOAD1', 2, 8 * 1024 * 1024);
  assertEquals(signedHeaders(url), ['content-length', 'host']);
  const u = new URL(url);
  assertEquals(u.searchParams.get('partNumber'), '2');
  assertEquals(u.searchParams.get('uploadId'), 'UPLOAD1');
});

Deno.test('GET URLs stay host-only', async () => {
  assertEquals(signedHeaders(await r2.presignGet(KEY)), ['host']);
});

Deno.test('GET URLs signed at the same instant are byte-identical (cache-stable) and carry the pinned date', async () => {
  const at = new Date(Date.UTC(2026, 9, 9, 18, 0, 0));
  const opts = { expiresIn: 25200, signedAt: at, cacheControl: 'private, max-age=21600' };
  const a = await r2.presignGet(KEY, opts);
  const b = await r2.presignGet(KEY, opts);
  assertEquals(a, b);
  const u = new URL(a);
  assertEquals(u.searchParams.get('X-Amz-Date'), '20261009T180000Z');
  assertEquals(u.searchParams.get('X-Amz-Expires'), '25200');
  assertEquals(u.searchParams.get('response-cache-control'), 'private, max-age=21600');
  assertEquals(signedHeaders(a), ['host']);
  // the next hour signs differently; so does a different cache policy (it is part of the signature)
  const next = await r2.presignGet(KEY, { ...opts, signedAt: new Date(at.getTime() + 3_600_000) });
  assertNotEquals(sig(a), sig(next));
  assertNotEquals(sig(a), sig(await r2.presignGet(KEY, { ...opts, cacheControl: 'public, max-age=1' })));
  assertNotEquals(a, await r2.presignGet(KEY, { expiresIn: 25200, signedAt: at }));
});

Deno.test('GET URL with a download name keeps both response overrides', async () => {
  const u = new URL(await r2.presignGet(KEY, { downloadName: 'a"b.jpg', cacheControl: 'private, max-age=1', signedAt: new Date(0) }));
  assertEquals(u.searchParams.get('response-content-disposition'), 'attachment; filename="ab.jpg"');
  assertEquals(u.searchParams.get('response-cache-control'), 'private, max-age=1');
});

Deno.test('a content length must be a positive integer', async () => {
  for (const bad of [0, -1, 1.5, NaN]) {
    assertThrows(() => {
      // the guard throws synchronously, before any signing
      void r2.presignPut(KEY, { contentType: 'image/jpeg', contentLength: bad });
    }, RangeError);
  }
  assert(true);
});

Deno.test('avatar keys: owner extraction and strict shape', () => {
  const U = '3f0c1d2e-4a5b-4c6d-8e7f-0123456789ab';
  const F = '9f0c1d2e-4a5b-4c6d-8e7f-0123456789ab';
  assertEquals(mediaKeys.avatar(U, F), `a/${U}/${F}.jpg`);
  assertEquals(avatarKeyOwner(mediaKeys.avatar(U, F)), U);
  assertEquals(avatarKeyOwner(`a/${U.toUpperCase()}/${F}.jpg`), U);
  for (const bad of [
    null, 42, '', `o/${U}/${F}`, `d/${U}/${F}.jpg`, `t/${U}/${F}.jpg`, `a/${U}/${F}.png`, `a/${U}/${F}.jpg/x`,
    `a/${U}/../${F}.jpg`, `a/${U}/x.jpg`, `a/u1/${F}.jpg`, `a//${F}.jpg`, `a/${U}/${F}.jpg\n`,
  ]) {
    assertEquals(avatarKeyOwner(bad), null, String(bad));
  }
  assert(isAvatarKeyOf(U, mediaKeys.avatar(U, F)));
  assert(isAvatarKeyOf(U.toUpperCase(), mediaKeys.avatar(U, F)));
  assert(!isAvatarKeyOf('11111111-1111-4111-8111-111111111111', mediaKeys.avatar(U, F)), "another user's avatar");
  assert(!isAvatarKeyOf(U, `o/c/r/${F}`));
});
