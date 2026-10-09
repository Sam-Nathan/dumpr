import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from './rpc';
import type { HomeFeed, RespondInviteResult } from './types-b';

export const homeFeedKey = ['home-feed'] as const;

/** B1: everything on Home in ONE call (`home_feed()`). */
export function useHomeFeed() {
  return useQuery({
    queryKey: homeFeedKey,
    queryFn: () => rpc<HomeFeed>('home_feed'),
    staleTime: 20_000,
  });
}

/** Join / Decline on a pending in-app invite card. */
export function useRespondDirectInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      rpc<RespondInviteResult>('respond_direct_invite', { p_id: id, p_accept: accept }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: homeFeedKey });
      void qc.invalidateQueries({ queryKey: ['inbox-threads'] });
      void qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}
