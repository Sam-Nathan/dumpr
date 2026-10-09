import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { downloadName, extFor, isAvatarKey, keyFor, originalAllowed, parseSignRequest, signableAvatarKeys } from './logic.ts';

const ID = '3f0c1d2e-4a5b-4c6d-8e7f-0123456789ab';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const AV1 = `a/${U1}/${ID}.jpg`;
const AV2 = `a/${U2}/${ID}.jpg`;

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
  assertThrows(() => parseSignRequest({ avatar_keys: Array.from({ length: 101 }, () => AV1) }));
  assertThrows(() => parseSignRequest({ avatar_keys: [`d/c/r/${ID}.jpg`] }));
  assertThrows(() => parseSignRequest({ avatar_keys: ['a/u1/x.jpg'] }));
});

Deno.test('parse avatar keys', () => {
  const r = parseSignRequest({ avatar_keys: [AV1, AV1, AV2] });
  assertEquals(r, { kind: 'avatars', keys: [AV1, AV2] });
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

Deno.test('F1: avatar keys are signed only under the owning profile id', () => {
  const stolenOriginal = 'o/c001/b2/e3';
  const rows = [
    { id: U1, avatar_key: AV1 }, // genuine
    { id: U2, avatar_key: AV1 }, // user 2 pointed at user 1's avatar
    { id: U2, avatar_key: stolenOriginal }, // user 2 pointed at an original
    { id: U1, avatar_key: null },
  ];
  assertEquals([...signableAvatarKeys(rows, [AV1, AV2, stolenOriginal])], [AV1]);
  assertEquals([...signableAvatarKeys([{ id: U2, avatar_key: AV2 }], [AV1])], []); // not requested
  assertEquals([...signableAvatarKeys([{ id: U2.toUpperCase(), avatar_key: AV2 }], [AV2])], [AV2]);
  assertEquals(isAvatarKey(stolenOriginal), false);
});
