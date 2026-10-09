import { assertEquals } from 'jsr:@std/assert@1';
import { CODE_RE, decoratePreview, type InvitePreview, shouldSignCover } from './logic.ts';

const sign = (k: string) => Promise.resolve(`https://r2.test/${k}?sig=1`);
const base: InvitePreview = {
  status: 'ok',
  kind: 'roll',
  roll: { name: "Goa '26", sealed: false },
  host: { display_name: 'Kabir', avatar_key: 'a/u1/x.jpg' },
  facepile: [{ display_name: 'Diya', avatar_key: null, ring_color: 'lime' }, { display_name: 'Meera', avatar_key: 'a/u2/y.jpg' }],
  cover_thumb_key: 't/c/r/p.jpg',
};

Deno.test('code regex', () => {
  assertEquals(CODE_RE.test('abcd234567'), true);
  assertEquals(CODE_RE.test('ab'), false);
  assertEquals(CODE_RE.test('abc/../x'), false);
});

Deno.test('signs cover and avatars, drops raw cover key', async () => {
  const out = await decoratePreview(base, sign) as Record<string, any>;
  assertEquals(out.cover_url, 'https://r2.test/t/c/r/p.jpg?sig=1');
  assertEquals('cover_thumb_key' in out, false);
  assertEquals(out.host.avatar_url, 'https://r2.test/a/u1/x.jpg?sig=1');
  assertEquals(out.facepile[0].avatar_url, null);
  assertEquals(out.facepile[1].avatar_url, 'https://r2.test/a/u2/y.jpg?sig=1');
});

Deno.test('sealed roll or non-ok status never gets a cover', async () => {
  const sealed = { ...base, roll: { sealed: true } };
  assertEquals(shouldSignCover(sealed), false);
  assertEquals(((await decoratePreview(sealed, sign)) as Record<string, unknown>).cover_url, null);
  const expired = await decoratePreview({ ...base, status: 'expired' }, sign) as Record<string, any>;
  assertEquals(expired.cover_url, null);
  assertEquals(expired.facepile.length, 2); // untouched, no avatar_url added
  assertEquals('avatar_url' in expired.facepile[0], false);
});

Deno.test('no signer (storage not configured) still serves the preview', async () => {
  const out = await decoratePreview(base, null) as Record<string, any>;
  assertEquals(out.cover_url, null);
  assertEquals(out.host.display_name, 'Kabir');
});

Deno.test('a failing signer degrades to null urls', async () => {
  const out = await decoratePreview(base, () => Promise.reject(new Error('x'))) as Record<string, any>;
  assertEquals(out.cover_url, null);
});
