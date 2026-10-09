/** Pure helpers for the Crew screens. */
import type { MemberRole } from '../../data/types';

interface Person {
  user_id: string;
  display_name: string;
}

/** "Aarav, Kabir, you +3" (hosts first, then me, then a remainder). */
export function memberSummary(members: readonly Person[], meId: string | null | undefined, maxNames = 2): string {
  const others = members.filter((m) => m.user_id !== meId);
  const iAmIn = members.some((m) => m.user_id === meId);
  const names = others.slice(0, maxNames).map((m) => m.display_name.split(/\s+/)[0] || m.display_name);
  if (iAmIn) names.push('you');
  const shown = names.length;
  const extra = members.length - shown;
  const text = names.join(', ');
  if (!text) return 'No one yet';
  return extra > 0 ? `${text} +${extra}` : text;
}

export const ROLE_LABEL: Record<MemberRole, string> = {
  host: 'HOST',
  cohost: 'CO-HOST',
  member: 'MEMBER',
};

export type MemberAction = 'make_cohost' | 'make_member' | 'make_host' | 'remove';

/**
 * What the viewer may do to another member (architecture §5): the host can promote, demote,
 * hand over the Crew and remove anyone; a co-host can remove plain members only.
 */
export function memberActions(myRole: MemberRole | null | undefined, target: MemberRole): MemberAction[] {
  if (myRole === 'host') {
    if (target === 'host') return [];
    return [target === 'cohost' ? 'make_member' : 'make_cohost', 'make_host', 'remove'];
  }
  if (myRole === 'cohost' && target === 'member') return ['remove'];
  return [];
}

/** Dialog copy for deleting a Crew (design-system §9). */
export function deleteCrewBody(memberCount: number): string {
  const who = memberCount === 1 ? '1 member gets' : `${memberCount} members get`;
  return `${who} 30 days to download their copies. This can't be undone.`;
}
