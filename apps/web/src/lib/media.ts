import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import { errorCodeOf } from './errors';

export type MediaVariant = 'thumb' | 'display' | 'original';
export interface MediaItem {
  photo_id: string;
  variant: MediaVariant;
}

export const mediaKey = (photoId: string, variant: MediaVariant) => `${photoId}:${variant}`;

export function buildSignBody(items: MediaItem[]) {
  return { items };
}

/** Pulls `urls` out of a media-sign response, dropping anything that is not an http(s) URL. */
export function parseSignResponse(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const urls = body && typeof body === 'object' ? (body as { urls?: unknown }).urls : null;
  if (!urls || typeof urls !== 'object') return out;
  for (const [k, v] of Object.entries(urls as Record<string, unknown>)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v)) out[k] = v;
  }
  return out;
}

export class MediaSignError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** POST functions/v1/media-sign as the signed-in (guest) user. Keys are `photo_id:variant`. */
export async function signMedia(
  accessToken: string,
  items: MediaItem[],
): Promise<Record<string, string>> {
  if (items.length === 0) return {};
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/media-sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildSignBody(items)),
    });
  } catch {
    throw new MediaSignError('network');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through with null body
  }
  if (!res.ok) throw new MediaSignError(errorCodeOf(body) ?? 'unknown');
  return parseSignResponse(body);
}
