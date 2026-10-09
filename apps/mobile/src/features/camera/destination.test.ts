import { describe, expect, it } from 'vitest';
import type { DestinationRoll } from '../../data/types-cf';
import {
  addLabel,
  destinationLabel,
  filterDestinations,
  pickDefaultDestination,
  postedMessage,
  sectionDestinations,
  toDestinationRoll,
  type RollRow,
} from './destination';

const roll = (over: Partial<DestinationRoll>): DestinationRoll => ({
  id: 'r1',
  name: "Goa '26",
  crewId: 'c1',
  crewName: 'Goa Gang',
  tint: 'lilac',
  live: false,
  uploadsClosed: false,
  sealed: false,
  startsOn: null,
  endsOn: null,
  lastActivityAt: '2026-03-10T00:00:00Z',
  coverPhotoId: null,
  ...over,
});

describe('pickDefaultDestination', () => {
  const rolls = [
    roll({ id: 'old', lastActivityAt: '2026-01-01T00:00:00Z' }),
    roll({ id: 'live', live: true, lastActivityAt: '2026-03-12T00:00:00Z' }),
    roll({ id: 'recent', lastActivityAt: '2026-03-11T00:00:00Z' }),
  ];
  it('prefers the roll from the URL', () => {
    expect(pickDefaultDestination(rolls, { preferredId: 'old' })?.id).toBe('old');
  });
  it('falls back to the live roll, then last used, then most recent', () => {
    expect(pickDefaultDestination(rolls)?.id).toBe('live');
    const noLive = rolls.filter((r) => !r.live);
    expect(pickDefaultDestination(noLive, { lastUsedId: 'old' })?.id).toBe('old');
    expect(pickDefaultDestination(noLive)?.id).toBe('recent');
  });
  it('skips rolls with uploads closed and returns null when nothing is usable', () => {
    const closed = [roll({ id: 'x', uploadsClosed: true, live: true })];
    expect(pickDefaultDestination(closed, { preferredId: 'x' })).toBeNull();
    expect(pickDefaultDestination([])).toBeNull();
  });
});

describe('toDestinationRoll', () => {
  const row: RollRow = {
    id: 'r1',
    name: 'Mood Indigo',
    crew_id: 'c1',
    starts_on: null,
    ends_on: null,
    reveal_at: null,
    locked_until: null,
    allow_uploads: false,
    created_by: 'u2',
    last_activity_at: null,
    cover_photo_id: null,
    crews: { id: 'c1', name: 'Block C', tint: 'lime', deleted_at: null },
  };
  const ctx = { liveIds: new Set<string>(), adminCrewIds: new Set<string>(), meId: 'u1' };
  it('marks uploads closed for non-admins and open for admins / creators', () => {
    expect(toDestinationRoll(row, ctx)?.uploadsClosed).toBe(true);
    expect(toDestinationRoll(row, { ...ctx, adminCrewIds: new Set(['c1']) })?.uploadsClosed).toBe(
      false,
    );
    expect(toDestinationRoll({ ...row, created_by: 'u1' }, ctx)?.uploadsClosed).toBe(false);
  });
  it('drops rolls of deleted crews and flags sealed rolls', () => {
    const deleted = {
      ...row,
      crews: { id: 'c1', name: 'x', tint: 'lime' as const, deleted_at: 'x' },
    };
    expect(toDestinationRoll(deleted, ctx)).toBeNull();
    const sealed = toDestinationRoll(
      { ...row, allow_uploads: true, reveal_at: '2026-03-12T09:00:00Z' },
      { ...ctx, now: Date.parse('2026-03-12T00:00:00Z') },
    );
    expect(sealed?.sealed).toBe(true);
  });
});

describe('labels and sections', () => {
  it('labels', () => {
    expect(destinationLabel(null)).toBe('Choose where');
    expect(destinationLabel(roll({}))).toBe("Goa '26");
    expect(addLabel(38, "Goa '26")).toBe("Add 38 to Goa '26");
    expect(addLabel(0, "Goa '26")).toBe("Add to Goa '26");
    expect(postedMessage(1, "Goa '26")).toBe("Posted to Goa '26");
    expect(postedMessage(3, "Goa '26")).toBe("Posted 3 to Goa '26");
  });
  it('sections live first and filters by name', () => {
    const rolls = [roll({ id: 'a', live: false }), roll({ id: 'b', live: true, name: 'Sangeet' })];
    const s = sectionDestinations(rolls);
    expect(s.live.map((r) => r.id)).toEqual(['b']);
    expect(s.recent.map((r) => r.id)).toEqual(['a']);
    expect(filterDestinations(rolls, 'sang').map((r) => r.id)).toEqual(['b']);
    expect(filterDestinations(rolls, 'goa gang')).toHaveLength(2);
  });
});
