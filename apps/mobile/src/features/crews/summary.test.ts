import { describe, expect, it } from 'vitest';
import { deleteCrewBody, memberActions, memberSummary } from './summary';

const m = (id: string, name: string) => ({ user_id: id, display_name: name });

describe('memberSummary', () => {
  const members = [m('a', 'Aarav Rao'), m('k', 'Kabir S'), m('me', 'Meera'), m('d', 'Diya'), m('z', 'Zoya'), m('t', 'Tanvi')];
  it('lists two others, you, and the remainder', () => {
    expect(memberSummary(members, 'me')).toBe('Aarav, Kabir, you +3');
  });
  it('has no remainder for a small Crew', () => {
    expect(memberSummary([m('a', 'Aarav'), m('me', 'Meera')], 'me')).toBe('Aarav, you');
    expect(memberSummary([], 'me')).toBe('No one yet');
  });
});

describe('memberActions', () => {
  it('lets the host promote, demote, hand over and remove', () => {
    expect(memberActions('host', 'member')).toEqual(['make_cohost', 'make_host', 'remove']);
    expect(memberActions('host', 'cohost')).toEqual(['make_member', 'make_host', 'remove']);
    expect(memberActions('host', 'host')).toEqual([]);
  });
  it('lets a co-host remove plain members only', () => {
    expect(memberActions('cohost', 'member')).toEqual(['remove']);
    expect(memberActions('cohost', 'cohost')).toEqual([]);
    expect(memberActions('cohost', 'host')).toEqual([]);
    expect(memberActions('member', 'member')).toEqual([]);
  });
});

describe('deleteCrewBody', () => {
  it('matches the design copy', () => {
    expect(deleteCrewBody(6)).toBe("6 members get 30 days to download their copies. This can't be undone.");
    expect(deleteCrewBody(1)).toBe("1 member gets 30 days to download their copies. This can't be undone.");
  });
});
