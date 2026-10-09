/**
 * Narrow types for the read-model RPCs and rows track B consumes (docs/architecture.md §5, shapes as
 * built in supabase/migrations/…_rpcs_feeds.sql). Kept apart from `types.ts` to avoid merge conflicts.
 */
import type { CrewTint, MemberRole, ReactionKind, RingColor } from './types';

export type RollKind = 'wedding' | 'trip' | 'fest' | 'everyday' | 'other';
export type RevealMode = 'live' | 'end_of_event' | 'next_morning';
export type PhotoStatus = 'pending' | 'ready' | 'review' | 'removed';
export type PhotoVisibility = 'everyone' | 'selected' | 'only_me';

export interface PersonRef {
  id: string;
  display_name: string;
  avatar_key: string | null;
  ring_color?: RingColor;
}

// ---- home_feed() (B1) -------------------------------------------------------------------------

export interface HomeLiveRoll {
  id: string;
  name: string;
  crew_id: string;
  crew_name: string;
  crew_tint: CrewTint;
  photo_count: number;
  starts_on: string | null;
  ends_on: string | null;
  sealed: boolean;
  reveal_at: string | null;
  cover_thumb_key: string | null;
  last_activity_at: string;
}

export interface PendingDirectInvite {
  id: string;
  invite_code: string;
  kind: 'crew' | 'roll';
  crew: { id: string; name: string; tint: CrewTint };
  roll: { id: string; name: string } | null;
  inviter: { id: string; display_name: string; avatar_key: string | null } | null;
  expires_at: string;
  created_at: string;
}

export interface HomeCrew {
  id: string;
  name: string;
  tint: CrewTint;
  role: MemberRole;
  muted: boolean;
  member_count: number;
  facepile: PersonRef[];
  last_activity_at: string;
  unread_count: number;
  /** Thumb keys (`t/<crew>/<roll>/<photo>.jpg`), newest first, at most 3. */
  stack: string[];
  live_roll: { id: string; name: string } | null;
  deleted_at: string | null;
  purge_after: string | null;
}

export interface HomeFeed {
  live_rolls: HomeLiveRoll[];
  pending_invites: PendingDirectInvite[];
  crews: HomeCrew[];
}

/** `respond_direct_invite` */
export interface RespondInviteResult {
  status: 'joined' | 'requested' | 'already_member' | 'declined';
  crew_id: string;
  roll_id: string | null;
}

// ---- crew_overview(p_crew_id) (B2) ------------------------------------------------------------

export interface CrewMember {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_key: string | null;
  ring_color: RingColor;
  role: MemberRole;
  joined_at: string;
}

export interface CrewRollSummary {
  id: string;
  name: string;
  kind: RollKind;
  cover_thumb_key: string | null;
  photo_count: number;
  starts_on: string | null;
  ends_on: string | null;
  sealed: boolean;
  reveal_at: string | null;
  locked_until: string | null;
  live: boolean;
  last_activity_at: string;
}

export interface CrewOverview {
  crew: {
    id: string;
    name: string;
    tint: CrewTint;
    cover_thumb_key: string | null;
    last_activity_at: string;
    deleted_at: string | null;
    purge_after: string | null;
    created_by: string | null;
  };
  my: { role: MemberRole; muted: boolean; is_admin: boolean };
  pending_join_requests: number;
  members: CrewMember[];
  rolls: CrewRollSummary[];
}

// ---- roll_header(p_roll_id) (B3) --------------------------------------------------------------

export interface RollChapter {
  id: string;
  name: string;
  sort: number;
  day: string | null;
}

export interface RollSettings {
  id: string;
  crew_id: string;
  name: string;
  kind: RollKind;
  cover_thumb_key: string | null;
  starts_on: string | null;
  ends_on: string | null;
  location_name: string | null;
  reveal_mode: RevealMode;
  reveal_at: string | null;
  locked_until: string | null;
  allow_uploads: boolean;
  allow_downloads: boolean;
  allow_member_invites: boolean;
  guests_allowed: boolean;
  guest_uploads_review: boolean;
  created_by: string | null;
  last_activity_at: string;
}

export interface RollHeader {
  roll: RollSettings;
  crew: {
    id: string;
    name: string;
    tint: CrewTint;
    deleted_at: string | null;
    purge_after: string | null;
  };
  chapters: RollChapter[];
  my: {
    role: MemberRole | 'guest' | 'member' | null;
    via: 'crew' | 'roll';
    is_admin: boolean;
    is_guest: boolean;
    can_upload: boolean;
    muted: boolean;
  };
  photo_count: number;
  my_pending: number;
  review_count: number;
  sealed: boolean;
  contributors: (PersonRef & { photo_count: number })[];
}

/** Columns of the keyset grid query (architecture §5). */
export interface GridPhoto {
  id: string;
  uploader_id: string;
  sort_at: string;
  width: number | null;
  height: number | null;
  thumb_key: string;
  display_key: string;
  blurhash: string | null;
  chapter_id: string | null;
  status: PhotoStatus;
  visibility: PhotoVisibility;
  caption: string | null;
}

/** Extra columns the viewer reads for one photo. */
export interface PhotoDetail extends GridPhoto {
  roll_id: string | null;
  crew_id: string;
  mime: string;
  bytes: number;
  taken_at: string | null;
  removed_at: string | null;
}

export interface ReactionState {
  counts: Partial<Record<ReactionKind, number>>;
  mine: ReactionKind | null;
}

// ---- invites ----------------------------------------------------------------------------------

/** `create_invite` */
export interface CreatedInvite {
  code: string;
  url: string;
  expires_at: string;
}

export interface InviteSettings {
  ttlDays: 1 | 7 | 30;
  requiresApproval: boolean;
  allowGuests: boolean;
}

export interface UploaderProfile {
  id: string;
  display_name: string;
  avatar_key: string | null;
  ring_color: RingColor;
}
