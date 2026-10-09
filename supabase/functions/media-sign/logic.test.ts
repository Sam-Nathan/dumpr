import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { downloadName, extFor, isAvatarKey, keyFor, originalAllowed, parseSignRequest } from './logic.ts';

const ID = '3f0c1d2e-4a5b-4c6d-8e7f-0123456789ab';

Deno.test('parse items, dedupe, lowercase ids', () => {
  const r = parseSignRequest({
    items: [
      { photo_id: ID.toUpperCase(), variant: 'thumb' },
      { photo_id: ID, variant: 'thumb' },
      { photo_id: ID, variant: 'original' },
    ],
  });
  assertEquals(r.kind, 'items');
  if (r.kind === 'items') assertEquals(r.items.length, 2);
});

Deno.test('parse rejects bad input', () => {
  assertThrows(() => parseSignRequest({}));
  assertThrows(() => parseSignRequest({ items: [], avatar_keys: [] }));
  assertThrows(() => parseSignRequest({ items: [] }));
  assertThrows(() => parseSignRequest({ items: [{ photo_id: 'nope', variant: 'thumb' }] }));
  assertThrows(() => parseSignRequest({ items: [{ photo_id: ID, variant: 'huge' }] }));
  assertThrows(() => parseSignRequest({ items: Array.from({ length: 301 }, () => ({ photo_id: ID, variant: 'thumb' })) }));
  assertThrows(() => parseSignRequest({ avatar_keys: ['o/crew/roll/photo'] }));
  assertThrows(() => parseSignRequest({ avatar_keys: ['a/../o/x'] }));
  assertThrows(() => parseSignRequest({ avatar_keys: Array.from({ length: 101 }, (_, i) => `a/u/${i}.jpg`) }));
});

Deno.test('parse avatar keys', () => {
  const r = parseSignRequest({ avatar_keys: ['a/u1/x.jpg', 'a/u1/x.jpg', 'a/u2/y.jpg'] });
  assertEquals(r, { kind: 'avatars', keys: ['a/u1/x.jpg', 'a/u2/y.jpg'] });
  assertEquals(isAvatarKey('a/'), false);
  assertEquals(isAvatarKey('t/x'), false);
});

Deno.test('keyFor picks the variant key', () => {
  const p = { thumb_key: 't', display_key: 'd', original_key: 'o' };
  assertEquals([keyFor(p, 'thumb'), keyFor(p, 'display'), keyFor(p, 'original')], ['t', 'd', 'o']);
});

Deno.test('download name is ascii-safe and uses mime extension', () => {
  assertEquals(downloadName("Goa '26", ID, 'image/heic'), `dumpr-goa-26-${ID}.heic`);
  assertEquals(downloadName('बेटा "x"', ID, null), `dumpr-x-${ID}.jpg`);
  assertEquals(downloadName(null, ID, 'image/png'), `dumpr-roll-${ID}.png`);
  assertEquals(extFor('application/x-weird'), 'jpg');
});

Deno.test('original access rule', () => {
  assertEquals(originalAllowed({ isUploader: false, isAdmin: false, allowDownloads: true }), true);
  assertEquals(originalAllowed({ isUploader: false, isAdmin: false, allowDownloads: false }), false);
  assertEquals(originalAllowed({ isUploader: true, isAdmin: false, allowDownloads: false }), true);
  assertEquals(originalAllowed({ isUploader: false, isAdmin: true, allowDownloads: false }), true);
});
