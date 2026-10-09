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
