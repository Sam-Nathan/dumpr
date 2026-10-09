import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { HttpError } from './http.ts';
import { identityFromClaims } from './auth.ts';

const U = '3f0c1d2e-4a5b-4c6d-8e7f-0123456789ab';
const NOW = 1_800_000_000;
const ok = { sub: U, role: 'authenticated', exp: NOW + 3600 };

Deno.test('claims: a signed-in user', () => {
  assertEquals(identityFromClaims(ok, NOW), { userId: U, isGuest: false });
  assertEquals(identityFromClaims({ ...ok, sub: U.toUpperCase() }, NOW).userId, U);
});

Deno.test('claims: is_anonymous marks a guest', () => {
  assertEquals(identityFromClaims({ ...ok, is_anonymous: true }, NOW).isGuest, true);
  assertEquals(identityFromClaims({ ...ok, is_anonymous: false }, NOW).isGuest, false);
  assertEquals(identityFromClaims({ ...ok, is_anonymous: 'true' }, NOW).isGuest, false); // only a real boolean counts
});

Deno.test('claims: missing / invalid / expired / wrong-role tokens are rejected with 401', () => {
  const bad: Array<Record<string, unknown> | null | undefined> = [
    null,
    undefined,
    {},
    { ...ok, sub: undefined }, // e.g. the anon or service-role key
    { ...ok, sub: 'not-a-uuid' },
    { ...ok, sub: 42 },
    { ...ok, exp: NOW }, // expires now
    { ...ok, exp: NOW - 1 },
    { ...ok, exp: undefined },
    { ...ok, exp: String(NOW + 10) },
    { ...ok, role: 'anon' },
    { ...ok, role: 'service_role' },
    { ...ok, role: undefined },
  ];
  for (const c of bad) {
    const e = assertThrows(() => identityFromClaims(c, NOW), HttpError);
    assertEquals(e.status, 401);
    assertEquals(e.code, 'not_authenticated');
  }
});
