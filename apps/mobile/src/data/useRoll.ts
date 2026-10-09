import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import {
  keysetFilter,
  nextCursor,
  PHOTOS_PAGE_SIZE,
  type GridCursor,
} from '../features/rolls/grid';
import { AppError, toAppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { rpc } from './rpc';
import { crewKey } from './useCrew';
import { homeFeedKey } from './useHome';
import type { GridPhoto, RollHeader, RollSettings } from './types-b';

export const rollHeaderKey = (rollId: string | undefined) => ['roll-header', rollId] as const;
export const rollPhotosKey = (rollId: string | undefined, chapterId?: string | null) =>
  ['roll-photos', rollId, chapterId ?? null] as const;

export const GRID_COLUMNS =
  'id, uploader_id, sort_at, width, height, thumb_key, display_key, blurhash, chapter_id, status, visibility, caption';

/** B3: `roll_header(rollId)`: roll + settings, Chapters, my role flags, counts, contributors. */
export function useRollHeader(rollId: string | undefined) {
  return useQuery({
    queryKey: rollHeaderKey(rollId),
    enabled: !!rollId,
    staleTime: 15_000,
    queryFn: () => rpc<RollHeader>('roll_header', { p_roll_id: rollId as string }),
  });
}

/** One keyset page of the grid (architecture §5): newest first, 60 per page. */
export async function fetchRollPhotosPage(
  rollId: string,
  chapterId: string | null,
  cursor: GridCursor | null,
): Promise<GridPhoto[]> {
  let q = supabase
    .from('photos')
    .select(GRID_COLUMNS)
    .eq('roll_id', rollId)
    .in('status', ['ready', 'review']);
  if (chapterId) q = q.eq('chapter_id', chapterId);
  if (cursor) q = q.or(keysetFilter(cursor));
  const { data, error } = await q
    .order('sort_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PHOTOS_PAGE_SIZE);
  if (error) throw toAppError(error);
  return (data ?? []) as GridPhoto[];
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

let channelCounter = 0;

/**
 * Live updates for a Roll: photo inserts / updates (a new photo turning `ready`, a removal, a caption)
 * invalidate the grid and header. Invalidations are coalesced so a burst of uploads refetches once.
 */
export function useRollRealtime(rollId: string | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!rollId) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void qc.invalidateQueries({ queryKey: ['roll-photos', rollId] });
        void qc.invalidateQueries({ queryKey: rollHeaderKey(rollId) });
      }, 600);
    };
    channelCounter += 1;
    const channel = supabase
      .channel(`roll-photos:${rollId}:${channelCounter}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'photos', filter: `roll_id=eq.${rollId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'photos', filter: `roll_id=eq.${rollId}` },
        refresh,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
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
  void qc.invalidateQueries({ queryKey: ['roll-photos', rollId] });
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
