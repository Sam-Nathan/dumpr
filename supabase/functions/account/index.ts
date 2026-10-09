// account: data export (manifest with 24 h original URLs) and account deletion.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError, json, readJson, serve } from '../_shared/http.ts';
import { requireUser } from '../_shared/auth.ts';
import { r2Config } from '../_shared/env.ts';
import { createR2 } from '../_shared/r2.ts';
import { downloadName } from '../media-sign/logic.ts';
import {
  buildExport,
  crewsFromMembership,
  EXPORT_CAP,
  EXPORT_PAGE,
  EXPORT_TTL_S,
  type ExportPhoto,
  lastHostError,
  parseAccountRequest,
  parseSummary,
  purgeKeys,
} from './logic.ts';

interface ExportPhotoRow {
  id: string;
  roll_id: string | null;
  taken_at: string | null;
  caption: string | null;
  original_key: string;
  mime: string | null;
}

async function exportData(admin: SupabaseClient, userId: string, req: Request) {
  const cfg = r2Config();
  if (!cfg) throw new HttpError(503, 'storage_not_configured', 'Export is temporarily unavailable');
  const r2 = createR2(cfg);

  const [{ data: profile, error: pErr }, { data: members, error: mErr }] = await Promise.all([
    admin.from('profiles').select('id, display_name, handle, avatar_key, ring_color, birthday_day, birthday_month, is_guest, created_at').eq('id', userId).maybeSingle(),
    admin.from('crew_members').select('role, crews(id, name, deleted_at)').eq('user_id', userId),
  ]);
  if (pErr) throw pErr;
  if (mErr) throw mErr;

  const photos: ExportPhoto[] = [];
  let truncated = false;
  let after: string | null = null;
  const rollNames = new Map<string, string>();
  while (photos.length < EXPORT_CAP) {
    let q = admin
      .from('photos')
      .select('id, roll_id, taken_at, caption, original_key, mime')
      .eq('uploader_id', userId)
      .neq('status', 'removed')
      .order('id', { ascending: true })
      .limit(Math.min(EXPORT_PAGE, EXPORT_CAP - photos.length + 1));
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as ExportPhotoRow[];
    if (rows.length === 0) break;
    const room = EXPORT_CAP - photos.length;
    const take = rows.slice(0, room);
    if (rows.length > room) truncated = true;
    after = rows[rows.length - 1].id;

    const missing = [...new Set(take.map((r) => r.roll_id).filter((x): x is string => !!x && !rollNames.has(x)))];
    if (missing.length) {
      const { data: rolls, error: rErr } = await admin.from('rolls').select('id, name').in('id', missing);
      if (rErr) throw rErr;
      for (const r of (rolls ?? []) as { id: string; name: string }[]) rollNames.set(r.id, r.name);
    }
    const signed = await Promise.all(
      take.map(async (r): Promise<ExportPhoto> => {
        const rollName = r.roll_id ? rollNames.get(r.roll_id) ?? null : null;
        return {
          id: r.id,
          roll_id: r.roll_id,
          roll_name: rollName,
          taken_at: r.taken_at,
          caption: r.caption,
          url: await r2.presignGet(r.original_key, { expiresIn: EXPORT_TTL_S, downloadName: downloadName(rollName, r.id, r.mime) }),
        };
      }),
    );
    photos.push(...signed);
    if (truncated || rows.length < Math.min(EXPORT_PAGE, room + 1)) break;
  }

  return json(
    buildExport({ profile, crews: crewsFromMembership((members ?? []) as { role: string; crews: unknown }[]), photos, truncated }),
    200,
    req,
    { 'cache-control': 'private, no-store' },
  );
}

async function deleteAccount(admin: SupabaseClient, userId: string, req: Request) {
  const { data, error } = await admin.rpc('svc_account_summary', { p_user: userId });
  if (error) throw error;
  const summary = parseSummary(data);
  if (summary.sole_host_crews.length > 0) throw lastHostError(summary.sole_host_crews);

  // Queue R2 objects first: the photo rows (and their keys) cascade away with the auth user.
  const { data: prof } = await admin.from('profiles').select('avatar_key').eq('id', userId).maybeSingle();
  const avatar = (prof as { avatar_key?: string | null } | null)?.avatar_key ?? null;
  let queued = 0;
  let after: string | null = null;
  for (;;) {
    let q = admin
      .from('photos')
      .select('id, original_key, display_key, thumb_key')
      .eq('uploader_id', userId)
      .order('id', { ascending: true })
      .limit(1000);
    if (after) q = q.gt('id', after);
    const { data: rows, error: pErr } = await q;
    if (pErr) throw pErr;
    const list = (rows ?? []) as { id: string; original_key: string; display_key: string; thumb_key: string }[];
    const keys = purgeKeys(list, after === null ? avatar : null);
    if (keys.length) {
      const { error: qErr } = await admin
        .from('media_purge_queue')
        .upsert(keys.map((key) => ({ key })), { onConflict: 'key', ignoreDuplicates: true });
      if (qErr) throw qErr; // abort before deleting anything: no orphaned objects
      queued += keys.length;
    }
    if (list.length < 1000) break;
    after = list[list.length - 1].id;
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) throw new HttpError(500, 'delete_failed', 'We could not delete your account. Please try again');
  return json({ deleted: true, queued_keys: queued }, 200, req);
}

const handler = serve(async (req) => {
  const { userId, admin } = await requireUser(req, { allowGuest: true });
  const body = parseAccountRequest(await readJson(req, 4_000));
  return body.action === 'export' ? await exportData(admin, userId, req) : await deleteAccount(admin, userId, req);
}, ['POST']);

Deno.serve(handler);
