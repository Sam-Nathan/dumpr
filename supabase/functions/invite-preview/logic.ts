// Pure helpers for invite-preview: code validation and decorating the RPC result with signed URLs.
import { avatarKeyOwner } from '../_shared/r2.ts';

export const COVER_TTL_S = 60 * 60; // 1 h
export const CODE_RE = /^[a-z0-9]{6,16}$/i;

export interface PreviewPerson {
  display_name?: string;
  avatar_key?: string | null;
  ring_color?: string;
  avatar_url?: string | null;
  [k: string]: unknown;
}

export interface InvitePreview {
  status: 'ok' | 'expired' | 'revoked' | 'full' | 'not_found';
  kind?: 'crew' | 'roll';
  roll?: { sealed?: boolean; [k: string]: unknown } | null;
  host?: PreviewPerson | null;
  facepile?: PreviewPerson[] | null;
  cover_thumb_key?: string | null;
  [k: string]: unknown;
}

export type Signer = (key: string) => Promise<string>;

/**
 * The caller's user access token, if the request carries one. The public anon / publishable key (the
 * usual `Authorization: Bearer <apikey>` of an unauthenticated client) is not a user: null.
 */
export function userAccessToken(authorization: string | null | undefined, anonKey: string | null | undefined): string | null {
  const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token === anonKey) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))) as { role?: unknown };
    return payload.role === 'authenticated' ? token : null;
  } catch {
    return null;
  }
}

/** Anonymous previews are identical for everyone (cacheable); previews computed for a user never are. */
export const cacheControlFor = (asUser: boolean) => (asUser ? 'private, no-store' : 'public, max-age=60');

/**
 * A dead link (revoked / expired / full / unknown) shows nothing about the crew. The host's first name
 * stays so the page can say "Ask <host> for a new link".
 */
export function deadLinkPreview(p: InvitePreview): Record<string, unknown> {
  const out: Record<string, unknown> = { status: p.status, cover_url: null };
  if (p.kind) out.kind = p.kind;
  const name = p.host?.display_name;
  if (p.status !== 'not_found' && typeof name === 'string') out.host = { display_name: name };
  return out;
}

/** Cover is only signed for a live invite to an unsealed roll. */
export function shouldSignCover(p: InvitePreview): boolean {
  return p.status === 'ok' && !!p.cover_thumb_key && !(p.roll?.sealed === true);
}

/**
 * Returns the public payload: raw `cover_thumb_key` is dropped, `cover_url` and `avatar_url`s are added.
 * `sign` may be null when storage is not configured: URLs are then null and the rest is still served.
 */
export async function decoratePreview(p: InvitePreview, sign: Signer | null): Promise<Record<string, unknown>> {
  const { cover_thumb_key: _drop, ...rest } = p;
  if (p.status !== 'ok') return deadLinkPreview(p);
  // Only genuine avatar keys (a/<user>/<uuid>.jpg) are ever signed: profiles.avatar_key is client-writable and
  // must not be a way to get a URL for an original / display / thumb. (The RPC already drops keys that are
  // not under the profile's own id; this is the shape check on top.)
  const safe = async (key: string | null | undefined): Promise<string | null> => {
    if (!key || !sign) return null;
    try {
      return await sign(key);
    } catch {
      return null;
    }
  };
  const withAvatar = async (x: PreviewPerson): Promise<PreviewPerson> => ({
    ...x,
    avatar_url: avatarKeyOwner(x.avatar_key) ? await safe(x.avatar_key) : null,
  });
  const [cover_url, host, facepile] = await Promise.all([
    shouldSignCover(p) ? safe(p.cover_thumb_key) : Promise.resolve(null),
    p.host ? withAvatar(p.host) : Promise.resolve(p.host ?? null),
    Promise.all((p.facepile ?? []).slice(0, 5).map(withAvatar)),
  ]);
  return { ...rest, host, facepile, cover_url };
}
