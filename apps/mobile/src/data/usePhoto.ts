import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { applyReaction } from '../features/viewer/helpers';
import { AppError, toAppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { getSessionSnapshot } from './session';
import type { ReactionKind } from './types';
import type { GridPhoto, PhotoDetail, ReactionState, UploaderProfile } from './types-b';

export const photoKey = (photoId: string | undefined) => ['photo', photoId] as const;
export const reactionsKey = (photoId: string | undefined) => ['reactions', photoId] as const;

const DETAIL_COLUMNS =
  'id, uploader_id, sort_at, width, height, thumb_key, display_key, blurhash, chapter_id, status, visibility, caption, roll_id, crew_id, mime, bytes, taken_at, removed_at';

/** One photo row (the uploader also sees their own `removed` rows, so the viewer can say so). */
export function usePhotoDetail(photoId: string | undefined) {
  return useQuery({
    queryKey: photoKey(photoId),
    enabled: !!photoId,
    staleTime: 30_000,
    queryFn: async (): Promise<PhotoDetail> => {
      const { data, error } = await supabase
        .from('photos')
        .select(DETAIL_COLUMNS)
        .eq('id', photoId as string)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!data) throw new AppError('not_found');
      return data as PhotoDetail;
    },
  });
}

/** Display name + avatar for the credit line. */
export function useUploaderProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['uploader', userId],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<UploaderProfile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_key, ring_color')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!data) throw new AppError('not_found');
      return data as UploaderProfile;
    },
  });
}

/** Reaction counts (`photo_reaction_counts` view) plus my own reaction. */
export function useReactions(photoId: string | undefined) {
  return useQuery({
    queryKey: reactionsKey(photoId),
    enabled: !!photoId,
    staleTime: 15_000,
    queryFn: async (): Promise<ReactionState> => {
      const me = getSessionSnapshot()?.user.id;
      const [counts, mine] = await Promise.all([
        supabase
          .from('photo_reaction_counts')
          .select('kind, n')
          .eq('photo_id', photoId as string),
        me
          ? supabase
              .from('reactions')
              .select('kind')
              .eq('photo_id', photoId as string)
              .eq('user_id', me)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (counts.error) throw toAppError(counts.error);
      if (mine.error) throw toAppError(mine.error);
      const out: ReactionState['counts'] = {};
      for (const row of (counts.data ?? []) as { kind: ReactionKind; n: number }[]) {
        out[row.kind] = Number(row.n);
      }
      return { counts: out, mine: (mine.data as { kind: ReactionKind } | null)?.kind ?? null };
    },
  });
}

/** Set (upsert) or clear (`null`) my single reaction on a photo. */
export async function setReaction(photoId: string, kind: ReactionKind | null): Promise<void> {
  const me = getSessionSnapshot()?.user.id;
  if (!me) throw new AppError('not_authenticated');
  if (kind === null) {
    const { error } = await supabase
      .from('reactions')
      .delete()
      .eq('photo_id', photoId)
      .eq('user_id', me);
    if (error) throw toAppError(error);
    return;
  }
  const { error } = await supabase
    .from('reactions')
    .upsert({ photo_id: photoId, user_id: me, kind }, { onConflict: 'photo_id,user_id' });
  if (error) throw toAppError(error);
}

export function useReactionMutations(photoId: string) {
  const qc = useQueryClient();
  return {
    /** Optimistic: the chip flips at once, rolls back (and rethrows) when the write fails. */
    react: async (kind: ReactionKind | null) => {
      const key = reactionsKey(photoId);
      const before = qc.getQueryData<ReactionState>(key) ?? { counts: {}, mine: null };
      qc.setQueryData<ReactionState>(key, applyReaction(before, kind));
      try {
        await setReaction(photoId, kind);
      } catch (e) {
        qc.setQueryData<ReactionState>(key, before);
        throw e;
      } finally {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  };
}

/** Own photos only (column grant + RLS: uploader = me). */
export async function updateCaption(photoId: string, caption: string | null): Promise<void> {
  const { data, error } = await supabase
    .from('photos')
    .update({ caption })
    .eq('id', photoId)
    .select('id');
  if (error) throw toAppError(error);
  if (!data?.length) throw new AppError('forbidden');
}

/** Write a new caption into every cached copy of the photo (grid pages + detail). */
export function patchCachedCaption(
  qc: ReturnType<typeof useQueryClient>,
  photoId: string,
  caption: string | null,
): void {
  qc.setQueriesData<InfiniteData<GridPhoto[]>>({ queryKey: ['roll-photos'] }, (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((page) =>
            page.map((p) => (p.id === photoId ? { ...p, caption } : p)),
          ),
        }
      : old,
  );
  qc.setQueryData<PhotoDetail | undefined>(photoKey(photoId), (old) =>
    old ? { ...old, caption } : old,
  );
}
