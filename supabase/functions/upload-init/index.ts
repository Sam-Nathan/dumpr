// upload-init (architecture §8, §9): validates, checks access/quota, de-dupes by content hash,
// inserts the pending photo row (service role) and hands out presigned R2 URLs.
// Idempotent on photo_id: re-init of the caller's own pending photo returns fresh URLs (and
// re-uses the multipart upload, so parts already sent stay valid).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { r2Config } from '../_shared/env.ts';
import { HttpError, json, readJson, serve } from '../_shared/http.ts';
import { createR2, mediaKeys, type R2 } from '../_shared/r2.ts';
import {
  decideUploadAccess,
  parseUploadContext,
  validateInitRequest,
  type UploadContext,
  type UploadInitRequest,
  type UploadInitResponse,
} from '../../../packages/core/src/upload/index.ts';
import {
  canReuseMultipart,
  classifyDuplicate,
  classifyExisting,
  type DuplicateCandidate,
  type ExistingPhoto,
  type MediaUploadRow,
  planOriginal,
  uniqueViolation,
  urlsExpireAt,
} from './logic.ts';

const PHOTO_COLS = 'id, uploader_id, roll_id, crew_id, status, content_hash, bytes, mime, original_key, display_key, thumb_key, created_at';

async function loadContext(admin: SupabaseClient, userId: string, rollId: string): Promise<UploadContext | null> {
  const { data, error } = await admin.rpc('svc_upload_context', { p_user: userId, p_roll: rollId });
  if (error) throw error;
  return parseUploadContext(data);
}

async function loadGuestMax(admin: SupabaseClient, ctx: UploadContext | null): Promise<number | null> {
  if (!ctx?.is_guest) return null;
  if (ctx.guest_max_photos_per_roll !== null && ctx.guest_max_photos_per_roll !== undefined) {
    return ctx.guest_max_photos_per_roll;
  }
  const { data } = await admin.from('app_settings').select('value').eq('key', 'limits').maybeSingle();
  const v = (data?.value as { guest_max_photos_per_roll?: unknown } | null)?.guest_max_photos_per_roll;
  return typeof v === 'number' ? v : null;
}

function deny(d: { status: number; code: string }): never {
  const messages: Record<string, string> = {
    not_found: 'This Roll is no longer available',
    guests_not_allowed: 'The host has turned off guest uploads',
    uploads_disabled: 'The host has paused uploads to this Roll',
    not_a_member: "You're not in this Roll",
    payload_too_large: 'This photo is too big to upload',
    storage_full: 'Your storage is full',
    guest_limit_reached: "You've added the most photos a guest can",
  };
  throw new HttpError(d.status, d.code, messages[d.code] ?? d.code);
}

async function selectPhoto(admin: SupabaseClient, id: string): Promise<ExistingPhoto | null> {
  const { data, error } = await admin.from('photos').select(PHOTO_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as ExistingPhoto | null) ?? null;
}

async function selectDuplicate(admin: SupabaseClient, rollId: string, hash: string): Promise<DuplicateCandidate | null> {
  const { data, error } = await admin
    .from('photos')
    .select('id, uploader_id, status, created_at')
    .eq('roll_id', rollId)
    .eq('content_hash', hash)
    .neq('status', 'removed')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as DuplicateCandidate | null) ?? null;
}

/** Drops an abandoned pending row: aborts its multipart upload and queues its R2 keys for purge. */
async function dropStalePending(admin: SupabaseClient, r2: R2, id: string): Promise<void> {
  const photo = await selectPhoto(admin, id);
  if (!photo || photo.status !== 'pending') return;
  const { data: mu } = await admin.from('media_uploads').select('multipart_upload_id').eq('photo_id', id).maybeSingle();
  const uploadId = (mu as { multipart_upload_id: string | null } | null)?.multipart_upload_id;
  if (uploadId) await r2.abortMultipart(photo.original_key, uploadId).catch(() => {});
  const keys = [photo.original_key, photo.display_key, photo.thumb_key].map((key) => ({ key }));
  const { error: qErr } = await admin.from('media_purge_queue').upsert(keys, { onConflict: 'key', ignoreDuplicates: true });
  if (qErr) await r2.deleteObjects(keys.map((k) => k.key)).catch(() => {});
  // Only delete if still pending (it may have completed in the meantime).
  const { error } = await admin.from('photos').delete().eq('id', id).eq('status', 'pending');
  if (error) throw error;
}

async function chapterInRoll(admin: SupabaseClient, chapterId: string | null | undefined, rollId: string) {
  if (!chapterId) return null;
  const { data } = await admin
    .from('tags')
    .select('id')
    .eq('id', chapterId)
    .eq('roll_id', rollId)
    .eq('kind', 'chapter')
    .maybeSingle();
  // A chapter deleted while the photo sat in the queue must not lose the photo: drop the tag.
  return data ? chapterId : null;
}

