import { assertEquals } from 'jsr:@std/assert@1';
import {
  cacheControlFor,
  CODE_RE,
  decoratePreview,
  type InvitePreview,
  shouldSignCover,
  userAccessToken,
} from './logic.ts';

const sign = (k: string) => Promise.resolve(`https://r2.test/${k}?sig=1`);
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const F1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base: InvitePreview = {
  status: 'ok',
  kind: 'roll',
  roll: { name: "Goa '26", sealed: false },
  host: { display_name: 'Kabir', avatar_key: `a/${U1}/${F1}.jpg` },
  facepile: [{ display_name: 'Diya', avatar_key: null, ring_color: 'lime' }, { display_name: 'Meera', avatar_key: `a/${U2}/${F1}.jpg` }],
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
  assertEquals(out.host.avatar_url, `https://r2.test/a/${U1}/${F1}.jpg?sig=1`);
  assertEquals(out.facepile[0].avatar_url, null);
  assertEquals(out.facepile[1].avatar_url, `https://r2.test/a/${U2}/${F1}.jpg?sig=1`);
});

Deno.test('F1: a client-chosen avatar_key that is not an avatar key is never signed', async () => {
  const signed: string[] = [];
  const spy = (k: string) => {
    signed.push(k);
    return Promise.resolve(`https://r2.test/${k}`);
  };
  const evil: InvitePreview = {
    ...base,
    host: { display_name: 'Eve', avatar_key: 'o/c001/b2/e3' }, // an original
    facepile: [
      { display_name: 'A', avatar_key: 'd/c001/b2/e3.jpg' },
      { display_name: 'B', avatar_key: 't/c001/b2/e3.jpg' },
      { display_name: 'C', avatar_key: `a/${U1}/../o/x.jpg` },
      { display_name: 'D', avatar_key: 'a/u1/x.jpg' }, // not a uuid path
      { display_name: 'E', avatar_key: `a/${U1}/${F1}.png` },
    ],
  };
  const out = await decoratePreview(evil, spy) as Record<string, any>;
  assertEquals(out.host.avatar_url, null);
  assertEquals(out.facepile.map((f: { avatar_url: unknown }) => f.avatar_url), [null, null, null, null, null]);
  assertEquals(signed.includes('o/c001/b2/e3'), false);
  assertEquals(signed.some((k) => !k.startsWith('t/c/r/')), false); // only the cover was signed
});

Deno.test('F9: dead links disclose only status, kind and the host name', async () => {
  const dead: InvitePreview = {
    ...base,
    status: 'revoked',
    crew: { id: 'c1', name: 'Secret crew' },
    member_count: 12,
    requires_approval: true,
    viewer: { is_member: false },
  };
  for (const status of ['expired', 'revoked', 'full'] as const) {
    const out = await decoratePreview({ ...dead, status }, sign) as Record<string, unknown>;
    assertEquals(out, { status, kind: 'roll', host: { display_name: 'Kabir' }, cover_url: null });
  }
  assertEquals(await decoratePreview({ status: 'not_found' }, sign), { status: 'not_found', cover_url: null });
  assertEquals(await decoratePreview({ status: 'not_found', host: { display_name: 'x' } }, sign), { status: 'not_found', cover_url: null });
});

const jwt = (role: string) => `h.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.s`;

Deno.test('F8: only a real user token is forwarded to the RPC', () => {
  const user = jwt('authenticated');
  assertEquals(userAccessToken(`Bearer ${user}`, 'anon-key'), user);
  assertEquals(userAccessToken(`bearer ${user}`, 'anon-key'), user);
  assertEquals(userAccessToken(`Bearer ${jwt('anon')}`, 'anon-key'), null);
  assertEquals(userAccessToken('Bearer anon-key', 'anon-key'), null);
  assertEquals(userAccessToken('Bearer sb_publishable_abc', 'x'), null);
  assertEquals(userAccessToken('Bearer a.b', 'x'), null);
  assertEquals(userAccessToken('Bearer h.!!!.s', 'x'), null);
  assertEquals(userAccessToken(null, 'x'), null);
  assertEquals(userAccessToken('', 'x'), null);
});

Deno.test('F8: authenticated previews are private, anonymous ones cacheable', () => {
  assertEquals(cacheControlFor(true), 'private, no-store');
  assertEquals(cacheControlFor(false), 'public, max-age=60');
});

Deno.test('sealed roll or non-ok status never gets a cover', async () => {
  const sealed = { ...base, roll: { sealed: true } };
  assertEquals(shouldSignCover(sealed), false);
  assertEquals(((await decoratePreview(sealed, sign)) as Record<string, unknown>).cover_url, null);
  const expired = await decoratePreview({ ...base, status: 'expired' }, sign) as Record<string, any>;
  assertEquals(expired.cover_url, null);
  assertEquals('facepile' in expired, false);
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
