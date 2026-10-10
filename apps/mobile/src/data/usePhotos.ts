import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toAppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { rpc } from './rpc';
import { useSession } from './session';
import type { PhotoRowLite } from './types-cf';

export const photoLiteKey = (photoId: string) => ['photo-lite', photoId] as const;

/** F2: the photo row (visibility, uploader, roll name). Separate from B4's `['photo', id]`. */
export function usePhotoLite(photoId: string | undefined) {
  return useQuery({
    queryKey: photoLiteKey(photoId ?? ''),
    enabled: !!photoId,
    queryFn: async (): Promise<PhotoRowLite> => {
      const { data, error } = await supabase
        .from('photos')
        .select(
          'id, roll_id, crew_id, uploader_id, status, visibility, sort_at, mime, bytes, chapter_id, blurhash, uploader:profiles!uploader_id(display_name), roll:rolls!photos_roll_id_fkey(name)',
        )
        .eq('id', photoId as string)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!data) throw toAppError({ code: 'P0001', message: 'not_found' });
      return data as unknown as PhotoRowLite;
    },
  });
}

/** Ghost Mode audience of an own photo. */
export function usePhotoAudience(photoId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['photo-audience', photoId],
    enabled: !!photoId && enabled,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('photo_audience')
        .select('user_id')
        .eq('photo_id', photoId as string);
      if (error) throw toAppError(error);
      return (data ?? []).map((r) => (r as { user_id: string }).user_id);
    },
  });
}

/** Pending removal request the viewer already sent for this photo (status chip). */
export function useMyRemovalRequest(photoId: string | undefined, enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: ['removal-request', photoId, user?.id],
    enabled: !!photoId && !!user && enabled,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('removal_requests')
        .select('id')
        .eq('photo_id', photoId as string)
        .eq('requester_id', user?.id as string)
        .eq('status', 'pending')
        .limit(1);
      if (error) throw toAppError(error);
      return (data ?? []).length > 0;
    },
  });
}

export type Visibility = 'everyone' | 'selected' | 'only_me';

export function useSetVisibility(photoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { visibility: Visibility; audience: string[] }) =>
      rpc<void>('set_photo_visibility', {
        p_photo_id: photoId,
        p_visibility: v.visibility,
        p_audience: v.visibility === 'selected' ? v.audience : [],
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: photoLiteKey(photoId) });
      void qc.invalidateQueries({ queryKey: ['photo-audience', photoId] });
      void qc.invalidateQueries({ queryKey: ['photo', photoId] });
    },
  });
}

export function requestPhotoRemoval(photoId: string, reason?: string) {
  return rpc('request_photo_removal', { p_photo_id: photoId, p_reason: reason ?? null });
}

export function reportPhoto(photoId: string, reason: string) {
  return rpc('report', { p_target: 'photo', p_target_id: photoId, p_reason: reason });
}

export function removePhoto(photoId: string, reason?: string) {
  return rpc<void>('remove_photo', { p_photo_id: photoId, p_reason: reason ?? null });
}
