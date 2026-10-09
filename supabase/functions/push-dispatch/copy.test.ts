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

Deno.test('hourly digest: several uploaders read "Diya and 12 others added 412 to Goa \'26"', () => {
  const p = { uploader_name: 'Diya', roll_name: "Goa '26", count: 412 };
  assertEquals(buildNotification(ev({ kind: 'upload_batch', payload: { ...p, uploaders: 13 } })).title, "Diya and 12 others added 412 to Goa '26");
  assertEquals(buildNotification(ev({ kind: 'upload_batch', payload: { ...p, uploaders: 2, count: 14 } })).title, "Diya and 1 other added 14 to Goa '26");
  // one uploader (or an old row without `uploaders`) keeps the single-name copy
  assertEquals(buildNotification(ev({ kind: 'upload_batch', payload: { ...p, uploaders: 1 } })).title, "Diya added 412 to Goa '26");
  assertEquals(buildNotification(ev({ kind: 'upload_batch', payload: p })).title, "Diya added 412 to Goa '26");
  assertEquals(buildNotification(ev({ kind: 'upload_batch', payload: { ...p, uploaders: 3, count: 0 } })).title, "Diya and 2 others added photos to Goa '26");
  // the actor name from the digest row works without uploader_name too
  assertEquals(buildNotification(ev({ kind: 'upload_batch', payload: { actor_name: 'Kabir', roll_name: 'X', count: 5, uploaders: 4 } })).title, 'Kabir and 3 others added 5 to X');
  assertEquals(buildNotification(ev({ kind: 'upload_batch', payload: { ...p, uploaders: 13 } })).data.url, 'dumpr://roll/r1');
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
  const off = normalizePrefs({ invites: false, uploads: false, chats: false, reveals: false });
  assertEquals(shouldDeliver(ev({ kind: 'invite' }), off), false);
  assertEquals(shouldDeliver(ev({ kind: 'join_request' }), off), false);
  assertEquals(shouldDeliver(ev({ kind: 'upload_batch' }), off), false);
  assertEquals(shouldDeliver(ev({ kind: 'mention' }), off), false);
  assertEquals(shouldDeliver(ev({ kind: 'reveal' }), off), false);
  assertEquals(shouldDeliver(ev({ kind: 'photo_removed' }), off), true); // everything else on
  assertEquals(shouldDeliver(ev({ kind: 'reveal' }), normalizePrefs(null)), true);
  assertEquals(normalizePrefs({ uploads: 'no' as unknown as boolean }).uploads, true);
});

Deno.test('mutes come with the claim (crew or roll muted by the recipient)', () => {
  const prefs = normalizePrefs(null);
  assertEquals(shouldDeliver(ev({ kind: 'upload_batch', muted: true }), prefs), false);
  assertEquals(shouldDeliver(ev({ kind: 'mention', muted: true }), prefs), false);
  assertEquals(shouldDeliver(ev({ kind: 'invite', muted: true }), prefs), true);
  assertEquals(shouldDeliver(ev({ kind: 'crew_deleted', muted: true }), prefs), true);
  assertEquals(shouldDeliver(ev({ kind: 'removed_from_crew', muted: true }), prefs), true);
  assertEquals(shouldDeliver(ev({ kind: 'upload_batch', muted: false }), prefs), true);
  assertEquals(shouldDeliver(ev({ kind: 'upload_batch' }), prefs), true);
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
  assertEquals(toEvent({ id: 1, recipient_id: 'u', kind: 'mention', muted: true })?.muted, true);
  assertEquals(toEvent({ id: 1, recipient_id: 'u', kind: 'mention' })?.muted, false);
});
