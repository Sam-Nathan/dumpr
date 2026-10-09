/**
 * C5 chat helpers: thread keys, optimistic merge, grouping, reactions. Pure + unit-tested.
 * Lists are newest first (the chat list is inverted).
 */
import type { ReactionKind } from '../../data/types';
import type { ChatAuthor, ChatMessage, PendingMessage } from '../../data/types-cf';
import { monthShort } from '../../lib/format';

export type ThreadRef = { kind: 'crew' | 'roll'; id: string };

const UUIDISH = /^[0-9a-f-]{8,40}$/i;

/** 'c:<crewId>' | 'r:<rollId>' -> ref (null when malformed). */
export function parseThreadKey(key: string | null | undefined): ThreadRef | null {
  const m = /^([cr]):(.+)$/.exec(decodeURIComponent(key ?? '').trim());
  if (!m || !UUIDISH.test(m[2] as string)) return null;
  return { kind: m[1] === 'c' ? 'crew' : 'roll', id: m[2] as string };
}

export function threadKeyOf(kind: 'crew' | 'roll', id: string): string {
  return `${kind === 'crew' ? 'c' : 'r'}:${id}`;
}

/** A message as the list renders it: server rows and optimistic ones. */
export interface DisplayMessage extends ChatMessage {
  /** Set while the message has not reached the server yet. */
  pending?: 'sending' | 'failed';
  /** First message of a run by one author: show name + avatar. */
  showAuthor: boolean;
  /** Show a day separator above this message. */
  showDay: boolean;
}

const GROUP_GAP_MS = 5 * 60_000;

export function pendingToMessage(
  p: PendingMessage,
  me: { id: string; author: ChatAuthor | null },
  ref: ThreadRef,
  crewId: string,
): ChatMessage {
  return {
    id: `pending:${p.clientId}`,
    crew_id: crewId,
    roll_id: ref.kind === 'roll' ? ref.id : null,
    thread_key: p.threadKey,
    author_id: me.id,
    client_id: p.clientId,
    body: p.body,
    photo_id: p.photoId,
    reply_to_id: p.replyToId,
    kind: p.kind,
    deleted_at: null,
    created_at: p.createdAt,
    author: me.author,
    reactions: [],
    photo: null,
  };
}

const sameDay = (a: string, b: string) => {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
};

/**
 * Merges server messages (newest first, possibly overlapping pages / realtime duplicates) with
 * optimistic ones. A pending message disappears the moment the server row with its `client_id`
 * shows up. Deleted messages are dropped. Adds grouping flags.
 */
export function mergeMessages(
  server: readonly ChatMessage[],
  pending: readonly PendingMessage[],
  me: { id: string; author: ChatAuthor | null },
  ref: ThreadRef,
  crewId: string,
  hiddenIds: ReadonlySet<string> = new Set(),
): DisplayMessage[] {
  const seen = new Set<string>();
  const rows: (ChatMessage & { pending?: 'sending' | 'failed' })[] = [];
  const clientIds = new Set<string>();
  for (const m of server) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    if (m.deleted_at || hiddenIds.has(m.id)) continue;
    clientIds.add(m.client_id);
    rows.push(m);
  }
  for (const p of pending) {
    if (clientIds.has(p.clientId)) continue;
    rows.push({ ...pendingToMessage(p, me, ref, crewId), pending: p.status });
  }
  rows.sort((a, b) => {
    const d = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (d !== 0) return d;
    return (b.pending ? 1 : 0) - (a.pending ? 1 : 0);
  });
  return rows.map((m, i) => {
    const older = rows[i + 1];
    const showDay = !older || !sameDay(older.created_at, m.created_at);
    const showAuthor =
      m.kind !== 'system' &&
      (!older ||
        older.kind === 'system' ||
        older.author_id !== m.author_id ||
        showDay ||
        Date.parse(m.created_at) - Date.parse(older.created_at) > GROUP_GAP_MS);
    return { ...m, showAuthor, showDay };
  });
}

/** Adds one realtime / just-sent message to the first (newest) page unless it is already there. */
export function prependMessage(pages: readonly ChatMessage[][], msg: ChatMessage): ChatMessage[][] {
  if (pages.some((p) => p.some((m) => m.id === msg.id || m.client_id === msg.client_id))) {
    return pages.map((p) => p.map((m) => (m.client_id === msg.client_id ? { ...m, ...msg } : m)));
  }
  const [first = [], ...rest] = pages;
  return [[msg, ...first], ...rest];
}

/** "Today" / "Yesterday" / "Tue 12 Mar". */
export function dayHeading(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return `${wd} ${d.getDate()} ${monthShort(d.getMonth())}`;
}

export interface ReactionSummary {
  kind: ReactionKind;
  n: number;
  mine: boolean;
}

const ORDER: ReactionKind[] = ['ICONIC', 'LMAO', 'CRYING', 'HEART', 'SAME'];

/** Counts per reaction word, most used first (ties keep the design's word order). */
export function summarizeReactions(
  reactions: readonly { user_id: string; kind: ReactionKind }[],
  meId: string,
): ReactionSummary[] {
  const map = new Map<ReactionKind, ReactionSummary>();
  for (const r of reactions) {
    const cur = map.get(r.kind) ?? { kind: r.kind, n: 0, mine: false };
    cur.n += 1;
    cur.mine ||= r.user_id === meId;
    map.set(r.kind, cur);
  }
  return [...map.values()].sort(
    (a, b) => b.n - a.n || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );
}

/** One reaction per person: tapping the same word removes it, another word replaces it. */
export function toggleReaction(
  reactions: readonly { user_id: string; kind: ReactionKind }[],
  meId: string,
  kind: ReactionKind,
): { user_id: string; kind: ReactionKind }[] {
  const mine = reactions.find((r) => r.user_id === meId);
  const others = reactions.filter((r) => r.user_id !== meId);
  return mine?.kind === kind ? others : [...others, { user_id: meId, kind }];
}

/** Quote line for a reply / last-message preview. */
export function messagePreview(m: Pick<ChatMessage, 'body' | 'kind' | 'photo_id'>): string {
  if (m.body?.trim()) return m.body.trim();
  if (m.kind === 'photo' || m.photo_id) return 'Photo';
  return 'Message';
}

/** Three starter prompts for an empty thread. */
export function starterPrompts(kind: 'crew' | 'roll', name: string): string[] {
  return kind === 'crew'
    ? [`Hey ${name}!`, 'Who is up for the next plan?', 'Drop your best shot from last time']
    : [`${name} photos incoming`, 'Who has the best shot so far?', 'Post your favourite one here'];
}

/** Body validation: trimmed, 1..2000 chars. */
export function cleanBody(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  return t.slice(0, 2000);
}
