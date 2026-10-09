import { assertEquals } from 'jsr:@std/assert@1';
import {
  buildNotification,
  groupByRecipient,
  isStale,
  MAX_PER_RECIPIENT,
  normalizePrefs,
  type PushEvent,
  planForRecipient,
  shouldDeliver,
  toEvent,
} from './copy.ts';

const ev = (o: Partial<PushEvent> & { kind: string }): PushEvent => ({
  id: 1,
  recipient_id: 'u1',
  crew_id: 'c1',
  roll_id: 'r1',
  photo_id: null,
  actor_id: 'u2',
  payload: {},
  created_at: null,
  ...o,
});

Deno.test('reveal copy matches the design sample', () => {
  const n = buildNotification(ev({ kind: 'reveal', payload: { roll_name: "Goa '26", photo_count: 312, contributors: 6, my_count: 41 } }));
  assertEquals(n.title, "Goa '26 is revealed");
  assertEquals(n.body, "312 photos from 6 phones. You're in 41.");
  assertEquals(n.channelId, 'reveals');
  assertEquals(n.data.url, 'dumpr://roll/r1');
});

Deno.test('reveal falls back to looked-up count and singular forms', () => {
  const n = buildNotification(ev({ kind: 'reveal' }), { roll: 'Diwali', rollPhotoCount: 1 });
  assertEquals(n.title, 'Diwali is revealed');
  assertEquals(n.body, '1 photo is ready.');
  const n2 = buildNotification(ev({ kind: 'reveal', payload: { photo_count: 1, contributors: 1 } }), { roll: 'X' });
  assertEquals(n2.body, '1 photo from 1 phone.');
  assertEquals(buildNotification(ev({ kind: 'reveal' }), { roll: 'X' }).body, undefined);
});

Deno.test('upload batch, invite, mention copy', () => {
  const up = buildNotification(ev({ kind: 'upload_batch', payload: { uploader_name: 'Diya', roll_name: "Goa '26", count: 24 } }));
  assertEquals(up.title, "Diya added 24 to Goa '26");
  assertEquals(up.channelId, 'uploads');
  const inv = buildNotification(ev({ kind: 'invite', payload: { code: 'abc234' } }), { actor: 'Kabir', roll: "Goa '26" });
  assertEquals(inv.title, "Kabir invited you to Goa '26");
  assertEquals(inv.data.url, 'dumpr://invite/abc234');
  assertEquals(inv.channelId, 'invites');
  const m = buildNotification(ev({ kind: 'mention', roll_id: null }), { actor: 'Meera', crew: 'Goa Gang' });
  assertEquals(m.title, 'Meera mentioned you in Goa Gang');
  assertEquals(m.data.url, 'dumpr://chat/c%3Ac1');
  assertEquals(m.channelId, 'chats');
});

Deno.test('data carries ids and a route only', () => {
  const n = buildNotification(ev({ kind: 'reaction', photo_id: 'p1', payload: { thumb_key: 't/secret' } }), { actor: 'A' });
  assertEquals(n.data, { url: 'dumpr://photo/p1', kind: 'reaction', activity_id: 1, crew_id: 'c1', roll_id: 'r1', photo_id: 'p1' });
});

Deno.test('long names are clipped; unknown kinds degrade', () => {
  const n = buildNotification(ev({ kind: 'joined' }), { actor: 'x'.repeat(80), roll: 'R' });
  assertEquals(n.title.length < 60, true);
  assertEquals(buildNotification(ev({ kind: 'something_new' })).title, 'New activity on Dumpr');
});

Deno.test('prefs filtering', () => {
  const none = { crews: new Set<string>(), rolls: new Set<string>() };
  const off = normalizePrefs({ invites: false, uploads: false, chats: false, reveals: false });
  assertEquals(shouldDeliver(ev({ kind: 'invite' }), off, none), false);
  assertEquals(shouldDeliver(ev({ kind: 'join_request' }), off, none), false);
  assertEquals(shouldDeliver(ev({ kind: 'upload_batch' }), off, none), false);
  assertEquals(shouldDeliver(ev({ kind: 'mention' }), off, none), false);
  assertEquals(shouldDeliver(ev({ kind: 'reveal' }), off, none), false);
  assertEquals(shouldDeliver(ev({ kind: 'photo_removed' }), off, none), true); // everything else on
  assertEquals(shouldDeliver(ev({ kind: 'reveal' }), normalizePrefs(null), none), true);
  assertEquals(normalizePrefs({ uploads: 'no' as unknown as boolean }).uploads, true);
});

Deno.test('crew and roll mutes', () => {
  const prefs = normalizePrefs(null);
  const crewMuted = { crews: new Set(['u1:c1']), rolls: new Set<string>() };
  const rollMuted = { crews: new Set<string>(), rolls: new Set(['u1:r1']) };
  assertEquals(shouldDeliver(ev({ kind: 'upload_batch' }), prefs, crewMuted), false);
  assertEquals(shouldDeliver(ev({ kind: 'mention' }), prefs, rollMuted), false);
  assertEquals(shouldDeliver(ev({ kind: 'invite' }), prefs, crewMuted), true);
  assertEquals(shouldDeliver(ev({ kind: 'removed_from_crew' }), prefs, crewMuted), true);
  assertEquals(shouldDeliver(ev({ kind: 'upload_batch', recipient_id: 'u9' }), prefs, crewMuted), true);
});

Deno.test('grouping and per-recipient cap', () => {
  const events = [5, 1, 3, 2, 4].map((id) => ev({ id, kind: 'upload_batch', recipient_id: id % 2 ? 'u1' : 'u2' }));
  const g = groupByRecipient(events);
  assertEquals(g.get('u1')!.map((e) => e.id), [1, 3, 5]);
  assertEquals(g.get('u2')!.map((e) => e.id), [2, 4]);

  const many = [1, 2, 3, 4, 5].map((id) => ({ ev: ev({ id, kind: 'upload_batch' }), note: buildNotification(ev({ id, kind: 'upload_batch' })) }));
  const plans = planForRecipient('u1', many);
  assertEquals(plans.length, MAX_PER_RECIPIENT);
  assertEquals(plans[2].eventIds, [3, 4, 5]);
  assertEquals(plans[2].title, '3 more updates on Dumpr');
  assertEquals(planForRecipient('u1', many.slice(0, 3)).length, 3);
});

Deno.test('stale and row normalisation', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  assertEquals(isStale(ev({ kind: 'x', created_at: '2026-10-07T12:00:00Z' }), now), true);
  assertEquals(isStale(ev({ kind: 'x', created_at: '2026-10-09T11:59:00Z' }), now), false);
  assertEquals(isStale(ev({ kind: 'x' }), now), false);
  assertEquals(toEvent({ id: '42', recipient_id: 'u', kind: 'reveal', payload: null })?.id, 42);
  assertEquals(toEvent({ id: 'x' }), null);
});
