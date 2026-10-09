'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { errorCopy } from '../lib/errors';
import { formatPhotoCount } from '../lib/format';
import { mediaKey, signMedia, MediaSignError } from '../lib/media';
import { createClient } from '../lib/supabase/client';

interface Photo {
  id: string;
  width: number | null;
  height: number | null;
  blurhash: string | null;
}

/** A roll_photos() row (only the columns used here). */
interface GridRow extends Photo {
  status: string;
}

const PLACEHOLDER_TINTS = [
  'bg-tint-lilac dark:bg-tint-lilac-dark',
  'bg-tint-sky dark:bg-tint-sky-dark',
  'bg-tint-peach dark:bg-tint-peach-dark',
  'bg-tint-pink dark:bg-tint-pink-dark',
  'bg-tint-mint dark:bg-tint-mint-dark',
  'bg-tint-lime dark:bg-tint-lime-dark',
];

async function accessToken(): Promise<string> {
  const { data } = await createClient().auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new MediaSignError('not_authenticated');
  return t;
}

/** A5 "Latest in this Roll": newest 60 photos via RLS + signed thumbs, per-photo save when allowed. */
export function LatestPhotos({
  rollId,
  allowDownloads,
  refreshKey,
}: {
  rollId: string;
  allowDownloads: boolean;
  refreshKey: number;
}) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        // roll_photos authorises the roll once and walks the grid index (newest first); it also returns the
        // viewer's own / review rows, which this strip does not show.
        const { data, error } = await supabase.rpc('roll_photos', {
          p_roll_id: rollId,
          p_limit: 60,
        });
        if (error) throw error;
        const rows = ((data ?? []) as GridRow[])
          .filter((r) => r.status === 'ready')
          .map((r) => ({
            id: r.id,
            width: r.width,
            height: r.height,
            blurhash: r.blurhash,
          }));
        const signed = await signMedia(
          await accessToken(),
          rows.map((r) => ({ photo_id: r.id, variant: 'thumb' as const })),
        );
        if (cancelled) return;
        setPhotos(rows);
        setUrls((prev) => ({ ...prev, ...signed }));
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setLoadError(errorCopy(err instanceof MediaSignError ? err.code : err));
        setPhotos((p) => p ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rollId, refreshKey]);

  return (
    <section aria-labelledby="latest-title" className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 id="latest-title" className="font-body text-[17px] font-bold leading-[1.2]">
          Latest in this Roll
        </h2>
        {photos && photos.length > 0 && (
          <span className="text-[13px] text-ink2 dark:text-ink2-dark">
            {formatPhotoCount(photos.length)}
          </span>
        )}
      </div>
      {loadError && (
        <p role="alert" className="mt-2 text-[13px] text-danger dark:text-danger-dark">
          {loadError}
        </p>
      )}
      {photos === null ? (
        <ul
          className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4"
          aria-busy="true"
          aria-label="Loading photos"
        >
          {Array.from({ length: 8 }, (_, i) => (
            <li
              key={i}
              className="aspect-square animate-pulse rounded-tile bg-line dark:bg-line-dark"
            />
          ))}
        </ul>
      ) : photos.length === 0 ? (
        <div>
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <li
                key={i}
                className="aspect-square rounded-tile border-2 border-dashed border-line dark:border-line-dark"
              />
            ))}
          </ul>
          <p className="mt-3 text-[15px] text-ink2 dark:text-ink2-dark">
            No photos yet. Be the first to add one.
          </p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p, i) => {
            const url = urls[mediaKey(p.id, 'thumb')];
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  className={`relative block aspect-square w-full overflow-hidden rounded-tile ${PLACEHOLDER_TINTS[i % PLACEHOLDER_TINTS.length]}`}
                  aria-label={`Open photo ${i + 1}`}
                >
                  {url && (
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.visibility = 'hidden';
                      }}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <PhotoDialog
        photoId={openId}
        thumbUrl={openId ? urls[mediaKey(openId, 'thumb')] : undefined}
        allowDownloads={allowDownloads}
        onClose={() => setOpenId(null)}
      />
    </section>
  );
}

function PhotoDialog({
  photoId,
  thumbUrl,
  allowDownloads,
  onClose,
}: {
  photoId: string | null;
  thumbUrl: string | undefined;
  allowDownloads: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (photoId && !dlg.open) dlg.showModal();
    if (!photoId && dlg.open) dlg.close();
  }, [photoId]);

  useEffect(() => {
    setDisplayUrl(null);
    setMessage(null);
    if (!photoId) return;
    let cancelled = false;
    (async () => {
      try {
        const signed = await signMedia(await accessToken(), [
          { photo_id: photoId, variant: 'display' },
        ]);
        if (!cancelled) setDisplayUrl(signed[mediaKey(photoId, 'display')] ?? null);
      } catch {
        // The thumbnail stays as the fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  const save = useCallback(async () => {
    if (!photoId) return;
    setSaving(true);
    setMessage(null);
    try {
      const signed = await signMedia(await accessToken(), [
        { photo_id: photoId, variant: 'original' },
      ]);
      const url = signed[mediaKey(photoId, 'original')];
      if (!url) throw new MediaSignError('unknown');
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('download');
        const blob = await res.blob();
        const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
        const obj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = obj;
        a.download = `dumpr-${photoId.slice(0, 8)}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(obj), 10_000);
      } catch {
        // Cross-origin fetch blocked (CORS): let the browser open the file so it can be saved by hand.
        window.open(url, '_blank', 'noopener');
      }
    } catch (err) {
      setMessage(errorCopy(err instanceof MediaSignError ? err.code : err));
    } finally {
      setSaving(false);
    }
  }, [photoId]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      aria-label="Photo"
      className="m-auto w-[min(92vw,32rem)] max-w-none rounded-card bg-surface p-4 text-ink backdrop:bg-black/70 dark:bg-surface-dark dark:text-ink-dark"
    >
      {photoId && (
        <div>
          {(displayUrl ?? thumbUrl) ? (
            <img
              src={displayUrl ?? thumbUrl}
              alt="Photo from the Roll"
              className="max-h-[65vh] w-full rounded-[16px] object-contain"
            />
          ) : (
            <div className="aspect-square w-full rounded-[16px] bg-line dark:bg-line-dark" />
          )}
          {message && (
            <p role="alert" className="mt-3 text-[13px] text-danger dark:text-danger-dark">
              {message}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {allowDownloads ? (
              <button type="button" className="btn-ink" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save photo'}
              </button>
            ) : (
              <p className="flex-1 text-[13px] text-ink2 dark:text-ink2-dark">
                The host turned off saving for this Roll.
              </p>
            )}
            <button type="button" className="btn-outline" onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
