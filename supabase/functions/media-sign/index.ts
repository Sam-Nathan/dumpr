// media-sign: batch-sign R2 GET URLs. Visibility is decided by RLS: photos and profiles are selected
// through the caller's userClient, so anything the caller cannot see simply comes back as "unavailable".
import { HttpError, json, readJson, serve } from '../_shared/http.ts';
import { requireUser } from '../_shared/auth.ts';
import { r2Config } from '../_shared/env.ts';
import { createR2, type R2 } from '../_shared/r2.ts';
import {
  downloadName,
  isAvatarKey,
  itemKey,
  keyFor,
  originalAllowed,
  parseSignRequest,
  type PhotoRow,
  SIGN_TTL_S,
  type Unavailable,
} from './logic.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const IN_CHUNK = 100; // keep PostgREST URLs short

function chunks<T>(a: T[], n = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

async function selectIn<T>(db: SupabaseClient, table: string, cols: string, col: string, values: string[]): Promise<T[]> {
  const parts = await Promise.all(
    chunks(values).map(async (vals) => {
      const { data, error } = await db.from(table).select(cols).in(col, vals);
      if (error) throw error;
      return (data ?? []) as T[];
    }),
  );
  return parts.flat();
}

interface RollRow {
  id: string;
  name: string;
  crew_id: string;
  created_by: string | null;
  allow_downloads: boolean | null;
}

async function signItems(
  userId: string,
  userClient: SupabaseClient,
  r2: R2,
  items: { photo_id: string; variant: 'thumb' | 'display' | 'original' }[],
) {
  const ids = [...new Set(items.map((i) => i.photo_id))];
  const photos = new Map(
    (await selectIn<PhotoRow>(
      userClient,
      'photos',
      'id, crew_id, roll_id, uploader_id, thumb_key, display_key, original_key, status, mime',
      'id',
      ids,
    )).map((p) => [p.id, p]),
  );

  // Roll metadata is only needed for originals (allow_downloads, filename, admin check).
  const originals = items.filter((i) => i.variant === 'original' && photos.has(i.photo_id));
  const rollIds = [...new Set(originals.map((i) => photos.get(i.photo_id)!.roll_id).filter((x): x is string => !!x))];
  const rolls = new Map<string, RollRow>();
  const adminCrews = new Set<string>();
  if (rollIds.length) {
    for (const r of await selectIn<RollRow>(userClient, 'rolls', 'id, name, crew_id, created_by, allow_downloads', 'id', rollIds)) {
      rolls.set(r.id, r);
    }
    const crewIds = [...new Set([...rolls.values()].map((r) => r.crew_id))];
    if (crewIds.length) {
      for (const part of chunks(crewIds)) {
        const { data, error } = await userClient
          .from('crew_members')
          .select('crew_id, role')
          .eq('user_id', userId)
          .in('crew_id', part)
          .in('role', ['host', 'cohost']);
        if (error) throw error;
        for (const m of (data ?? []) as { crew_id: string }[]) adminCrews.add(m.crew_id);
      }
    }
  }

  const urls: Record<string, string> = {};
  const unavailable: Record<string, Unavailable> = {};
  await Promise.all(
    items.map(async (it) => {
      const k = itemKey(it.photo_id, it.variant);
      const p = photos.get(it.photo_id);
      if (!p || p.status === 'removed') {
        unavailable[k] = 'not_found';
        return;
      }
      if (it.variant === 'original') {
        const roll = p.roll_id ? rolls.get(p.roll_id) : undefined;
        if (p.roll_id && !roll) {
          // Roll not readable through RLS: treat like a missing photo.
          unavailable[k] = 'not_found';
          return;
        }
        const ok = originalAllowed({
          isUploader: p.uploader_id === userId,
          isAdmin: !!roll && (roll.created_by === userId || adminCrews.has(roll.crew_id)),
          allowDownloads: roll?.allow_downloads,
        });
        if (!ok) {
          unavailable[k] = 'downloads_disabled';
          return;
        }
        urls[k] = await r2.presignGet(keyFor(p, 'original'), {
          expiresIn: SIGN_TTL_S,
          downloadName: downloadName(roll?.name, p.id, p.mime),
        });
        return;
      }
      urls[k] = await r2.presignGet(keyFor(p, it.variant), { expiresIn: SIGN_TTL_S });
    }),
  );
  return { urls, unavailable };
}

async function signAvatars(userClient: SupabaseClient, r2: R2, keys: string[]) {
  // profiles RLS = self or shares a space, so strangers' avatars are not returned.
  const rows = await selectIn<{ avatar_key: string | null }>(userClient, 'profiles', 'avatar_key', 'avatar_key', keys);
  const allowed = new Set(rows.map((r) => r.avatar_key).filter((k): k is string => !!k && isAvatarKey(k)));
  const urls: Record<string, string> = {};
  const unavailable: Record<string, Unavailable> = {};
  await Promise.all(
    keys.map(async (k) => {
      if (!allowed.has(k)) unavailable[k] = 'not_found';
      else urls[k] = await r2.presignGet(k, { expiresIn: SIGN_TTL_S });
    }),
  );
  return { urls, unavailable };
}

const handler = serve(async (req) => {
  const { userId, userClient } = await requireUser(req, { allowGuest: true });
  const parsed = parseSignRequest(await readJson(req, 64_000));
  const cfg = r2Config();
  if (!cfg) throw new HttpError(503, 'storage_not_configured', 'Photos are temporarily unavailable');
  const r2 = createR2(cfg);
  const expires_at = new Date(Date.now() + SIGN_TTL_S * 1000).toISOString();
  const result = parsed.kind === 'items'
    ? await signItems(userId, userClient, r2, parsed.items)
    : await signAvatars(userClient, r2, parsed.keys);
  // `urls` keys: "<photo_id>:<variant>" for items, the avatar key itself for avatars.
  // `unavailable` lists requested keys that were not signed and why (not_found | downloads_disabled).
  return json({ urls: result.urls, unavailable: result.unavailable, expires_at }, 200, req, {
    'cache-control': 'private, no-store',
  });
}, ['POST']);

Deno.serve(handler);
