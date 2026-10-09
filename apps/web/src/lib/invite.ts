import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';

export type InviteStatus = 'ok' | 'expired' | 'revoked' | 'full' | 'not_found';
export type InviteKind = 'crew' | 'roll';

export interface InvitePerson {
  displayName: string;
  avatarUrl: string | null;
  ringColor: string | null;
}

export interface InvitePreview {
  status: InviteStatus;
  kind: InviteKind;
  crew: { id: string; name: string; tint: string } | null;
  roll: {
    id: string;
    name: string;
    startsOn: string | null;
    endsOn: string | null;
    photoCount: number;
    sealed: boolean;
    revealAt: string | null;
  } | null;
  host: { displayName: string; avatarUrl: string | null } | null;
  memberCount: number;
  facepile: InvitePerson[];
  coverUrl: string | null;
  requiresApproval: boolean;
  allowGuests: boolean;
  viewer: { isMember: boolean; requestPending: boolean };
}

export type InviteLoad = { ok: true; preview: InvitePreview } | { ok: false; reason: 'network' };

const STATUSES: InviteStatus[] = ['ok', 'expired', 'revoked', 'full', 'not_found'];

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Codes are 10 chars of [a-z2-9]; accept a slightly wider shape and refuse anything else before fetching. */
export function isValidInviteCode(code: string): boolean {
  return /^[A-Za-z0-9]{4,40}$/.test(code);
}

/** Defensive parse of the `invite-preview` edge function body. Returns null when unusable. */
export function parseInvitePreview(raw: unknown): InvitePreview | null {
  const root = obj(raw);
  if (!root) return null;
  const status = STATUSES.find((s) => s === root.status);
  if (!status) return null;
  const kind: InviteKind = root.kind === 'crew' ? 'crew' : 'roll';

  const crewRaw = obj(root.crew);
  const rollRaw = obj(root.roll);
  const hostRaw = obj(root.host);

  const crew =
    crewRaw && str(crewRaw.name)
      ? { id: str(crewRaw.id) ?? '', name: str(crewRaw.name)!, tint: str(crewRaw.tint) ?? 'lilac' }
      : null;
  const roll =
    rollRaw && str(rollRaw.name)
      ? {
          id: str(rollRaw.id) ?? '',
          name: str(rollRaw.name)!,
          startsOn: str(rollRaw.starts_on),
          endsOn: str(rollRaw.ends_on),
          photoCount: num(rollRaw.photo_count),
          sealed: rollRaw.sealed === true,
          revealAt: str(rollRaw.reveal_at),
        }
      : null;
  const host = hostRaw
    ? { displayName: str(hostRaw.display_name) ?? '', avatarUrl: str(hostRaw.avatar_url) }
    : null;

  const facepile: InvitePerson[] = Array.isArray(root.facepile)
    ? root.facepile
        .map(obj)
        .filter((p): p is Record<string, unknown> => p !== null)
        .slice(0, 5)
        .map((p) => ({
          displayName: str(p.display_name) ?? '',
          avatarUrl: str(p.avatar_url),
          ringColor: str(p.ring_color),
        }))
    : [];

  const viewer = obj(root.viewer);
  return {
    status,
    kind,
    crew,
    roll,
    host: host && host.displayName ? host : null,
    memberCount: num(root.member_count),
    facepile,
    // The backend withholds the cover of sealed rolls; if it does send one we show it blurred.
    coverUrl: str(root.cover_url),
    requiresApproval: root.requires_approval === true,
    // Older/partial responses omit allow_guests; the join RPC is the real gate.
    allowGuests: root.allow_guests !== false,
    viewer: {
      isMember: viewer?.is_member === true,
      requestPending: viewer?.request_pending === true,
    },
  };
}

/** Server-side fetch of the public invite preview. Never throws. */
export async function loadInvite(code: string): Promise<InviteLoad> {
  if (!isValidInviteCode(code))
    return { ok: true, preview: { ...EMPTY_PREVIEW, status: 'not_found' } };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/invite-preview?code=${encodeURIComponent(code)}`,
      {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      },
    );
    if (res.status === 404) {
      return {
        ok: true,
        preview: { ...EMPTY_PREVIEW, status: 'not_found' },
      };
    }
    if (!res.ok) return { ok: false, reason: 'network' };
    const preview = parseInvitePreview(await res.json());
    return preview ? { ok: true, preview } : { ok: false, reason: 'network' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

const EMPTY_PREVIEW: InvitePreview = {
  status: 'not_found',
  kind: 'roll',
  crew: null,
  roll: null,
  host: null,
  memberCount: 0,
  facepile: [],
  coverUrl: null,
  requiresApproval: false,
  allowGuests: false,
  viewer: { isMember: false, requestPending: false },
};

/** What the page should show. */
export type InviteView =
  | { type: 'error' }
  | {
      type: 'dead';
      reason: Exclude<InviteStatus, 'ok'>;
      hostName: string | null;
      title: string | null;
    }
  | { type: 'live'; preview: InvitePreview };

export function inviteView(load: InviteLoad): InviteView {
  if (!load.ok) return { type: 'error' };
  const p = load.preview;
  if (p.status !== 'ok') {
    return {
      type: 'dead',
      reason: p.status,
      hostName: p.host?.displayName ?? null,
      title: p.roll?.name ?? p.crew?.name ?? null,
    };
  }
  return { type: 'live', preview: p };
}

/** Title of the invite target (Roll name for roll invites, Crew name for crew invites). */
export function inviteTitle(p: InvitePreview): string {
  return p.kind === 'roll' ? (p.roll?.name ?? p.crew?.name ?? 'Dumpr') : (p.crew?.name ?? 'Dumpr');
}

export interface EdgeCopy {
  headline: string;
  body: string;
  /** Primary action label, or null when there is nothing to ask for (error state). */
  ask: string | null;
  retry: boolean;
}

/** F6 edge-state copy. Never blames the user. */
export function edgeCopy(view: Exclude<InviteView, { type: 'live' }>): EdgeCopy {
  if (view.type === 'error') {
    return {
      headline: "We couldn't load this invite",
      body: 'Check your connection.',
      ask: null,
      retry: true,
    };
  }
  const who = view.hostName ?? 'the host';
  const ask = `Ask ${who} for a new one`;
  switch (view.reason) {
    case 'expired':
      return {
        headline: 'This invite link has expired',
        body: 'Links last 7 days unless the host changes it.',
        ask,
        retry: false,
      };
    case 'revoked':
      return {
        headline: 'This invite link was turned off',
        body: 'The host can send you a fresh one any time.',
        ask,
        retry: false,
      };
    case 'full':
      return {
        headline: 'This invite is full',
        body: 'The link reached its limit of people. The host can raise it.',
        ask: `Ask ${who} to add you`,
        retry: false,
      };
    default:
      return {
        headline: "We couldn't find this invite",
        body: 'The link may be incomplete or no longer exist.',
        ask,
        retry: false,
      };
  }
}
