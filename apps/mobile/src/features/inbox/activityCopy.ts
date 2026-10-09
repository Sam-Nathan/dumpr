/**
 * C6 Activity: turns an `activity_events` row into display copy, actions and a link target.
 * Pure + unit-tested. Copy rules (design-system.md §10): batch uploads ("Diya added 24"), names bold,
 * never blame, reactions are words.
 */
import type { ActivityEvent } from '../../data/types-cf';
import { formatRelative, monthShort, pluralize } from '../../lib/format';

export interface Segment {
  text: string;
  bold?: boolean;
}

export type ActivityActionId =
  | 'join'
  | 'decline'
  | 'preview'
  | 'approve'
  | 'deny'
  | 'remove_photo'
  | 'keep_photo'
  | 'open'
  | 'download'
  | 'ask_link';

export interface ActivityAction {
  id: ActivityActionId;
  label: string;
  /** The row's main action (lime for the first such row on screen, ink after that). */
  primary?: boolean;
}

export type ActivityLook = 'default' | 'reveal';

export interface ActivityView {
  id: number;
  segments: Segment[];
  time: string;
  unread: boolean;
  look: ActivityLook;
  actions: ActivityAction[];
  /** Photo ids to show as small thumbs on the right. */
  thumbPhotoIds: string[];
  /** Where tapping the row goes (expo-router href), if anywhere. */
  href: string | null;
  actorName: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "Aarav", "Aarav and Kabir", "Aarav, Kabir and 1 more". */
export function joinNames(names: readonly string[]): string {
  const clean = names.filter(Boolean);
  if (clean.length === 0) return 'Someone';
  if (clean.length === 1) return clean[0] as string;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  const rest = clean.length - 2;
  return `${clean[0]}, ${clean[1]} and ${rest} more`;
}

/** "12 Apr" from an ISO timestamp (local day). */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${monthShort(d.getMonth())}`;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function buildActivityView(e: ActivityEvent, now: number = Date.now()): ActivityView {
  const p = e.payload ?? {};
  const actor = e.actor?.display_name ?? str(p.actor_name) ?? 'Someone';
  const roll = str(p.roll_name);
  const crew = str(p.crew_name);
  const place = roll ?? crew ?? 'a Crew';
  const rollHref = e.roll_id ? `/roll/${e.roll_id}` : null;
  const crewHref = e.crew_id ? `/crew/${e.crew_id}` : null;

  const base: ActivityView = {
    id: e.id,
    segments: [],
    time: formatRelative(e.created_at, now),
    unread: e.read_at === null,
    look: 'default',
    actions: [],
    thumbPhotoIds: [],
    href: rollHref ?? crewHref,
    actorName: actor,
  };
  const seg = (text: string, bold = false): Segment => ({ text, bold });

  switch (e.kind) {
    case 'invite': {
      const code = str(p.code);
      return {
        ...base,
        segments: [seg(actor, true), seg(' invited you to '), seg(place, true)],
        actions: [
          { id: 'join', label: 'Join', primary: true },
          ...(code ? [{ id: 'preview' as const, label: 'Preview link' }] : []),
          { id: 'decline', label: 'Decline' },
        ],
        href: null,
      };
    }
    case 'join_request': {
      const who = str(p.requester_name) ?? actor;
      return {
        ...base,
        segments: [seg(who, true), seg(' wants to join '), seg(place, true)],
        actions: [
          { id: 'approve', label: 'Approve', primary: true },
          { id: 'deny', label: 'Deny' },
        ],
      };
    }
    case 'joined': {
      if (str(p.status) === 'approved') {
        return {
          ...base,
          segments: [seg(actor, true), seg(' let you into '), seg(place, true), seg('.')],
        };
      }
      return { ...base, segments: [seg(actor, true), seg(' joined '), seg(place, true)] };
    }
    case 'upload_batch': {
      const count = num(p.count) ?? 0;
      const who = str(p.uploader_name) ?? actor;
      return {
        ...base,
        segments: [
          seg(who, true),
          seg(count > 0 ? ` added ${pluralize(count, 'photo')} to ` : ' added photos to '),
          seg(place, true),
        ],
        thumbPhotoIds: strings(p.sample_photo_ids).slice(0, 2),
      };
    }
    case 'reaction': {
      const names = strings(p.names);
      const kind = str(p.reaction) ?? str(p.kind_label) ?? 'ICONIC';
      return {
        ...base,
        segments: [
          seg(joinNames(names.length ? names : [actor]), true),
          seg(' said '),
          seg(kind.toUpperCase(), true),
          seg(' on your photo'),
        ],
        thumbPhotoIds: e.photo_id ? [e.photo_id] : [],
        href: e.photo_id ? `/photo/${e.photo_id}` : base.href,
      };
    }
    case 'mention': {
      const snippet = str(p.snippet);
      const thread = str(p.thread_key);
      return {
        ...base,
        segments: [
          seg(actor, true),
          seg(' mentioned you'),
          ...(snippet ? [seg(`: “${snippet}”`)] : []),
        ],
        href: thread ? `/chat/${thread}` : base.href,
        thumbPhotoIds: e.photo_id ? [e.photo_id] : [],
      };
    }
    case 'reveal': {
      const count = num(p.count);
      const phones = num(p.contributors);
      const detail =
        count !== null
          ? ` ${pluralize(count, 'photo')}${phones ? ` from ${pluralize(phones, 'phone')}` : ''} ${count === 1 ? 'is' : 'are'} in.`
          : ' Everyone can see it now.';
      return {
        ...base,
        look: 'reveal',
        segments: [seg(`${place} is revealed.`, true), seg(detail)],
        actions: [],
      };
    }
    case 'removal_request': {
      const status = str(p.status);
      const photoHref = e.photo_id ? `/photo/${e.photo_id}` : base.href;
      if (status === 'approved') {
        return {
          ...base,
          segments: [seg(actor, true), seg(' removed the photo you asked about.')],
          href: null,
        };
      }
      if (status === 'denied') {
        return {
          ...base,
          segments: [seg(actor, true), seg(' kept the photo you asked about.')],
          href: null,
        };
      }
      return {
        ...base,
        segments: [seg(actor, true), seg(' asked you to remove a photo they are in.')],
        actions: str(p.request_id)
          ? [
              { id: 'remove_photo', label: 'Remove it', primary: true },
              { id: 'keep_photo', label: 'Keep' },
            ]
          : [{ id: 'open', label: 'Review', primary: true }],
        thumbPhotoIds: e.photo_id ? [e.photo_id] : [],
        href: photoHref,
      };
    }
    case 'photo_removed':
      return {
        ...base,
        segments: [
          seg(actor, true),
          seg(' took down one of your photos'),
          seg(place === 'a Crew' ? '.' : ` in ${place}.`),
        ],
      };
    case 'crew_deleted': {
      const until = shortDate(str(p.purge_after));
      return {
        ...base,
        segments: [
          seg(actor, true),
          seg(' deleted '),
          seg(crew ?? 'a Crew', true),
          seg(
            until
              ? `. You have until ${until} to download your copies.`
              : '. You have 30 days to download your copies.',
          ),
        ],
        actions: [{ id: 'download', label: 'Download my copies', primary: true }],
        href: crewHref,
      };
    }
    case 'removed_from_crew':
      return {
        ...base,
        segments: [
          seg(actor, true),
          seg(' removed you from '),
          seg(crew ?? 'a Crew', true),
          seg('.'),
        ],
        href: null,
      };
    case 'guest_review': {
      const count = num(p.count) ?? 1;
      const who = str(p.uploader_name) ?? actor;
      return {
        ...base,
        segments: [
          seg(who, true),
          seg(` added ${pluralize(count, 'photo')} to review in `),
          seg(place, true),
        ],
        actions: rollHref ? [{ id: 'open', label: 'Review', primary: true }] : [],
        thumbPhotoIds: e.photo_id ? [e.photo_id] : [],
      };
    }
    default:
      return { ...base, segments: [seg(actor, true), seg(' did something in '), seg(place, true)] };
  }
}

export interface ActivitySection {
  title: 'TODAY' | 'EARLIER';
  items: ActivityView[];
}

const sameLocalDay = (a: number, b: number) => {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
};

/** TODAY / EARLIER sections (empty ones are dropped). Input is already newest first. */
export function sectionActivity(
  events: readonly ActivityEvent[],
  now: number = Date.now(),
): ActivitySection[] {
  const today: ActivityView[] = [];
  const earlier: ActivityView[] = [];
  for (const e of events) {
    (sameLocalDay(Date.parse(e.created_at), now) ? today : earlier).push(buildActivityView(e, now));
  }
  return [
    ...(today.length ? [{ title: 'TODAY' as const, items: today }] : []),
    ...(earlier.length ? [{ title: 'EARLIER' as const, items: earlier }] : []),
  ];
}

/** Unread events (for the badge and "Activity (n)"). */
export function unreadActivityCount(events: readonly { read_at: string | null }[]): number {
  return events.filter((e) => e.read_at === null).length;
}

/** The pill badge: chats with unread messages + unread activity. */
export function inboxBadgeCount(unreadThreads: number, unreadActivity: number): number {
  return Math.max(0, unreadThreads) + Math.max(0, unreadActivity);
}
