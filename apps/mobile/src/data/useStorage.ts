import { useQuery } from '@tanstack/react-query';
import { rpc } from './rpc';
import { useSession } from './session';
import type { MyProfileStats, MyStorage } from './types-cf';

export const myStorageKey = ['my-storage'] as const;
export const myStatsKey = ['my-profile-stats'] as const;

/** F4: `my_storage()` (limit is null until the owner configures one: never hardcode a plan). */
export function useMyStorage() {
  const { user } = useSession();
  return useQuery({
    queryKey: myStorageKey,
    enabled: !!user,
    queryFn: () => rpc<MyStorage>('my_storage'),
  });
}

/** F5 strip: `my_profile_stats()`. */
export function useMyProfileStats() {
  const { user } = useSession();
  return useQuery({
    queryKey: myStatsKey,
    enabled: !!user,
    queryFn: () => rpc<MyProfileStats>('my_profile_stats'),
  });
}
