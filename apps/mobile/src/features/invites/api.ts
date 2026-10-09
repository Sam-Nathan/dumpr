import { useQuery } from '@tanstack/react-query';
import { callFunction } from '../../data/functions';
import { rpc } from '../../data/rpc';
import type { InvitePreview, JoinResult } from '../../data/types';

export const invitePreviewKey = (code: string) => ['invite-preview', code] as const;

/** A4 preview through the `invite-preview` function (works signed out). */
export function useInvitePreview(code: string | undefined) {
  return useQuery({
    queryKey: invitePreviewKey(code ?? ''),
    enabled: !!code,
    staleTime: 60_000,
    queryFn: () =>
      callFunction<InvitePreview>('invite-preview', undefined, {
        method: 'GET',
        query: { code: code as string },
      }),
  });
}

/** `join_via_invite`: joined | requested | already_member. Throws AppError codes (invite_expired...). */
export function joinViaInvite(code: string): Promise<JoinResult> {
  return rpc<JoinResult>('join_via_invite', { p_code: code });
}

/** Where to go after a successful join. */
export function joinedHref(r: Pick<JoinResult, 'crew_id' | 'roll_id'>): string {
  return r.roll_id ? `/roll/${r.roll_id}` : `/crew/${r.crew_id}`;
}
