// push-dispatch: cron-invoked (x-cron-secret). Claims un-pushed activity events (instant ones first; mutes, prefs
// and tokens come with the claim), applies prefs and mutes, sends Expo pushes, deletes dead tokens and marks events pushed. `?job=purge` drains media_purge_queue.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError, json, serve } from '../_shared/http.ts';
import { adminClient, requireCron } from '../_shared/auth.ts';
import { r2Config } from '../_shared/env.ts';
import { createR2 } from '../_shared/r2.ts';
import { type ExpoMessage, isExpoPushToken, sendExpoPush } from '../_shared/push.ts';
import {
  buildNotification,
  groupByRecipient,
  isStale,
  type Names,
  normalizePrefs,
  type PlannedPush,
  planForRecipient,
  type PushEvent,
  type PushPrefs,
  shouldDeliver,
  toEvent,
} from './copy.ts';

const CLAIM_LIMIT = 500;
const BUDGET_MS = 15_000; // keep one invocation well under ~20 s
const IN_CHUNK = 100;

function chunks<T>(a: readonly T[], n = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

async function selectIn<T>(
  db: SupabaseClient,
  table: string,
  cols: string,
  col: string,
  values: readonly string[],
): Promise<T[]> {
  if (values.length === 0) return [];
  const parts = await Promise.all(
    chunks(values).map(async (vals) => {
      const { data, error } = await db.from(table).select(cols).in(col, vals);
      if (error) throw error;
      return (data ?? []) as T[];
    }),
  );
  return parts.flat();
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

async function dispatch(admin: SupabaseClient, started: number) {
  const { data: raw, error } = await admin.rpc('svc_claim_push_batch', { p_limit: CLAIM_LIMIT });
  if (error) throw error;
  const rawRows = (Array.isArray(raw) ? raw : []) as Record<string, unknown>[];
  const events: PushEvent[] = [];
  // The claim RPC already includes tokens / prefs (and `muted`, read by toEvent); tables are queried only for
  // recipients it did not cover.
  const embeddedTokens = new Map<string, string[]>();
  const embeddedPrefs = new Map<string, PushPrefs>();
  for (const r of rawRows) {
    const e = toEvent(r);
    if (!e) continue;
    events.push(e);
    if (Array.isArray(r.tokens)) embeddedTokens.set(e.recipient_id, (r.tokens as unknown[]).filter((t): t is string => typeof t === 'string'));
    if (r.prefs && typeof r.prefs === 'object') embeddedPrefs.set(e.recipient_id, normalizePrefs(r.prefs as Record<string, unknown>));
  }
  if (events.length === 0) return { claimed: 0, sent: 0 };

  const now = Date.now();
  const done = new Set<number>(); // event ids to mark pushed
  const stale = events.filter((e) => isStale(e, now));
  stale.forEach((e) => done.add(e.id));
  const live = events.filter((e) => !done.has(e.id));

  const recipients = uniq(live.map((e) => e.recipient_id));
  const needPrefs = recipients.filter((u) => !embeddedPrefs.has(u));
  const needTokens = recipients.filter((u) => !embeddedTokens.has(u));
  const actorIds = uniq(live.filter((e) => !(e.payload.actor_name ?? e.payload.uploader_name ?? e.payload.inviter_name)).map((e) => e.actor_id));
  const needCrewNames = uniq(live.filter((e) => !e.payload.crew_name).map((e) => e.crew_id));
  const needRollNames = uniq(live.filter((e) => !e.payload.roll_name || e.kind === 'reveal').map((e) => e.roll_id));

  const [prefRows, tokenRows, profiles, crews, rolls] = await Promise.all([
    selectIn<Record<string, unknown> & { user_id: string }>(admin, 'notification_prefs', '*', 'user_id', needPrefs),
    selectIn<{ user_id: string; token: string }>(admin, 'push_tokens', 'user_id, token', 'user_id', needTokens),
    selectIn<{ id: string; display_name: string }>(admin, 'profiles', 'id, display_name', 'id', actorIds),
    selectIn<{ id: string; name: string }>(admin, 'crews', 'id, name', 'id', needCrewNames),
    selectIn<{ id: string; name: string; photo_count: number }>(admin, 'rolls', 'id, name, photo_count', 'id', needRollNames),
  ]);

  const prefs = new Map(embeddedPrefs);
  for (const r of prefRows) prefs.set(r.user_id, normalizePrefs(r as Record<string, unknown>));
  const tokens = new Map<string, string[]>(embeddedTokens);
  for (const u of needTokens) tokens.set(u, []);
  for (const t of tokenRows) tokens.get(t.user_id)!.push(t.token);
  const actorName = new Map(profiles.map((p) => [p.id, p.display_name]));
  const crewName = new Map(crews.map((c) => [c.id, c.name]));
  const rollInfo = new Map(rolls.map((r) => [r.id, r]));

  // Plan: filter by prefs/mutes, build copy, group per recipient.
  const plans: PlannedPush[] = [];
  for (const [recipient, evs] of groupByRecipient(live)) {
    const p = prefs.get(recipient) ?? normalizePrefs(null);
    const deliverable: { ev: PushEvent; note: ReturnType<typeof buildNotification> }[] = [];
    for (const ev of evs) {
      if (!shouldDeliver(ev, p)) {
        done.add(ev.id);
        continue;
      }
      const looked: Names = {
        actor: ev.actor_id ? actorName.get(ev.actor_id) : null,
        crew: ev.crew_id ? crewName.get(ev.crew_id) : null,
        roll: ev.roll_id ? rollInfo.get(ev.roll_id)?.name : null,
        rollPhotoCount: ev.roll_id ? rollInfo.get(ev.roll_id)?.photo_count : null,
      };
      deliverable.push({ ev, note: buildNotification(ev, looked) });
    }
    if (deliverable.length === 0) continue;
    const toks = (tokens.get(recipient) ?? []).filter(isExpoPushToken);
    if (toks.length === 0) {
      deliverable.forEach(({ ev }) => done.add(ev.id)); // nowhere to send; the Inbox still shows it
      continue;
    }
    plans.push(...planForRecipient(recipient, deliverable));
  }

  // Expand to one message per device token.
  const messages: ExpoMessage[] = [];
  const owner: PlannedPush[] = [];
  for (const plan of plans) {
    for (const to of tokens.get(plan.recipientId) ?? []) {
      if (!isExpoPushToken(to)) continue;
      messages.push({ to, title: plan.title, body: plan.body, data: plan.data, channelId: plan.channelId, sound: 'default', priority: 'high' });
      owner.push(plan);
    }
  }

  const result = await sendExpoPush(messages, {
    accessToken: Deno.env.get('EXPO_ACCESS_TOKEN'),
    deadline: started + BUDGET_MS,
  });

  // An event is done unless every one of its messages needs a retry (transient failure).
  const retry = new Set<number>();
  const delivered = new Set<number>();
  result.outcomes.forEach((o, i) => {
    for (const id of owner[i].eventIds) (o === 'retry' ? retry : delivered).add(id);
  });
  for (const plan of plans) {
    for (const id of plan.eventIds) {
      if (delivered.has(id) || !retry.has(id)) done.add(id);
    }
  }

  const invalid = [...new Set(result.invalidTokens)];
  for (const part of chunks(invalid)) {
    const { error: delErr } = await admin.from('push_tokens').delete().in('token', part);
    if (delErr) console.error('token cleanup failed', delErr.code ?? '');
  }
  const doneIds = [...done];
  if (doneIds.length) {
    for (const part of chunks(doneIds, 500)) {
      const { error: markErr } = await admin.rpc('svc_mark_pushed', { p_ids: part });
      if (markErr) throw markErr;
    }
  }
  return {
    claimed: events.length,
    stale: stale.length,
    pushes: messages.length,
    sent: result.sent,
    tokens_removed: invalid.length,
    marked: doneIds.length,
    retry: events.length - doneIds.length,
  };
}

async function purge(admin: SupabaseClient, started: number) {
  const cfg = r2Config();
  if (!cfg) throw new HttpError(503, 'storage_not_configured', 'R2 is not configured; purge skipped');
  const r2 = createR2(cfg);
  let claimed = 0;
  let deleted = 0;
  let failed = 0;
  while (Date.now() - started < BUDGET_MS) {
    const { data, error } = await admin.rpc('svc_media_purge_claim', { p_limit: 500 });
    if (error) throw error;
    const keys = ((Array.isArray(data) ? data : []) as unknown[])
      .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? Object.values(x)[0] : null))
      .filter((k): k is string => typeof k === 'string' && k.length > 0);
    if (keys.length === 0) break;
    claimed += keys.length;
    const res = await r2.deleteObjects(keys);
    const failedSet = new Set(res.failed);
    const ok = keys.filter((k) => !failedSet.has(k));
    if (ok.length) {
      const { error: doneErr } = await admin.rpc('svc_media_purge_done', { p_keys: ok });
      if (doneErr) throw doneErr;
    }
    deleted += ok.length;
    failed += res.failed.length;
    if (keys.length < 500 || ok.length === 0) break;
  }
  return { claimed, deleted, failed };
}

const handler = serve(async (req) => {
  requireCron(req);
  const started = Date.now();
  const admin = adminClient();
  const job = new URL(req.url).searchParams.get('job');
  if (job === 'purge') return json({ job: 'purge', ...(await purge(admin, started)) }, 200, req);
  if (job !== null && job !== 'push') throw new HttpError(400, 'invalid_input', 'Unknown job');
  return json({ job: 'push', ...(await dispatch(admin, started)) }, 200, req);
}, ['POST']);

Deno.serve(handler);
