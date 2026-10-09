import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { callFunction } from './functions';
import {
  parseSignedKey,
  SignedUrlCache,
  signedKey,
  type SignBatchResponse,
} from './signedUrlCache';
import type { PhotoVariant, SignItem } from './types';

export { signedKey };

/** Photos: keys are `<photoId>:<variant>`; one `media-sign` call per 16 ms tick. */
export const photoUrlCache = new SignedUrlCache({
  fetchBatch: (keys) => {
    const items = keys.flatMap((k) => {
      const p = parseSignedKey(k);
      return p ? [p] : [];
    });
    return callFunction<SignBatchResponse>('media-sign', { items });
  },
});

/** Avatars: keys are avatar keys (`a/<user>/<uuid>.jpg`). */
export const avatarUrlCache = new SignedUrlCache({
  fetchBatch: (keys) => callFunction<SignBatchResponse>('media-sign', { avatar_keys: keys }),
});

/** Drop every cached URL (called on sign-out). */
export function clearMediaCaches(): void {
  photoUrlCache.clear();
  avatarUrlCache.clear();
}

function useCachedUrls(cache: SignedUrlCache, keys: readonly string[]): Record<string, string> {
  const sig = keys.join('\n');
  // One string snapshot per hook: components re-render only when one of THEIR urls changes.
  const snapshot = useSyncExternalStore(
    (cb) => cache.subscribe(cb),
    () => keys.map((k) => cache.peek(k) ?? '').join('\n'),
    () => '',
  );
  useEffect(() => {
    cache.request(keys);
  }, [cache, sig]);
  return useMemo(() => {
    const urls = snapshot.split('\n');
    const out: Record<string, string> = {};
    keys.forEach((k, i) => {
      const u = urls[i];
      if (u) out[k] = u;
    });
    return out;
  }, [snapshot, sig]);
}

/**
 * Signed URLs for photos, batched across components. Returns `{ [photoId:variant]: url }`; a key is
 * missing until its URL arrives (render the blurhash placeholder meanwhile). Use the same key as the
 * expo-image `cacheKey` so images stay cached when the signature changes.
 */
export function useSignedUrls(items: readonly SignItem[]): Record<string, string> {
  const keys = useMemo(
    () => items.map((i) => signedKey(i.photoId, i.variant)),
    [items.map((i) => `${i.photoId}:${i.variant}`).join(',')],
  );
  return useCachedUrls(photoUrlCache, keys);
}

/** One photo URL; `undefined` until it resolves. */
export function useSignedUrl(
  photoId: string | null | undefined,
  variant: PhotoVariant,
): string | undefined {
  const items = useMemo(() => (photoId ? [{ photoId, variant }] : []), [photoId, variant]);
  const urls = useSignedUrls(items);
  return photoId ? urls[signedKey(photoId, variant)] : undefined;
}

/** Signed avatar URLs for avatar keys (nulls ignored). Returns `{ [avatarKey]: url }`. */
export function useAvatarUrls(
  avatarKeys: readonly (string | null | undefined)[],
): Record<string, string> {
  const keys = useMemo(
    () => [...new Set(avatarKeys.filter((k): k is string => !!k))],
    [avatarKeys.join(',')],
  );
  return useCachedUrls(avatarUrlCache, keys);
}

/** One avatar URL. */
export function useAvatarUrl(avatarKey: string | null | undefined): string | undefined {
  const urls = useAvatarUrls([avatarKey]);
  return avatarKey ? urls[avatarKey] : undefined;
}

/** Non-hook access for download / share code: resolves once the URL is available. */
export async function getSignedUrl(photoId: string, variant: PhotoVariant): Promise<string | null> {
  const key = signedKey(photoId, variant);
  photoUrlCache.request([key]);
  await photoUrlCache.idle();
  return photoUrlCache.peek(key) ?? null;
}
