import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { HttpError } from '../_shared/http.ts';
import { buildExport, crewsFromMembership, lastHostError, parseAccountRequest, parseSummary, purgeKeys } from './logic.ts';

Deno.test('request parsing requires the DELETE confirmation', () => {
  assertEquals(parseAccountRequest({ action: 'export' }), { action: 'export' });
  assertEquals(parseAccountRequest({ action: 'delete', confirm: 'DELETE' }), { action: 'delete' });
  assertThrows(() => parseAccountRequest({ action: 'delete' }), HttpError);
  assertThrows(() => parseAccountRequest({ action: 'delete', confirm: 'delete' }), HttpError);
  assertThrows(() => parseAccountRequest({ action: 'nuke' }), HttpError);
  assertThrows(() => parseAccountRequest(null), HttpError);
});

Deno.test('summary parsing tolerates shapes', () => {
  assertEquals(parseSummary({ sole_host_crews: [{ id: 'c1', name: 'Goa Gang' }], photo_keys_count: 12 }), {
    sole_host_crews: [{ id: 'c1', name: 'Goa Gang' }],
    photo_keys_count: 12,
  });
  assertEquals(parseSummary([{ sole_host_crews: null }]), { sole_host_crews: [], photo_keys_count: 0 });
  assertEquals(parseSummary(null).sole_host_crews, []);
});

Deno.test('last_host error is a 409 with crews', () => {
  const e = lastHostError([{ id: 'c1', name: 'A' }]);
  assertEquals([e.status, e.code, e.details], [409, 'last_host', { crews: [{ id: 'c1', name: 'A' }] }]);
});

Deno.test('purge keys cover original/display/thumb/avatar without duplicates', () => {
  const keys = purgeKeys([
    { original_key: 'o/1', display_key: 'd/1', thumb_key: 't/1' },
    { original_key: 'o/1', display_key: 'd/2', thumb_key: null },
  ], 'a/u/x.jpg');
  assertEquals(keys.sort(), ['a/u/x.jpg', 'd/1', 'd/2', 'o/1', 't/1']);
  assertEquals(purgeKeys([], null), []);
});

Deno.test('export manifest and crew flattening', () => {
  const crews = crewsFromMembership([
    { role: 'host', crews: { id: 'c1', name: 'Goa Gang', deleted_at: null } },
    { role: 'member', crews: [{ id: 'c2', name: 'Fam' }] },
    { role: 'member', crews: { id: 'c3', name: 'Gone', deleted_at: '2026-01-01' } },
    { role: 'member', crews: null },
  ]);
  assertEquals(crews, [{ id: 'c1', name: 'Goa Gang', role: 'host' }, { id: 'c2', name: 'Fam', role: 'member' }]);
  const m = buildExport({ profile: { id: 'u' }, crews, photos: [], truncated: true, now: new Date('2026-10-09T00:00:00Z') });
  assertEquals(m.exported_at, '2026-10-09T00:00:00.000Z');
  assertEquals(m.truncated, true);
  assertEquals(m.url_expires_in_hours, 24);
});