async function issueUrls(
  admin: SupabaseClient,
  r2: R2,
  photo: ExistingPhoto,
  maxParts: number,
): Promise<UploadInitResponse> {
  const { data: muData, error: muErr } = await admin
    .from('media_uploads')
    .select('multipart_upload_id, part_size, parts')
    .eq('photo_id', photo.id)
    .maybeSingle();
  if (muErr) throw muErr;
  const mu = (muData as MediaUploadRow | null) ?? null;
  const plan = planOriginal(photo.bytes, maxParts, mu);
  const now = Date.now();
  const { expiresAt, multipartExpiresAt } = urlsExpireAt(now, plan.mode);

  const [display, thumb] = await Promise.all([
    r2.presignPut(photo.display_key, { contentType: 'image/jpeg' }),
    r2.presignPut(photo.thumb_key, { contentType: 'image/jpeg' }),
  ]);
  const jpeg = { 'content-type': 'image/jpeg' };

  let original: Extract<UploadInitResponse, { status: 'upload' }>['original'];
  if (plan.mode === 'put') {
    original = {
      mode: 'put',
      url: await r2.presignPut(photo.original_key, { contentType: photo.mime }),
      headers: { 'content-type': photo.mime },
    };
  } else {
    let uploadId: string;
    if (canReuseMultipart(mu, plan)) {
      uploadId = mu.multipart_upload_id;
    } else {
      if (mu?.multipart_upload_id) await r2.abortMultipart(photo.original_key, mu.multipart_upload_id).catch(() => {});
      uploadId = await r2.createMultipart(photo.original_key, photo.mime);
      const { error } = await admin.from('media_uploads').upsert(
        {
          photo_id: photo.id,
          multipart_upload_id: uploadId,
          part_size: plan.partSize,
          parts: plan.count,
          expires_at: multipartExpiresAt,
        },
        { onConflict: 'photo_id' },
      );
      if (error) {
        await r2.abortMultipart(photo.original_key, uploadId).catch(() => {});
        throw error;
      }
    }
    const parts = await Promise.all(
      Array.from({ length: plan.count }, async (_, i) => ({
        n: i + 1,
        url: await r2.presignPart(photo.original_key, uploadId, i + 1),
      })),
    );
    original = { mode: 'multipart', upload_id: uploadId, part_size: plan.partSize, parts };
  }

  return {
    status: 'upload',
    photo_id: photo.id,
    original,
    display: { url: display, headers: jpeg },
    thumb: { url: thumb, headers: jpeg },
    expires_at: expiresAt,
  };
}

async function initUpload(
  admin: SupabaseClient,
  r2: R2,
  userId: string,
  req: UploadInitRequest,
  ctx: UploadContext | null,
  depth = 0,
): Promise<UploadInitResponse> {
  const existing = await selectPhoto(admin, req.photo_id);
  if (existing) {
    const d = classifyExisting(existing, req, userId);
    if (d.kind === 'conflict') {
      throw new HttpError(409, d.code, d.code === 'photo_removed' ? 'This photo was removed' : 'This upload id is already in use');
    }
    if (d.kind === 'complete') return { status: 'duplicate', existing_photo_id: existing.id };
    // Resume: access is re-checked, size/quota/guest-count were checked on the first init.
    const access = decideUploadAccess(ctx);
    if (!access.ok) deny(access);
    return issueUrls(admin, r2, existing, ctx!.max_upload_parts);
  }

  const access = decideUploadAccess(ctx, { bytes: req.bytes, guestMaxPhotos: await loadGuestMax(admin, ctx) });
  if (!access.ok) deny(access);
  const c = ctx!;

  const dup = await selectDuplicate(admin, req.roll_id, req.content_hash);
  if (dup) {
    if (classifyDuplicate(dup, userId, Date.now()) === 'duplicate') {
      return { status: 'duplicate', existing_photo_id: dup.id };
    }
    await dropStalePending(admin, r2, dup.id);
  }

  const crewId = c.crew_id!;
  const row = {
    id: req.photo_id,
    crew_id: crewId,
    roll_id: req.roll_id,
    kind: 'roll',
    uploader_id: userId,
    chapter_id: await chapterInRoll(admin, req.chapter_id, req.roll_id),
    status: 'pending',
    content_hash: req.content_hash,
    mime: req.mime,
    bytes: req.bytes,
    width: req.width,
    height: req.height,
    taken_at: req.taken_at ?? null,
    caption: req.caption ?? null,
    original_key: mediaKeys.original(crewId, req.roll_id, req.photo_id),
    display_key: mediaKeys.display(crewId, req.roll_id, req.photo_id),
    thumb_key: mediaKeys.thumb(crewId, req.roll_id, req.photo_id),
  };
  const { data, error } = await admin.from('photos').insert(row).select(PHOTO_COLS).single();
  if (error) {
    // Lost a race with a concurrent init of the same photo or the same bytes: decide again.
    if (uniqueViolation(error) && depth < 2) return initUpload(admin, r2, userId, req, ctx, depth + 1);
    throw error;
  }
  return issueUrls(admin, r2, data as ExistingPhoto, c.max_upload_parts);
}

Deno.serve(
  serve(async (req) => {
    const { userId, admin } = await requireUser(req, { allowGuest: true });
    const v = validateInitRequest(await readJson(req));
    if (!v.ok) throw new HttpError(400, 'invalid_input', `Invalid ${v.field}`, { field: v.field });
    const cfg = r2Config();
    if (!cfg) throw new HttpError(503, 'storage_not_configured', 'Uploads are paused for now');
    const ctx = await loadContext(admin, userId, v.value.roll_id);
    const res = await initUpload(admin, createR2(cfg), userId, v.value, ctx);
    return json(res, 200, req);
  }),
);
