/** Where a shot or import goes (C1 / C2 / C3). Pure, unit-tested. */
import type { CrewTint } from '../../data/types';
import type { DestinationRoll } from '../../data/types-cf';

/** A `rolls` row joined with its crew, as the destination query selects it. */
export interface RollRow {
  id: string;
  name: string;
  crew_id: string;
  starts_on: string | null;
  ends_on: string | null;
  reveal_at: string | null;
  locked_until: string | null;
  allow_uploads: boolean;
  created_by: string | null;
  last_activity_at: string | null;
  cover_photo_id: string | null;
  crews:
    | { id: string; name: string; tint: CrewTint; deleted_at: string | null }
    | { id: string; name: string; tint: CrewTint; deleted_at: string | null }[]
    | null;
}

export interface DestinationContext {
  liveIds: ReadonlySet<string>;
  /** Crews where the viewer is host / cohost (they may upload even when the host paused uploads). */
  adminCrewIds: ReadonlySet<string>;
  meId: string | null;
  now?: number;
}

/** Map a query row to a destination; rows of deleted crews map to null. */
export function toDestinationRoll(row: RollRow, ctx: DestinationContext): DestinationRoll | null {
  const crew = Array.isArray(row.crews) ? row.crews[0] : row.crews;
  if (!crew || crew.deleted_at) return null;
  const now = ctx.now ?? Date.now();
  const isAdmin = ctx.adminCrewIds.has(row.crew_id) || (!!ctx.meId && row.created_by === ctx.meId);
  const sealedAt = Math.max(
    row.reveal_at ? Date.parse(row.reveal_at) : 0,
    row.locked_until ? Date.parse(row.locked_until) : 0,
  );
  return {
    id: row.id,
    name: row.name,
    crewId: row.crew_id,
    crewName: crew.name,
    tint: crew.tint,
    live: ctx.liveIds.has(row.id),
    uploadsClosed: !row.allow_uploads && !isAdmin,
    sealed: sealedAt > now,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    lastActivityAt: row.last_activity_at,
    coverPhotoId: row.cover_photo_id,
  };
}

const activityOf = (r: DestinationRoll) => (r.lastActivityAt ? Date.parse(r.lastActivityAt) : 0);

/**
 * Default destination for the camera / import: the roll in the URL, else the live roll with the
 * latest activity, else the last one used, else the most recently active roll. Rolls where uploads
 * are closed are never picked. Null = ask (destination sheet first).
 */
export function pickDefaultDestination(
  rolls: readonly DestinationRoll[],
  opts: { preferredId?: string | null; lastUsedId?: string | null } = {},
): DestinationRoll | null {
  const usable = rolls.filter((r) => !r.uploadsClosed);
  const byId = (id?: string | null) => (id ? usable.find((r) => r.id === id) : undefined);
  const newestFirst = (a: DestinationRoll, b: DestinationRoll) => activityOf(b) - activityOf(a);
  return (
    byId(opts.preferredId) ??
    [...usable].filter((r) => r.live).sort(newestFirst)[0] ??
    byId(opts.lastUsedId) ??
    [...usable].sort(newestFirst)[0] ??
    null
  );
}

/** Pill text: "Goa '26" or "Choose where". */
export function destinationLabel(roll: Pick<DestinationRoll, 'name'> | null | undefined): string {
  return roll ? roll.name : 'Choose where';
}

/** Primary button copy of the destination sheet / import footer: "Add 38 to Goa '26". */
export function addLabel(count: number, rollName: string): string {
  return count > 0 ? `Add ${count} to ${rollName}` : `Add to ${rollName}`;
}

/** "Posted to Goa '26" / "Posted 3 to Goa '26" for the camera toast. */
export function postedMessage(count: number, rollName: string): string {
  return count <= 1 ? `Posted to ${rollName}` : `Posted ${count} to ${rollName}`;
}

/** Splits destinations into the sheet's sections: live first, then recent (rest by activity). */
export function sectionDestinations(rolls: readonly DestinationRoll[]): {
  live: DestinationRoll[];
  recent: DestinationRoll[];
} {
  const sorted = [...rolls].sort((a, b) => activityOf(b) - activityOf(a));
  return { live: sorted.filter((r) => r.live), recent: sorted.filter((r) => !r.live) };
}

/** Case-insensitive match on roll or crew name. */
export function filterDestinations(
  rolls: readonly DestinationRoll[],
  query: string,
): DestinationRoll[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rolls];
  return rolls.filter(
    (r) => r.name.toLowerCase().includes(q) || r.crewName.toLowerCase().includes(q),
  );
}
