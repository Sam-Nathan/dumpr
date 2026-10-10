/**
 * Invite deep links. Pure module, unit-tested.
 *
 *   https://dumpr.app/r/<code>   roll invite       dumpr://r/<code>
 *   https://dumpr.app/c/<code>   crew invite       dumpr://c/<code>
 *
 * Both land on the `invite/[code]` route; the kind (roll | crew) comes from the invite preview.
 */

export type InviteKind = 'roll' | 'crew';

export interface ParsedInvite {
  code: string;
  /** Kind implied by the link path; a bare code has none. */
  kind: InviteKind | null;
}

const WEB_HOSTS = new Set(['dumpr.app', 'www.dumpr.app']);
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/;
/** A bare pasted code: stricter than a URL path so ordinary words are not treated as codes. */
const BARE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{5,31}$/;

const KIND_BY_SEGMENT: Record<string, InviteKind> = { r: 'roll', c: 'crew' };

function fromPath(path: string): ParsedInvite | null {
  const segments = path.split('/').filter(Boolean);
  const [head, code] = segments;
  if (!head || !code) return null;
  const kind = KIND_BY_SEGMENT[head.toLowerCase()];
  if (!kind) return null;
  const clean = decodeURIComponent(code);
  if (!CODE_RE.test(clean)) return null;
  return { code: clean.toLowerCase(), kind };
}

/**
 * Parse whatever a person pastes or a scanner reads: a full link, a link without scheme
 * ("dumpr.app/r/abc"), an app-scheme link, or a bare code. Returns null when it is not an invite.
 */
export function parseInviteLink(input: string | null | undefined): ParsedInvite | null {
  const text = (input ?? '').trim();
  if (!text) return null;

  // dumpr://r/<code>  (host is the kind segment)
  const scheme = /^dumpr:\/\/([^?#]*)/i.exec(text);
  if (scheme) {
    try {
      return fromPath(scheme[1] ?? '');
    } catch {
      return null;
    }
  }

  // An app path as expo-router hands it over: "/r/<code>" (or "r/<code>").
  if (/^\/?[rc]\/[^/]+\/?(?:[?#].*)?$/i.test(text)) {
    try {
      return fromPath(text.split(/[?#]/)[0] ?? '');
    } catch {
      return null;
    }
  }

  // https://dumpr.app/r/<code>, http://, or no scheme at all.
  const web = /^(?:https?:\/\/)?([a-z0-9.-]+)(\/[^?#\s]*)/i.exec(text);
  if (web && WEB_HOSTS.has((web[1] ?? '').toLowerCase())) {
    try {
      return fromPath(web[2] ?? '');
    } catch {
      return null;
    }
  }

  if (BARE_CODE_RE.test(text)) return { code: text.toLowerCase(), kind: null };
  return null;
}

/** App route for an invite code. */
export function inviteHref(code: string): `/invite/${string}` {
  return `/invite/${encodeURIComponent(code)}`;
}

/** Shareable https link for an invite. */
export function inviteUrl(code: string, kind: InviteKind, origin = 'https://dumpr.app'): string {
  return `${origin.replace(/\/$/, '')}/${kind === 'roll' ? 'r' : 'c'}/${code}`;
}

/**
 * expo-router native-intent rewrite: map an incoming system URL/path to an in-app path.
 * Invite links become `/invite/<code>`; anything else is passed through untouched.
 */
export function rewriteIncomingPath(path: string): string {
  const invite = parseInviteLink(path);
  // Only rewrite explicit invite links (not bare strings that merely look like codes).
  if (invite && invite.kind) return inviteHref(invite.code);
  return path;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Push notification tap -> in-app path. push-dispatch puts `data.url` on every notification:
 * `dumpr://roll/<id>`, `crew/<id>`, `photo/<id>`, `invite/<code>`, `chat/<url-encoded thread key>` and
 * `inbox`. Invite web links (`https://dumpr.app/r/<code>`) work too. Returns null for anything else so a
 * malformed or foreign url never navigates.
 */
export function notificationUrlToPath(url: string | null | undefined): string | null {
  const text = (url ?? '').trim();
  if (!text) return null;
  const m = /^dumpr:\/\/([a-z]+)(?:\/([^/?#]+))?\/?(?:[?#].*)?$/i.exec(text);
  if (m) {
    const head = (m[1] ?? '').toLowerCase();
    const arg = m[2];
    if (head === 'inbox') return '/inbox';
    if (!arg) return null;
    if (head === 'chat') {
      let key: string;
      try {
        key = decodeURIComponent(arg);
      } catch {
        return null;
      }
      return /^[cr]:[A-Za-z0-9_-]{1,64}$/.test(key) ? `/chat/${encodeURIComponent(key)}` : null;
    }
    if (!ID_RE.test(arg)) return null;
    if (head === 'roll' || head === 'crew' || head === 'photo') return `/${head}/${arg}`;
    if (head === 'invite') return inviteHref(arg);
    // dumpr://r/<code> and dumpr://c/<code> are the shareable invite links
    const invite = parseInviteLink(text);
    return invite?.kind ? inviteHref(invite.code) : null;
  }
  const invite = /^https?:\/\//i.test(text) ? parseInviteLink(text) : null;
  return invite?.kind ? inviteHref(invite.code) : null;
}
