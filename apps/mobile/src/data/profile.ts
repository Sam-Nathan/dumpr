import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppError, toAppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useSession } from './session';
import type { Profile, ProfileUpdate } from './types';

const PROFILE_COLUMNS =
  'id, display_name, handle, avatar_key, ring_color, birthday_day, birthday_month, is_guest, phone_visible, who_can_add';

export const profileKey = (userId: string | undefined) => ['profile', userId] as const;

/** The signed-in user's own `profiles` row. Disabled while signed out. */
export function useProfile() {
  const { user } = useSession();
  const userId = user?.id;
  return useQuery({
    queryKey: profileKey(userId),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw toAppError(error);
      // The auth trigger creates the row; if it is not visible yet, ask callers to retry.
      if (!data) throw new AppError('not_found');
      return data as Profile;
    },
    retry: (count, error) => count < 4 && toAppError(error).code === 'not_found',
    retryDelay: 600,
  });
}

/** Update own profile columns (column grants limit what is writable). Maps `handle_taken`. */
export function useUpdateProfile() {
  const { user } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ProfileUpdate): Promise<Profile> => {
      if (!user) throw new AppError('not_authenticated');
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id)
        .select(PROFILE_COLUMNS)
        .single();
      if (error) {
        // Unique violation on lower(handle).
        if (error.code === '23505') throw new AppError('handle_taken', error.message);
        throw toAppError(error);
      }
      return data as Profile;
    },
    onSuccess: (profile) => {
      qc.setQueryData(profileKey(user?.id), profile);
    },
  });
}
