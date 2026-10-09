// Pure helpers for invite-preview: code validation and decorating the RPC result with signed URLs.

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
  if (p.status !== 'ok') return { ...rest, cover_url: null };
  const safe = async (key: string | null | undefined): Promise<string | null> => {
    if (!key || !sign) return null;
    try {
      return await sign(key);
    } catch {
      return null;
    }
  };
  const withAvatar = async (x: PreviewPerson): Promise<PreviewPerson> => ({ ...x, avatar_url: await safe(x.avatar_key) });
  const [cover_url, host, facepile] = await Promise.all([
    shouldSignCover(p) ? safe(p.cover_thumb_key) : Promise.resolve(null),
    p.host ? withAvatar(p.host) : Promise.resolve(p.host ?? null),
    Promise.all((p.facepile ?? []).slice(0, 5).map(withAvatar)),
  ]);
  return { ...rest, host, facepile, cover_url };
}
