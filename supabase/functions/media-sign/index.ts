// media-sign: batch-sign R2 GET URLs. Visibility is decided by RLS: photos come from photos_by_ids() (security invoker) and
// profiles are selected, both through the caller's userClient, so anything the caller cannot see comes back as "unavailable".
import { HttpError, json, readJson, serve } from '../_shared/http.ts';
import { requireUser } from '../_shared/auth.ts';
import { r2Config } from '../_shared/env.ts';
import { createR2, type R2 } from '../_shared/r2.ts';
import {
  downloadName,
  GET_CACHE_CONTROL,
  itemKey,
  keyFor,
  originalAllowed,
  parseSignRequest,
  type PhotoRow,
  SIGN_TTL_S,
  signableAvatarKeys,
  signingHour,
  type Unavailable,
  urlExpiry,
} from './logic.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const IN_CHUNK = 100; // keep PostgREST URLs short

type GetOpts = { expiresIn: number; signedAt: Date; cacheControl: string };

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

async function signItems(
  userClient: SupabaseClient,
  r2: R2,
  items: { photo_id: string; variant: 'thumb' | 'display' | 'original' }[],
  get: GetOpts,
) {
  // ONE request: photos + roll name / allow_downloads + uploader / admin flags, all decided by RLS in the DB
  // (ids that are not readable are simply absent). Replaces three PostgREST round trips.
  const ids = [...new Set(items.map((i) => i.photo_id))];
  const { data, error } = await userClient.rpc('photos_by_ids', { p_ids: ids });
  if (error) throw error;
  const photos = new Map(((data ?? []) as PhotoRow[]).map((p) => [p.id, p]));

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
        if (p.roll_id && !p.roll_visible) {
          // Roll not readable through RLS: treat like a missing photo.
          unavailable[k] = 'not_found';
          return;
        }
        const ok = originalAllowed({ isUploader: p.is_uploader, isAdmin: p.is_admin, allowDownloads: p.allow_downloads });
        if (!ok) {
          unavailable[k] = 'downloads_disabled';
          return;
        }
        urls[k] = await r2.presignGet(keyFor(p, 'original'), {
          ...get,
          downloadName: downloadName(p.roll_name, p.id, p.mime),
        });
        return;
      }
      urls[k] = await r2.presignGet(keyFor(p, it.variant), get);
    }),
  );
  return { urls, unavailable };
}

async function signAvatars(userClient: SupabaseClient, r2: R2, keys: string[], get: GetOpts) {
  // profiles RLS = self or shares a space, so strangers' avatars are not returned.
  const rows = await selectIn<{ id: string; avatar_key: string | null }>(userClient, 'profiles', 'id, avatar_key', 'avatar_key', keys);
  const allowed = signableAvatarKeys(rows, keys);
  const urls: Record<string, string> = {};
  const unavailable: Record<string, Unavailable> = {};
  await Promise.all(
    keys.map(async (k) => {
      if (!allowed.has(k)) unavailable[k] = 'not_found';
      else urls[k] = await r2.presignGet(k, get);
    }),
  );
  return { urls, unavailable };
}

const handler = serve(async (req) => {
  const { userClient } = await requireUser(req, { allowGuest: true });
  const parsed = parseSignRequest(await readJson(req, 64_000));
  const cfg = r2Config();
  if (!cfg) throw new HttpError(503, 'storage_not_configured', 'Photos are temporarily unavailable');
  const r2 = createR2(cfg);
  // Signed at the top of the hour: same input -> same URL for the whole hour (HTTP-cacheable), and >= 6 h left.
  const signedAt = signingHour();
  const get: GetOpts = { expiresIn: SIGN_TTL_S, signedAt, cacheControl: GET_CACHE_CONTROL };
  const expires_at = urlExpiry(signedAt).toISOString();
  const result = parsed.kind === 'items'
    ? await signItems(userClient, r2, parsed.items, get)
    : await signAvatars(userClient, r2, parsed.keys, get);
  // `urls` keys: "<photo_id>:<variant>" for items, the avatar key itself for avatars.
  // `unavailable` lists requested keys that were not signed and why (not_found | downloads_disabled).
  return json({ urls: result.urls, unavailable: result.unavailable, expires_at }, 200, req, {
    'cache-control': 'private, no-store',
  });
}, ['POST']);

Deno.serve(handler);
