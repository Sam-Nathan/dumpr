import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { toAppError } from '../lib/errors';
import { homeFeedKey } from './useHome';
import { rpc } from './rpc';
import { getSessionSnapshot } from './session';
import type { CrewTint, MemberRole } from './types';
import type { CrewOverview, RollKind } from './types-b';

export const crewKey = (crewId: string | undefined) => ['crew', crewId] as const;

/** B2: `crew_overview(crewId)`: crew, members with roles, my role / mute, Rolls newest first. */
export function useCrewOverview(crewId: string | undefined) {
  return useQuery({
    queryKey: crewKey(crewId),
    enabled: !!crewId,
    staleTime: 15_000,
    queryFn: () => rpc<CrewOverview>('crew_overview', { p_crew_id: crewId as string }),
  });
}

/** Refresh everything a crew change touches. */
export function invalidateCrew(qc: QueryClient, crewId: string): void {
  void qc.invalidateQueries({ queryKey: crewKey(crewId) });
  void qc.invalidateQueries({ queryKey: homeFeedKey });
}

export function useInvalidateCrew() {
  const qc = useQueryClient();
  return (crewId: string) => invalidateCrew(qc, crewId);
}

export interface CreatedCrew {
  id: string;
  name: string;
  tint: CrewTint;
}

export function createCrew(name: string, tint: CrewTint): Promise<CreatedCrew> {
  return rpc<CreatedCrew>('create_crew', { p_name: name, p_tint: tint });
}

export interface CreateRollInput {
  crewId: string;
  name: string;
  kind: RollKind;
  startsOn: string | null;
  endsOn: string | null;
  chapters: string[];
}

export function createRoll(
  input: CreateRollInput,
): Promise<{ id: string; crew_id: string; name: string }> {
  return rpc('create_roll', {
    p_crew_id: input.crewId,
    p_name: input.name,
    p_kind: input.kind,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_reveal_mode: 'live',
    p_chapters: input.chapters,
  });
}

export function updateCrew(
  crewId: string,
  patch: { name?: string; tint?: CrewTint },
): Promise<CreatedCrew> {
  return rpc<CreatedCrew>('update_crew', {
    p_crew_id: crewId,
    p_name: patch.name ?? null,
    p_tint: patch.tint ?? null,
  });
}

export const deleteCrew = (crewId: string) => rpc<void>('delete_crew', { p_crew_id: crewId });
export const leaveCrew = (crewId: string) => rpc<void>('leave_crew', { p_crew_id: crewId });
export const removeMember = (crewId: string, userId: string) =>
  rpc<void>('remove_member', { p_crew_id: crewId, p_user_id: userId });
export const transferHost = (crewId: string, userId: string) =>
  rpc<void>('transfer_host', { p_crew_id: crewId, p_user_id: userId });
export const setMemberRole = (crewId: string, userId: string, role: MemberRole) =>
  rpc<void>('set_member_role', { p_crew_id: crewId, p_user_id: userId, p_role: role });

/** Mute / unmute the Crew for me (`crew_members.muted`, own row only). */
export async function setCrewMuted(crewId: string, muted: boolean): Promise<void> {
  const me = getSessionSnapshot()?.user.id;
  if (!me) throw new AppError('not_authenticated');
  const { error } = await supabase
    .from('crew_members')
    .update({ muted })
    .eq('crew_id', crewId)
    .eq('user_id', me);
  if (error) throw toAppError(error);
}
