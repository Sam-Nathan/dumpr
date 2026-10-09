/**
 * Narrow local types for the capture / import / chat / inbox / downloads / privacy / storage screens
 * (track C+F). Kept apart from `types.ts` so parallel tracks never conflict. Shapes mirror
 * supabase/migrations/…_rpcs_feeds.sql and docs/architecture.md §3, §5, §8.
 */
import type { CrewTint, MemberRole, ReactionKind, RingColor, WhoCanAdd } from './types';

// ---------------------------------------------------------------- home_feed / roll_header (subset)

export interface HomeFeedLiveRoll {
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

export interface HomeFeedCrewLite {
  id: string;
  name: string;
  tint: CrewTint;
  role: MemberRole;
  muted: boolean;
  last_activity_at: string;
  unread_count: number;
  live_roll: { id: string; name: string } | null;
}

/** The part of `home_feed()` this track reads (same query key as B1: ['home-feed']). */
export interface HomeFeedLite {
  live_rolls: HomeFeedLiveRoll[];
  crews: HomeFeedCrewLite[];
}

export interface RollHeaderLite {
  roll: {
    id: string;
    crew_id: string;
    name: string;
    kind: string;
    starts_on: string | null;
    ends_on: string | null;
    reveal_mode: 'live' | 'end_of_event' | 'next_morning';
    reveal_at: string | null;
    locked_until: string | null;
    allow_uploads: boolean;
    allow_downloads: boolean;
    guests_allowed: boolean;
    created_by: string | null;
  };
  crew: { id: string; name: string; tint: CrewTint; deleted_at: string | null };
  chapters: { id: string; name: string; sort: number; day: string | null }[];
  my: {
    role: string | null;
    is_admin: boolean;
    is_guest: boolean;
    can_upload: boolean;
    muted: boolean;
  };
  photo_count: number;
  my_pending: number;
  sealed: boolean;
}

export interface CrewOverviewLite {
  crew: { id: string; name: string; tint: CrewTint; deleted_at: string | null };
  my: { role: MemberRole; muted: boolean; is_admin: boolean };
  members: {
    user_id: string;
    display_name: string;
    handle: string | null;
    avatar_key: string | null;
    ring_color: RingColor;
    role: MemberRole;
  }[];
  rolls: {
    id: string;
    name: string;
    photo_count: number;
    sealed: boolean;
    live: boolean;
    last_activity_at: string;
  }[];
}

/** A Roll a photo can be posted to (C1 / C2 / C3). */
export interface DestinationRoll {
  id: string;
  name: string;
  crewId: string;
  crewName: string;
  tint: CrewTint;
  live: boolean;
  /** Host paused uploads and the viewer is not an admin. */
  uploadsClosed: boolean;
  sealed: boolean;
  startsOn: string | null;
  endsOn: string | null;
  lastActivityAt: string | null;
  coverPhotoId: string | null;
}

export interface DestinationCrew {
  id: string;
  name: string;
  tint: CrewTint;
}

// ---------------------------------------------------------------- inbox / activity (C6)

export interface InboxThread {
  thread_key: string;
  kind: 'crew' | 'roll';
  crew_id: string;
  roll_id: string | null;
  title: string;
  crew_name: string;
  tint: CrewTint;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_kind: 'text' | 'photo' | 'system' | null;
  last_message_photo_id: string | null;
  last_message_at: string | null;
  last_author_id: string | null;
  last_author_name: string | null;
  unread_count: number;
  muted: boolean;
  last_activity_at: string;
}

export type ActivityKind =
  | 'invite'
  | 'join_request'
  | 'joined'
  | 'upload_batch'
  | 'reaction'
  | 'mention'
  | 'reveal'
  | 'removal_request'
  | 'photo_removed'
  | 'crew_deleted'
  | 'removed_from_crew'
  | 'guest_review';

export interface ActivityActor {
  display_name: string;
  avatar_key: string | null;
  ring_color: RingColor;
}

export interface ActivityEvent {
  id: number;
  recipient_id: string;
  actor_id: string | null;
  crew_id: string | null;
  roll_id: string | null;
  photo_id: string | null;
  kind: ActivityKind;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  actor: ActivityActor | null;
}

// ---------------------------------------------------------------- chat (C5)

export interface ChatAuthor {
  display_name: string;
  avatar_key: string | null;
  ring_color: RingColor;
}

export interface ChatMessage {
  id: string;
  crew_id: string;
  roll_id: string | null;
  thread_key: string;
  author_id: string;
  client_id: string;
  body: string | null;
  photo_id: string | null;
  reply_to_id: string | null;
  kind: 'text' | 'photo' | 'system';
  deleted_at: string | null;
  created_at: string;
  author: ChatAuthor | null;
  reactions: { user_id: string; kind: ReactionKind }[];
  photo: { id: string; sort_at: string | null; roll: { name: string } | null } | null;
}

/** A message that is on its way to the server (optimistic) or failed to get there. */
export interface PendingMessage {
  clientId: string;
  threadKey: string;
  body: string | null;
  photoId: string | null;
  replyToId: string | null;
  kind: 'text' | 'photo';
  createdAt: string;
  status: 'sending' | 'failed';
}

// ---------------------------------------------------------------- storage / stats / privacy

export interface MyStorage {
  used_bytes: number;
  limit_bytes: number | null;
  by_crew: { crew_id: string; name: string; tint: CrewTint; bytes: number }[];
}

export interface MyProfileStats {
  rolls: number;
  crews: number;
  photos: number;
}

export interface ConsentFlags {
  consent_stickers: boolean;
  consent_discovery: boolean;
  consent_then_now: boolean;
}

export interface PrivacySettings extends ConsentFlags {
  who_can_add: WhoCanAdd;
  phone_visible: boolean;
}

export interface BlockedPerson {
  blocked_id: string;
  created_at: string;
  profile: { display_name: string; avatar_key: string | null; ring_color: RingColor } | null;
}

export interface HostedRoll {
  id: string;
  name: string;
  crew_id: string;
  crew_name: string;
  tint: CrewTint;
  allow_uploads: boolean;
  allow_downloads: boolean;
  guests_allowed: boolean;
}

export interface NotificationPrefs {
  invites: boolean;
  uploads: boolean;
  chats: boolean;
  reveals: boolean;
  games: boolean;
}

/** `account` function, action export. */
export interface AccountExport {
  exported_at: string;
  url_expires_in_hours: number;
  profile: unknown;
  crews: { id: string; name: string; role: string }[];
  photos: {
    id: string;
    roll_id: string | null;
    roll_name: string | null;
    taken_at: string | null;
    caption: string | null;
    url: string;
  }[];
  truncated: boolean;
}

export interface LastHostCrew {
  id: string;
  name: string;
}

// ---------------------------------------------------------------- photos (F1 / F2)

export interface PhotoRowLite {
  id: string;
  roll_id: string | null;
  crew_id: string;
  uploader_id: string;
  status: 'pending' | 'ready' | 'review' | 'removed';
  visibility: 'everyone' | 'selected' | 'only_me';
  sort_at: string;
  mime: string;
  bytes: number;
  chapter_id: string | null;
  blurhash: string | null;
  uploader: { display_name: string } | null;
  roll: { name: string } | null;
}

export interface RollPhotoRef {
  id: string;
  sortAt: string;
  uploaderId: string;
  mime: string;
  bytes: number;
  chapterId: string | null;
  blurhash: string | null;
}
