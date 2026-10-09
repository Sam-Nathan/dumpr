// Notification copy + routing (pure). Rules from design-system §10: warm, specific, never blames the user;
// batch uploads read "Diya added 24 to Goa '26" (hourly digest with several uploaders: "Diya and 12 others added 412 to Goa '26"); reveals read "Goa '26 is revealed" / "312 photos from 6 phones. You're in 41."
// `data` carries a deep-link and ids only, never photo content.
import type { PushChannel } from '../_shared/push.ts';

export type ActivityKind =
  | 'invite' | 'join_request' | 'joined' | 'upload_batch' | 'reaction' | 'mention' | 'reveal'
  | 'removal_request' | 'photo_removed' | 'crew_deleted' | 'removed_from_crew' | 'guest_review';

export interface PushPrefs {
  invites: boolean;
  uploads: boolean;
  chats: boolean;
  reveals: boolean;
  games: boolean;
}
export const DEFAULT_PREFS: PushPrefs = { invites: true, uploads: true, chats: true, reveals: true, games: true };

export interface PushEvent {
  id: number;
  recipient_id: string;
  kind: string;
  crew_id: string | null;
  roll_id: string | null;
  photo_id: string | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
  created_at: string | null;
  /** From the claim RPC: the recipient muted this crew or roll. Absent / false = not muted. */
  muted?: boolean;
}

export interface Names {
  actor?: string | null;
  crew?: string | null;
  roll?: string | null;
  /** rolls.photo_count, fallback for reveal copy */
  rollPhotoCount?: number | null;
}

export interface Notification {
  title: string;
  body?: string;
  data: Record<string, unknown>;
  channelId: PushChannel;
}

const CHANNEL: Record<string, PushChannel> = {
  invite: 'invites',
  join_request: 'invites',
  joined: 'invites',
  crew_deleted: 'invites',
  removed_from_crew: 'invites',
  upload_batch: 'uploads',
  guest_review: 'uploads',
  photo_removed: 'uploads',
  removal_request: 'uploads',
  reaction: 'uploads',
  mention: 'chats',
  reveal: 'reveals',
};

export function channelFor(kind: string): PushChannel {
  return CHANNEL[kind] ?? 'uploads';
}

/** Pref group switched by the user; null = always on ("everything else on"). */
export function prefKeyFor(kind: string): keyof PushPrefs | null {
  switch (kind) {
    case 'invite':
    case 'join_request':
    case 'joined':
      return 'invites';
    case 'upload_batch':
      return 'uploads';
    case 'mention':
      return 'chats';
    case 'reveal':
      return 'reveals';
    default:
      return null;
  }
}

/** Kinds that must reach you even when the crew/roll is muted (you are not, or no longer, in the space). */
const IGNORE_MUTE = new Set(['invite', 'crew_deleted', 'removed_from_crew']);

export function normalizePrefs(p: Record<string, unknown> | null | undefined): PushPrefs {
  const out = { ...DEFAULT_PREFS };
  if (p) for (const k of Object.keys(out) as (keyof PushPrefs)[]) if (typeof p[k] === 'boolean') out[k] = p[k] as boolean;
  return out;
}

export function shouldDeliver(ev: PushEvent, prefs: PushPrefs): boolean {
  const key = prefKeyFor(ev.kind);
  if (key && !prefs[key]) return false;
  // `muted` comes with the claim (crew_members.muted or roll_members.muted of the recipient): no second query
  if (ev.muted === true && !IGNORE_MUTE.has(ev.kind)) return false;
  return true;
}

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Resolves names: payload fields win (they were captured when the event happened), then looked-up names. */
export function resolveNames(ev: PushEvent, looked: Names): Names {
  const p = ev.payload ?? {};
  return {
    actor: str(p.actor_name) ?? str(p.uploader_name) ?? str(p.inviter_name) ?? looked.actor ?? null,
    crew: str(p.crew_name) ?? looked.crew ?? null,
    roll: str(p.roll_name) ?? looked.roll ?? null,
    rollPhotoCount: looked.rollPhotoCount ?? null,
  };
}

export function deepLink(ev: PushEvent): string {
  const p = ev.payload ?? {};
  switch (ev.kind) {
    case 'invite': {
      const code = str(p.code);
      return code ? `dumpr://invite/${encodeURIComponent(code)}` : 'dumpr://inbox';
    }
    case 'mention': {
      const thread = ev.roll_id ? `r:${ev.roll_id}` : ev.crew_id ? `c:${ev.crew_id}` : null;
      return thread ? `dumpr://chat/${encodeURIComponent(thread)}` : 'dumpr://inbox';
    }
    case 'reveal':
    case 'upload_batch':
    case 'guest_review':
    case 'photo_removed':
    case 'removal_request':
    case 'reaction':
      if (ev.photo_id && (ev.kind === 'reaction' || ev.kind === 'photo_removed')) return `dumpr://photo/${ev.photo_id}`;
      if (ev.roll_id) return `dumpr://roll/${ev.roll_id}`;
      return ev.crew_id ? `dumpr://crew/${ev.crew_id}` : 'dumpr://inbox';
    case 'join_request':
    case 'joined':
      return ev.crew_id ? `dumpr://crew/${ev.crew_id}` : 'dumpr://inbox';
    default:
      return 'dumpr://inbox';
  }
}

