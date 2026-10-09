// Pure helpers for media-sign (no I/O): request parsing, key selection, download naming, access rule.
import { HttpError, isUuid } from '../_shared/http.ts';
import { avatarKeyOwner } from '../_shared/r2.ts';

/** Every signed GET URL has at least this long to live when it is handed out. */
export const MIN_VALID_S = 6 * 60 * 60; // 6 h
/**
 * URLs are signed at the top of the hour (see signingHour) and valid for 7 h from THAT instant, so a URL handed
 * out at 10:59:59 still has >= 6 h left, and every request within an hour gets the byte-identical URL (the
 * browser / expo-image HTTP cache can reuse it).
 */
export const SIGN_TTL_S = MIN_VALID_S + 60 * 60;
/** Sent as response-cache-control: the object may be cached privately for as long as the URL is guaranteed valid. */
export const GET_CACHE_CONTROL = `private, max-age=${MIN_VALID_S}`;

/** `now` rounded down to the hour: the SigV4 timestamp of every URL signed during that hour. */
export function signingHour(now: number = Date.now()): Date {
  return new Date(Math.floor(now / 3_600_000) * 3_600_000);
}

/** When URLs signed at `signedAt` stop working. */
export function urlExpiry(signedAt: Date): Date {
  return new Date(signedAt.getTime() + SIGN_TTL_S * 1000);
}
export const MAX_ITEMS = 300;
export const MAX_AVATARS = 100;

export const VARIANTS = ['thumb', 'display', 'original'] as const;
export type Variant = (typeof VARIANTS)[number];

export interface SignItem {
  photo_id: string;
  variant: Variant;
}

export type SignRequest = { kind: 'items'; items: SignItem[] } | { kind: 'avatars'; keys: string[] };

/** Shape of an avatar key: a/<user id>/<uuid>.jpg (nothing else is ever signed through the avatar path). */
export function isAvatarKey(k: unknown): k is string {
  return avatarKeyOwner(k) !== null;
}

/**
 * Avatar keys the caller may get a URL for. `rows` are the profiles the caller can read (RLS): a key is
 * signed only when it sits under that very profile's own prefix, because profiles.avatar_key is
 * client-writable (it must never lead to an original, a display / thumb, or another user's files).
 */
export function signableAvatarKeys(rows: ReadonlyArray<{ id: string; avatar_key: string | null }>, requested: readonly string[]): Set<string> {
  const want = new Set(requested);
  const out = new Set<string>();
  for (const r of rows) {
    const k = r.avatar_key;
    if (!k || !want.has(k) || !isAvatarKey(k)) continue;
    if (k.startsWith(`a/${String(r.id).toLowerCase()}/`)) out.add(k);
  }
  return out;
}

export const itemKey = (photoId: string, variant: Variant) => `${photoId}:${variant}`;

export function parseSignRequest(body: unknown): SignRequest {
  const b = (body ?? {}) as { items?: unknown; avatar_keys?: unknown };
  const hasItems = b.items !== undefined;
  const hasAvatars = b.avatar_keys !== undefined;
  if (hasItems === hasAvatars) {
    throw new HttpError(400, 'invalid_input', 'Send either items or avatar_keys');
  }
  if (hasItems) {
    if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > MAX_ITEMS) {
      throw new HttpError(400, 'invalid_input', `items must hold 1 to ${MAX_ITEMS} entries`);
    }
    const seen = new Set<string>();
    const items: SignItem[] = [];
    for (const raw of b.items as Array<{ photo_id?: unknown; variant?: unknown }>) {
      const id = typeof raw?.photo_id === 'string' ? raw.photo_id.toLowerCase() : '';
      const variant = raw?.variant;
      if (!isUuid(id) || !(VARIANTS as readonly unknown[]).includes(variant)) {
        throw new HttpError(400, 'invalid_input', 'Each item needs a photo_id and a variant');
      }
      const k = itemKey(id, variant as Variant);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ photo_id: id, variant: variant as Variant });
    }
    return { kind: 'items', items };
  }
  const keys = b.avatar_keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_AVATARS || !keys.every(isAvatarKey)) {
    throw new HttpError(400, 'invalid_input', `avatar_keys must hold 1 to ${MAX_AVATARS} keys starting with a/`);
  }
  return { kind: 'avatars', keys: [...new Set(keys as string[])] };
}

/** A row of public.photos_by_ids(): the photo + what the caller may do with its roll (all decided by RLS in the DB). */
export interface PhotoRow {
  id: string;
  crew_id: string;
  roll_id: string | null;
  uploader_id: string;
  thumb_key: string;
  display_key: string;
  original_key: string;
  status: 'pending' | 'ready' | 'review' | 'removed';
  mime?: string | null;
  /** false = the photo is readable but its roll is not (treated like a missing photo for originals) */
  roll_visible: boolean;
  roll_name: string | null;
  allow_downloads: boolean | null;
  is_uploader: boolean;
  /** rolls.created_by or host / cohost of the roll's crew */
  is_admin: boolean;
}

export function keyFor(p: Pick<PhotoRow, 'thumb_key' | 'display_key' | 'original_key'>, v: Variant): string {
  return v === 'thumb' ? p.thumb_key : v === 'display' ? p.display_key : p.original_key;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

export function extFor(mime: string | null | undefined): string {
  return EXT[String(mime ?? '').toLowerCase()] ?? 'jpg';
}

/** `dumpr-<roll>-<photo_id>.<ext>`, ASCII-safe so it is valid inside a quoted header value. */
export function downloadName(rollName: string | null | undefined, photoId: string, mime: string | null | undefined): string {
  const slug = String(rollName ?? 'roll')
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `dumpr-${slug || 'roll'}-${photoId}.${extFor(mime)}`;
}

export type Unavailable = 'not_found' | 'downloads_disabled';

/** Originals: allowed when downloads are on, or the caller is the uploader or a roll admin. */
export function originalAllowed(a: { isUploader: boolean; isAdmin: boolean; allowDownloads: boolean | null | undefined }): boolean {
  return a.isUploader || a.isAdmin || a.allowDownloads !== false;
}
