import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useMemo } from 'react';
import { nextCursor, PHOTOS_PAGE_SIZE, type GridCursor } from '../features/rolls/grid';
import { refreshRollPhotos } from '../features/rolls/pages';
import { AppError, toAppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { photoUrlCache, signedKey } from './media';
import { rpc } from './rpc';
import { crewKey } from './useCrew';
import { homeFeedKey } from './useHome';
import type { GridPhoto, RollHeader, RollSettings } from './types-b';

export const rollHeaderKey = (rollId: string | undefined) => ['roll-header', rollId] as const;
export const rollPhotosKey = (rollId: string | undefined, chapterId?: string | null) =>
  ['roll-photos', rollId, chapterId ?? null] as const;

export const GRID_COLUMNS =
  'id, uploader_id, sort_at, width, height, thumb_key, display_key, blurhash, chapter_id, status, visibility, caption';

/** Burst of `photos_changed` broadcasts -> one refetch of page 1, this long after the first one. */
export const ROLL_REFRESH_DEBOUNCE_MS = 2000;

/** B3: `roll_header(rollId)`: roll + settings, Chapters, my role flags, counts, contributors. */
export function useRollHeader(rollId: string | undefined) {
  return useQuery({
    queryKey: rollHeaderKey(rollId),
    enabled: !!rollId,
    staleTime: 15_000,
    queryFn: () => rpc<RollHeader>('roll_header', { p_roll_id: rollId as string }),
  });
}

/**
 * One keyset page of the grid (architecture §5): newest first, 60 per page, through `roll_photos`
 * (authorises the roll once instead of evaluating the photo policy per row). The thumbnails of the
 * whole page are signed in ONE media-sign call as soon as the page arrives, ahead of the tiles.
 */
export async function fetchRollPhotosPage(
  rollId: string,
  chapterId: string | null,
  cursor: GridCursor | null,
): Promise<GridPhoto[]> {
  const rows = await rpc<GridPhoto[] | null>('roll_photos', {
    p_roll_id: rollId,
    p_before_sort_at: cursor?.sortAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_chapter_id: chapterId,
    p_limit: PHOTOS_PAGE_SIZE,
  });
  const page = rows ?? [];
  photoUrlCache.request(page.map((p) => signedKey(p.id, 'thumb')));
  return page;
}

/** The grid as an infinite query (key `['roll-photos', rollId, chapterId | null]`). */
export function useRollPhotos(rollId: string | undefined, chapterId: string | null = null) {
  return useInfiniteQuery<
    GridPhoto[],
    AppError,
    InfiniteData<GridPhoto[], GridCursor | null>,
    ReturnType<typeof rollPhotosKey>,
    GridCursor | null
  >({
    queryKey: rollPhotosKey(rollId, chapterId),
    enabled: !!rollId,
    initialPageParam: null,
    queryFn: ({ pageParam }) => fetchRollPhotosPage(rollId as string, chapterId, pageParam),
    getNextPageParam: (lastPage) => nextCursor(lastPage) ?? undefined,
    staleTime: 20_000,
  });
}

/** Flatten loaded pages (a refetch can overlap pages briefly, so de-duplicate by id). */
export function flattenPhotos(data: InfiniteData<GridPhoto[]> | undefined): GridPhoto[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: GridPhoto[] = [];
  for (const page of data.pages) {
    for (const p of page) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

export function useFlatPhotos(data: InfiniteData<GridPhoto[]> | undefined): GridPhoto[] {
  return useMemo(() => flattenPhotos(data), [data]);
}

/**
 * Live updates for a Roll. Photos are no longer in the postgres_changes publication (that evaluated the photo
 * policy for every subscriber on every change); the server broadcasts `photos_changed` on the channel
 * `roll:<id>` when a photo becomes ready / is removed / changes visibility. A burst of events (an upload
 * flood) refetches page 1 and the header once, `ROLL_REFRESH_DEBOUNCE_MS` after the first one.
 */
export function useRollRealtime(rollId: string | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!rollId) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let channel: RealtimeChannel | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        refreshRollPhotos(qc, rollId);
        void qc.invalidateQueries({ queryKey: rollHeaderKey(rollId) });
      }, ROLL_REFRESH_DEBOUNCE_MS);
    };
    const topic = `roll:${rollId}`;
    void (async () => {
      // supabase.channel(topic) hands back an existing channel of the same topic, and callbacks cannot be added
      // to a subscribed one: wait for a leftover (previous screen instance) to be torn down first.
      const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
      if (stale) await supabase.removeChannel(stale);
      if (cancelled) return;
      channel = supabase
        .channel(topic)
        .on('broadcast', { event: 'photos_changed' }, refresh)
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [qc, rollId]);
}

/** Admin queue: guest photos waiting for approval. */
export function useReviewPhotos(rollId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['roll-review', rollId],
    enabled: !!rollId && enabled,
    queryFn: async (): Promise<GridPhoto[]> => {
      const { data, error } = await supabase
        .from('photos')
        .select(GRID_COLUMNS)
        .eq('roll_id', rollId as string)
        .eq('status', 'review')
        .order('sort_at', { ascending: false })
        .limit(100);
      if (error) throw toAppError(error);
      return (data ?? []) as GridPhoto[];
    },
  });
}

export function invalidateRoll(qc: QueryClient, rollId: string, crewId?: string): void {
  refreshRollPhotos(qc, rollId); // page 1 only (see features/rolls/pages.ts)
  void qc.invalidateQueries({ queryKey: rollHeaderKey(rollId) });
  void qc.invalidateQueries({ queryKey: ['roll-review', rollId] });
  void qc.invalidateQueries({ queryKey: homeFeedKey });
  if (crewId) void qc.invalidateQueries({ queryKey: crewKey(crewId) });
}

export const reviewGuestPhotos = (photoIds: string[], approve: boolean) =>
  rpc<void>('review_guest_photos', { p_photo_ids: photoIds, p_approve: approve });

export const removePhoto = (photoId: string) =>
  rpc<void>('remove_photo', { p_photo_id: photoId, p_reason: null });

export type RollSettingsPatch = Partial<
  Pick<
    RollSettings,
    | 'name'
    | 'starts_on'
    | 'ends_on'
    | 'allow_uploads'
    | 'allow_downloads'
    | 'allow_member_invites'
    | 'guests_allowed'
    | 'guest_uploads_review'
  >
>;

/** Host controls write `rolls` columns directly (column grants + roll-admin RLS). */
export async function updateRoll(rollId: string, patch: RollSettingsPatch): Promise<void> {
  const { data, error } = await supabase.from('rolls').update(patch).eq('id', rollId).select('id');
  if (error) throw toAppError(error);
  // RLS filters a non-admin's update to zero rows instead of failing.
  if (!data || data.length === 0) throw new AppError('not_admin');
}