export function buildNotification(ev: PushEvent, looked: Names = {}): Notification {
  const n = resolveNames(ev, looked);
  const p = ev.payload ?? {};
  const actor = clip(n.actor ?? 'Someone');
  const roll = n.roll ? clip(n.roll) : null;
  const crew = n.crew ? clip(n.crew) : null;
  const space = roll ?? crew ?? 'a Roll';
  const data: Record<string, unknown> = {
    url: deepLink(ev),
    kind: ev.kind,
    activity_id: ev.id,
    ...(ev.crew_id ? { crew_id: ev.crew_id } : {}),
    ...(ev.roll_id ? { roll_id: ev.roll_id } : {}),
    ...(ev.photo_id ? { photo_id: ev.photo_id } : {}),
  };
  const channelId = channelFor(ev.kind);
  const out = (title: string, body?: string): Notification => ({ title, ...(body ? { body } : {}), data, channelId });

  switch (ev.kind) {
    case 'invite':
      return out(`${actor} invited you to ${space}`, 'Tap to take a look.');
    case 'join_request':
      return out(`${actor} wants to join ${space}`, 'Approve or decline in Dumpr.');
    case 'joined':
      return out(`${actor} joined ${space}`);
    case 'upload_batch': {
      const count = num(p.count) ?? num(p.photo_count);
      // hourly digest row (recipient, roll, hour): `uploaders` people added `count` photos, `actor` is the top one
      const others = Math.max((num(p.uploaders) ?? 1) - 1, 0);
      const who = others > 0 ? `${actor} and ${plural(others, 'other', 'others')}` : actor;
      return out(count ? `${who} added ${count.toLocaleString('en-US')} to ${space}` : `${who} added photos to ${space}`, 'Tap to see them.');
    }
    case 'mention':
      return out(`${actor} mentioned you in ${crew ?? roll ?? 'a chat'}`);
    case 'reveal': {
      const photos = num(p.photo_count) ?? num(p.count) ?? n.rollPhotoCount ?? null;
      const phones = num(p.contributors) ?? num(p.phones);
      const mine = num(p.my_count) ?? num(p.mine);
      let body: string | undefined;
      if (photos && phones) {
        body = `${plural(photos, 'photo', 'photos')} from ${plural(phones, 'phone', 'phones')}.${mine ? ` You're in ${mine.toLocaleString('en-US')}.` : ''}`;
      } else if (photos) {
        body = `${plural(photos, 'photo', 'photos')} ${photos === 1 ? 'is' : 'are'} ready.${mine ? ` You're in ${mine.toLocaleString('en-US')}.` : ''}`;
      }
      return out(`${roll ?? crew ?? 'Your Roll'} is revealed`, body);
    }
    case 'reaction':
      return out(`${actor} reacted to your photo`);
    case 'removal_request':
      return out(`${actor} asked to take a photo down`, 'Review the request in Dumpr.');
    case 'photo_removed':
      return out(`A photo of yours was removed from ${space}`);
    case 'crew_deleted':
      return out(`${crew ?? 'A Crew'} was deleted`, 'You can still save your own photos for now.');
    case 'removed_from_crew':
      return out(`You were removed from ${crew ?? 'a Crew'}`);
    case 'guest_review':
      return out(`New photos in ${space} need a look`, 'Guest uploads are waiting for review.');
    default:
      return out('New activity on Dumpr');
  }
}

/** Max individual pushes per recipient per dispatch run; the rest collapse into one summary. */
export const MAX_PER_RECIPIENT = 3;

export interface PlannedPush {
  recipientId: string;
  eventIds: number[];
  title: string;
  body?: string;
  data: Record<string, unknown>;
  channelId: PushChannel;
}

/** One recipient's deliverable events (oldest first) → at most MAX_PER_RECIPIENT pushes. */
export function planForRecipient(
  recipientId: string,
  events: readonly { ev: PushEvent; note: Notification }[],
): PlannedPush[] {
  if (events.length <= MAX_PER_RECIPIENT) {
    return events.map(({ ev, note }) => ({ recipientId, eventIds: [ev.id], ...note }));
  }
  const head = events.slice(0, MAX_PER_RECIPIENT - 1);
  const rest = events.slice(MAX_PER_RECIPIENT - 1);
  const plans: PlannedPush[] = head.map(({ ev, note }) => ({ recipientId, eventIds: [ev.id], ...note }));
  plans.push({
    recipientId,
    eventIds: rest.map((r) => r.ev.id),
    title: `${rest.length} more updates on Dumpr`,
    body: 'Tap to catch up.',
    data: { url: 'dumpr://inbox', kind: 'digest' },
    channelId: rest.every((r) => r.note.channelId === rest[0].note.channelId) ? rest[0].note.channelId : 'uploads',
  });
  return plans;
}

export function groupByRecipient(events: readonly PushEvent[]): Map<string, PushEvent[]> {
  const m = new Map<string, PushEvent[]>();
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const list = m.get(e.recipient_id);
    if (list) list.push(e);
    else m.set(e.recipient_id, [e]);
  }
  return m;
}

/** Events older than this are marked pushed without sending (a day-old "mention" push is noise). */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export function isStale(ev: PushEvent, now = Date.now()): boolean {
  if (!ev.created_at) return false;
  const t = Date.parse(ev.created_at);
  return Number.isFinite(t) && now - t > STALE_AFTER_MS;
}

/** Normalises a raw RPC row (tolerates numeric strings for bigint ids and missing optional columns). */
export function toEvent(r: Record<string, unknown>): PushEvent | null {
  const id = Number(r.id);
  if (!Number.isFinite(id) || typeof r.recipient_id !== 'string' || typeof r.kind !== 'string') return null;
  const payload = r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload) ? (r.payload as Record<string, unknown>) : {};
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id,
    recipient_id: r.recipient_id,
    kind: r.kind,
    crew_id: s(r.crew_id),
    roll_id: s(r.roll_id),
    photo_id: s(r.photo_id),
    actor_id: s(r.actor_id),
    payload,
    created_at: s(r.created_at),
    muted: r.muted === true,
  };
}
