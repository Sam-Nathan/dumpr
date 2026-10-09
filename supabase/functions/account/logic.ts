// Pure helpers for the account function.
import { HttpError } from '../_shared/http.ts';
import { isAvatarKeyOf } from '../_shared/r2.ts';

export const EXPORT_TTL_S = 24 * 60 * 60; // 24 h
export const EXPORT_CAP = 5000;
export const EXPORT_PAGE = 500;

export type AccountRequest = { action: 'export' } | { action: 'delete' };

export function parseAccountRequest(body: unknown): AccountRequest {
  const b = (body ?? {}) as { action?: unknown; confirm?: unknown };
  if (b.action === 'export') return { action: 'export' };
  if (b.action === 'delete') {
    if (b.confirm !== 'DELETE') throw new HttpError(400, 'invalid_input', 'Type DELETE to confirm');
    return { action: 'delete' };
  }
  throw new HttpError(400, 'invalid_input', 'action must be export or delete');
}

export interface SoleHostCrew {
  id: string;
  name: string;
}

export interface AccountSummary {
  sole_host_crews: SoleHostCrew[];
  photo_keys_count: number;
}

export function parseSummary(data: unknown): AccountSummary {
  const d = (Array.isArray(data) ? data[0] : data) as Partial<AccountSummary> | null | undefined;
  const crews = Array.isArray(d?.sole_host_crews) ? d!.sole_host_crews! : [];
  return {
    sole_host_crews: crews.filter((c): c is SoleHostCrew => !!c && typeof c.id === 'string').map((c) => ({ id: c.id, name: String(c.name ?? '') })),
    photo_keys_count: Number(d?.photo_keys_count ?? 0) || 0,
  };
}

/** 409 last_host with the crews the user must hand over first. */
export function lastHostError(crews: SoleHostCrew[]): HttpError {
  return new HttpError(409, 'last_host', 'Transfer host in these Crews before deleting your account', { crews });
}

/**
 * The avatar object to purge with the account: only a key under the user's own prefix. profiles.avatar_key is
 * client-writable, so anything else (an original, another user's avatar) must never reach the purge queue.
 */
export function ownAvatarKey(userId: string, key: unknown): string | null {
  return isAvatarKeyOf(userId, key) ? key : null;
}

export interface KeyRow {
  original_key?: string | null;
  display_key?: string | null;
  thumb_key?: string | null;
}

/** All R2 objects owned by a user's photos (+ avatar), de-duplicated, empty keys dropped. */
export function purgeKeys(rows: readonly KeyRow[], avatarKey?: string | null): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const k of [r.original_key, r.display_key, r.thumb_key]) if (k) keys.add(k);
  if (avatarKey) keys.add(avatarKey);
  return [...keys];
}

export interface ExportPhoto {
  id: string;
  roll_id: string | null;
  roll_name: string | null;
  taken_at: string | null;
  caption: string | null;
  url: string;
}

export function buildExport(input: {
  profile: unknown;
  crews: { id: string; name: string; role: string }[];
  photos: ExportPhoto[];
  truncated: boolean;
  now?: Date;
}) {
  return {
    exported_at: (input.now ?? new Date()).toISOString(),
    url_expires_in_hours: EXPORT_TTL_S / 3600,
    profile: input.profile,
    crews: input.crews,
    photos: input.photos,
    truncated: input.truncated,
  };
}

/** Flattens `crew_members` rows joined with `crews` (PostgREST returns the relation as object or array). */
export function crewsFromMembership(rows: readonly { role: string; crews: unknown }[]): { id: string; name: string; role: string }[] {
  const out: { id: string; name: string; role: string }[] = [];
  for (const r of rows) {
    const c = (Array.isArray(r.crews) ? r.crews[0] : r.crews) as { id?: string; name?: string; deleted_at?: string | null } | null;
    if (c?.id && !c.deleted_at) out.push({ id: c.id, name: String(c.name ?? ''), role: r.role });
  }
  return out;
}
