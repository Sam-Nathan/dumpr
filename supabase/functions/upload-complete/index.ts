// upload-complete (architecture §8, §9): completes a multipart original, HEADs all three objects
// (size; single-PUT ETag = md5 of content_hash), then flips the photo to 'ready' — or 'review' for
// guests when the host asked to review guest uploads. DB triggers do the counters.
// Verification failures answer 422 upload_incomplete with the variants to re-PUT.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { r2Config } from '../_shared/env.ts';
import { HttpError, json, readJson, serve } from '../_shared/http.ts';
import { createR2, type R2 } from '../_shared/r2.ts';
import {
  decideUploadAccess,
  parseUploadContext,
  partsAreComplete,
  validateCompleteRequest,
  type UploadCompleteResponse,
  type UploadedPhoto,
  type UploadVariant,
} from '../../../packages/core/src/upload/index.ts';
import { classifyCompleteMultipartError, incompleteDetails, verifyObjects } from './logic.ts';

const RETURN_COLS =
  'id, crew_id, roll_id, uploader_id, chapter_id, status, visibility, content_hash, mime, bytes, width, height, taken_at, sort_at, thumb_key, display_key, blurhash, caption, created_at';

interface PhotoRow extends UploadedPhoto {
  original_key: string;
}

interface MediaUpload {
  multipart_upload_id: string | null;
  part_size: number | null;
  parts: number | null;
  display_bytes: number | null;
  thumb_bytes: number | null;
}

/** Forget the multipart upload but keep the recorded variant sizes (the next init signs and records them again). */
async function forgetMultipart(admin: SupabaseClient, photoId: string) {
  await admin
    .from('media_uploads')
    .update({ multipart_upload_id: null, part_size: null, parts: null })
    .eq('photo_id', photoId);
}

function incomplete(missing: UploadVariant[], extra: { reset_parts?: boolean; restart_multipart?: boolean } = {}): never {
  throw new HttpError(422, 'upload_incomplete', 'Some of this photo did not arrive. Sending it again', incompleteDetails(missing, extra));
}

async function dropMultipart(admin: SupabaseClient, r2: R2, photo: PhotoRow, uploadId: string) {
  await r2.abortMultipart(photo.original_key, uploadId).catch(() => {});
  await forgetMultipart(admin, photo.id);
}

Deno.serve(
  serve(async (req) => {
    const { userId, admin } = await requireUser(req, { allowGuest: true });
    const v = validateCompleteRequest(await readJson(req));
    if (!v.ok) throw new HttpError(400, 'invalid_input', `Invalid ${v.field}`, { field: v.field });
    const body = v.value;
    const cfg = r2Config();
    if (!cfg) throw new HttpError(503, 'storage_not_configured', 'Uploads are paused for now');
    const r2 = createR2(cfg);

    const { data: pData, error: pErr } = await admin
      .from('photos')
      .select(`${RETURN_COLS}, original_key`)
      .eq('id', body.photo_id)
      .maybeSingle();
    if (pErr) throw pErr;
    const photo = pData as PhotoRow | null;
    if (!photo || photo.uploader_id !== userId) throw new HttpError(404, 'not_found', 'Upload not found');
    if (photo.status === 'removed') throw new HttpError(409, 'photo_removed', 'This photo was removed');
    const strip = ({ original_key: _k, ...rest }: PhotoRow): UploadedPhoto => rest;
    if (photo.status === 'ready' || photo.status === 'review') {
      return json({ status: photo.status, photo: strip(photo) } satisfies UploadCompleteResponse, 200, req);
    }

    // Access may have changed since init (removed from the Roll, uploads closed).
    const { data: ctxData, error: ctxErr } = await admin.rpc('svc_upload_context', {
      p_user: userId,
      p_roll: photo.roll_id,
    });
    if (ctxErr) throw ctxErr;
    const access = decideUploadAccess(parseUploadContext(ctxData));
    if (!access.ok) throw new HttpError(access.status, access.code, access.code);

    const { data: muData, error: muErr } = await admin
      .from('media_uploads')
      .select('multipart_upload_id, part_size, parts, display_bytes, thumb_bytes')
      .eq('photo_id', photo.id)
      .maybeSingle();
    if (muErr) throw muErr;
    const mu = muData as MediaUpload | null;
    const uploadId = mu?.multipart_upload_id ?? null;

    if (uploadId) {
      const head = await r2.headObject(photo.original_key);
      const alreadyCompleted = head !== null && head.size === photo.bytes;
      if (!alreadyCompleted) {
        const parts = body.parts ?? [];
        if (!mu?.parts || !partsAreComplete(parts, mu.parts)) incomplete(['original'], { reset_parts: true });
        try {
          await r2.completeMultipart(
            photo.original_key,
            uploadId,
            parts.map((p) => ({ n: p.n, etag: p.etag })),
          );
        } catch (e) {
          const kind = classifyCompleteMultipartError(e);
          if (kind === 'restart') {
            await dropMultipart(admin, r2, photo, uploadId);
            incomplete(['original'], { restart_multipart: true });
          }
          if (kind === 'reset_parts') incomplete(['original'], { reset_parts: true });
          throw e;
        }
      }
    }

    const [original, display, thumb] = await Promise.all([
      r2.headObject(photo.original_key),
      r2.headObject(photo.display_key),
      r2.headObject(photo.thumb_key),
    ]);
    const missing = verifyObjects({
      bytes: photo.bytes,
      contentHash: photo.content_hash,
      multipart: uploadId !== null,
      heads: { original, display, thumb },
      mime: photo.mime,
      displayBytes: mu?.display_bytes ?? null,
      thumbBytes: mu?.thumb_bytes ?? null,
    });
    if (missing.length) {
      if (uploadId && missing.includes('original')) {
        // A completed multipart object with the wrong size cannot be fixed part by part.
        await forgetMultipart(admin, photo.id);
        incomplete(missing, { restart_multipart: true });
      }
      incomplete(missing);
    }

    const status = access.reviewFirst ? 'review' : 'ready';
    const patch: Record<string, unknown> = { status };
    if (body.blurhash) patch.blurhash = body.blurhash;
    const { data: updated, error: uErr } = await admin
      .from('photos')
      .update(patch)
      .eq('id', photo.id)
      .eq('status', 'pending')
      .select(RETURN_COLS)
      .maybeSingle();
    if (uErr) throw uErr;
    let result = updated as UploadedPhoto | null;
    if (!result) {
      // A concurrent complete won the race; answer with what it wrote.
      const { data: again, error: aErr } = await admin.from('photos').select(RETURN_COLS).eq('id', photo.id).single();
      if (aErr) throw aErr;
      result = again as UploadedPhoto;
      if (result.status !== 'ready' && result.status !== 'review') throw new HttpError(409, 'photo_removed', 'This photo was removed');
    }
    if (mu) await admin.from('media_uploads').delete().eq('photo_id', photo.id);

    return json({ status: result.status as 'ready' | 'review', photo: result } satisfies UploadCompleteResponse, 200, req);
  }),
);
