/**
 * Narrow local types for the RPC / function results the app consumes (docs/architecture.md §3, §5, §8).
 * `@dumpr/db` Database types are still `any`; when they are generated, replace these gradually.
 */

export type CrewTint = 'lilac' | 'lime' | 'sky' | 'peach' | 'pink' | 'mint';
export type RingColor = 'lime' | 'lilac' | 'sky' | 'peach';
export type ReactionKind = 'ICONIC' | 'LMAO' | 'CRYING' | 'HEART' | 'SAME';
export type PhotoVariant = 'thumb' | 'display' | 'original';
export type MemberRole = 'host' | 'cohost' | 'member';
export type WhoCanAdd = 'everyone' | 'contacts' | 'nobody';

export const CREW_TINTS: readonly CrewTint[] = ['lilac', 'lime', 'sky', 'peach', 'pink', 'mint'];
export const RING_COLORS: readonly RingColor[] = ['lime', 'lilac', 'sky', 'peach'];
export const REACTIONS: readonly ReactionKind[] = ['ICONIC', 'LMAO', 'CRYING', 'HEART', 'SAME'];

/** `public.profiles` row (columns the client reads). */
export interface Profile {
  id: string;
  display_name: string;
  handle: string | null;
  avatar_key: string | null;
  ring_color: RingColor;
  birthday_day: number | null;
  birthday_month: number | null;
  is_guest: boolean;
  phone_visible: boolean;
  who_can_add: WhoCanAdd;
  // Storage usage is not selectable by clients; read it via the my_storage() RPC.
}

/** Columns the profile screen may write (matches the column grants in architecture §3). */
export type ProfileUpdate = Partial<
  Pick<
    Profile,
    | 'display_name'
    | 'handle'
    | 'avatar_key'
    | 'ring_color'
    | 'birthday_day'
    | 'birthday_month'
    | 'phone_visible'
    | 'who_can_add'
  >
>;

/** `check_handle(p_handle)` */
export interface CheckHandleResult {
  available: boolean;
  suggestions: string[];
}

export interface PersonLite {
  display_name: string;
  avatar_key: string | null;
  /** Pre-signed avatar URL, only in the invite-preview function response. */
  avatar_url?: string | null;
  ring_color?: RingColor;
}

export type InvitePreviewStatus = 'ok' | 'expired' | 'revoked' | 'full' | 'not_found';

/** `invite_preview(p_code)` plus the function's signed URLs. */
export interface InvitePreview {
  status: InvitePreviewStatus;
  kind: 'crew' | 'roll';
  crew: { id: string; name: string; tint: CrewTint } | null;
  roll: {
    id: string;
    name: string;
    starts_on: string | null;
    ends_on: string | null;
    photo_count: number;
    sealed: boolean;
    reveal_at: string | null;
  } | null;
  host: PersonLite | null;
  member_count: number;
  facepile: PersonLite[];
  cover_thumb_key: string | null;
  /** Signed thumb URL; absent when the roll is sealed. */
  cover_url?: string | null;
  requires_approval: boolean;
  allow_guests: boolean;
  viewer: { is_member: boolean; request_pending: boolean } | null;
}

/** `join_via_invite(p_code)` */
export interface JoinResult {
  status: 'joined' | 'requested' | 'already_member';
  crew_id: string;
  roll_id: string | null;
}

/** One `{photoId, variant}` request for `useSignedUrls`. */
export interface SignItem {
  photoId: string;
  variant: PhotoVariant;
}
