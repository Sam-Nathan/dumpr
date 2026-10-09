import { useQuery, type QueryClient } from '@tanstack/react-query';
import { buildInviteLink } from '../features/invites/links';
import { rpc } from './rpc';
import type { CreatedInvite, InviteSettings } from './types-b';

export const DEFAULT_INVITE_SETTINGS: InviteSettings = {
  ttlDays: 7,
  requiresApproval: false,
  allowGuests: true,
};

export interface InviteTarget {
  crewId: string;
  rollId?: string | null;
}

export async function createInvite(
  target: InviteTarget,
  s: InviteSettings = DEFAULT_INVITE_SETTINGS,
): Promise<CreatedInvite & { link: string }> {
  const res = await rpc<CreatedInvite>('create_invite', {
    p_crew_id: target.crewId,
    p_roll_id: target.rollId ?? null,
    p_ttl_days: s.ttlDays,
    p_requires_approval: s.requiresApproval,
    p_allow_guests: s.allowGuests,
    p_max_uses: null,
  });
  // The RPC reuses an existing identical link, so asking again is cheap and stable.
  return { ...res, link: res.url || buildInviteLink(res.code, target.rollId) };
}

export const inviteLinkKey = (target: InviteTarget | null, s: InviteSettings) =>
  [
    'invite-link',
    target?.crewId,
    target?.rollId ?? null,
    s.ttlDays,
    s.requiresApproval,
    s.allowGuests,
  ] as const;

/** Warm the default link so the invite sheet opens with it already there. */
export function prefetchInviteLink(qc: QueryClient, target: InviteTarget): void {
  void qc.prefetchQuery({
    queryKey: inviteLinkKey(target, DEFAULT_INVITE_SETTINGS),
    staleTime: 5 * 60_000,
    queryFn: () => createInvite(target, DEFAULT_INVITE_SETTINGS),
  });
}

/** B6: the invite link for the current settings (re-created when a setting changes). */
export function useInviteLink(target: InviteTarget | null, settings: InviteSettings) {
  return useQuery({
    queryKey: inviteLinkKey(target, settings),
    enabled: !!target?.crewId,
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    queryFn: () => createInvite(target as InviteTarget, settings),
  });
}
