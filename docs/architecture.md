# Dumpr architecture (v1, MVP)

Owner: orchestrator (architect role). This file is the contract every build agent codes against.
If you need to deviate, write the deviation and the reason in your report; do not silently change a contract.

Product source of truth: `docs/blueprint/*.md` (transcribed from the UI/UX blueprint PDF).

## 1. Systems

| Piece | Tech | Notes |
|---|---|---|
| Mobile (Android + iOS) | Expo SDK 57, RN 0.86, expo-router, NativeWind, TanStack Query, Zustand, expo-sqlite | `apps/mobile`. Must run in **Expo Go** for everything except features marked *dev build*. |
| Web | Next.js 16 App Router on Vercel | `apps/web`. Guest join + upload (`/r/[code]`, `/c/[code]`), OG preview cards, deep-link association files, marketing. |
| Database / auth / realtime | Supabase project `evxufdovegjrlwpxfmhl` (ap-south-1) | One database for iOS, Android and web. |
| Server logic | Postgres RPCs (security definer) + Supabase Edge Functions (Deno) | |
| Photo bytes | Cloudflare R2 bucket (private), presigned URLs | Zero egress fees. Never Supabase Storage. |
| SMS OTP | MSG91 through Supabase **Send SMS hook** → Edge Function `send-sms-msg91` | |
| Push | Expo Push API → FCM / APNs | |
| Jobs | `pg_cron` + `pg_net` | Hourly upload digest, per-minute push dispatch, daily purge. |

Shared TS packages: `@dumpr/core` (pure domain logic, no platform imports, also imported by edge functions via relative path), `@dumpr/db` (generated `Database` types + client factory), `@dumpr/ui-tokens`.

## 2. Identity

* `auth.users` is Supabase's. Sign-in methods: phone OTP (MSG91 hook), Apple, Google, **anonymous** (guests).
* Guests: web (and app "continue as guest" from an invite) call `signInAnonymously()`. JWT carries `is_anonymous: true`. Upgrading (`updateUser({ phone })` + verify, or `linkIdentity`) keeps the same `auth.uid()`, so guest uploads stay theirs.
* A trigger on `auth.users` (insert + update of `is_anonymous`, `raw_user_meta_data`) upserts `public.profiles` (`is_guest = is_anonymous`).
* Helper `private.is_guest()` = `coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)`.
* Guests may: join a Roll through an invite that allows guests, view it, upload to it (unless the host disabled guest uploads), download single photos. Guests may NOT: create crews/rolls, chat, react, invite, be added to crews.

## 3. Schema (public)

All tables: `id uuid primary key default gen_random_uuid()` unless stated, `created_at timestamptz not null default now()`. RLS enabled on **every** table. Clients never insert into a table directly unless the table's section says "direct insert". Everything else goes through RPCs.

### Enums
```
member_role      : host | cohost | member            -- crew roles
roll_member_role : member | guest                    -- roll-only access (people invited to one Roll)
photo_status     : pending | ready | review | removed
photo_visibility : everyone | selected | only_me
photo_kind       : roll | snap                       -- snap = P2
reveal_mode      : live | end_of_event | next_morning -- MVP UI ships live only
roll_kind        : wedding | trip | fest | everyday | other
reaction_kind    : ICONIC | LMAO | CRYING | HEART | SAME
tag_kind         : chapter | lore                    -- lore = P2
crew_tint        : lilac | lime | sky | peach | pink | mint
request_status   : pending | approved | denied
report_target    : photo | message | user | crew | roll
activity_kind    : invite | join_request | joined | upload_batch | reaction | mention | reveal
                   | removal_request | photo_removed | crew_deleted | removed_from_crew | guest_review
```

### profiles
`id uuid pk references auth.users on delete cascade`, `display_name text not null check (char_length between 1 and 40)`, `handle text unique` (nullable; check `^[a-z0-9._]{3,24}$`; unique index on `lower(handle)`), `avatar_key text` (check `profiles_avatar_key_own`: null or `a/<own id>/<uuid>.jpg`; the column is client-writable, so nothing may sign or purge it unless it matches that prefix), `ring_color text not null default 'lime' check in (lime, lilac, sky, peach)`, `birthday_day smallint`, `birthday_month smallint` (both null or both valid), `is_guest boolean not null default false`, privacy: `phone_visible boolean not null default false`, `who_can_add text not null default 'contacts' check in (everyone, contacts, nobody)`, consent flags (P3 hooks, all default false): `consent_stickers`, `consent_discovery`, `consent_then_now`, accounting: `storage_used_bytes bigint not null default 0`, `storage_quota_bytes bigint` (null → global default), `updated_at`.

RLS: select if `id = auth.uid()` or `private.shares_space(id)` (shares any crew, or any roll, or has a pending join request to a crew/roll I administer). Update own row only; **column grants** limit updatable columns to: display_name, handle, avatar_key, ring_color, birthday_day, birthday_month, phone_visible, who_can_add, consent_*. No insert/delete grants.

RPC `check_handle(p_handle text) returns jsonb` → `{available: bool, suggestions: text[3]}` (A3).

### app_settings
`key text pk`, `value jsonb not null`. Seeded: key `limits` = 
```json
{"storage_bytes_per_user": null, "max_photo_bytes": 52428800, "invite_ttl_days": 7,
 "deleted_crew_grace_days": 30, "guest_max_photos_per_roll": 300, "max_upload_parts": 100}
```
`storage_bytes_per_user: null` means "no limit yet" (the plan limit is still `[PLAN LIMIT]` in the design). Select: authenticated + anon. No write grants (owner changes it in SQL). Helper `private.setting(key text, path text) returns jsonb`.

### crews
`name text not null (1..60)`, `tint crew_tint not null`, `cover_photo_id uuid` (fk photos, on delete set null, deferrable), `created_by uuid references profiles`, `last_activity_at timestamptz not null default now()`, `deleted_at timestamptz`, `purge_after timestamptz`, `updated_at`.

### crew_members
pk `(crew_id, user_id)`; `role member_role not null default 'member'`, `muted boolean not null default false`, `invited_by uuid`, `joined_at`. Constraint: exactly ≥1 host per live crew is enforced by RPCs (leave/remove/transfer).
Update: user may update own `muted` only (column grant + policy `user_id = auth.uid()`).

### rolls
`crew_id uuid not null references crews on delete cascade`, `name text not null (1..60)`, `kind roll_kind not null default 'other'`, `cover_photo_id uuid`, `starts_on date`, `ends_on date` (check ends_on >= starts_on), `location_name text`,
reveal hooks: `reveal_mode reveal_mode not null default 'live'`, `reveal_at timestamptz` (null = visible now), `locked_until timestamptz` (time capsule, P2),
surprise hook (P2): `surprise_honoree_id uuid references profiles on delete set null`,
host controls: `allow_uploads bool default true`, `allow_downloads bool default true`, `allow_member_invites bool default true`, `guests_allowed bool default true`, `guest_uploads_review bool default false`,
counters: `photo_count int not null default 0`, `last_activity_at`, `created_by`, `deleted_at`, `updated_at`.
Roll admin (`private.is_roll_admin(roll)`) = crew host/cohost of the roll's crew OR `rolls.created_by`.
Update: roll admin only, column grants on: name, kind, cover_photo_id, starts_on, ends_on, location_name, reveal_mode, reveal_at, locked_until, allow_*, guests_allowed, guest_uploads_review.

### roll_members (roll-only access)
pk `(roll_id, user_id)`, `role roll_member_role`, `muted bool default false`, `invited_by`, `joined_at`. Used for guests and for people invited to one Roll who are not in the Crew.

### tags (Chapters now, Lore later)
`crew_id not null`, `roll_id` (null for crew-level lore), `kind tag_kind`, `name text (1..40)`, `sort smallint default 0`, `day date`. Unique `(roll_id, kind, lower(name))`. Select: can see the roll/crew. Insert/update/delete: roll admin (direct, policies).

### photos
```
id uuid pk                       -- CLIENT-generated (idempotent upload-init); default gen_random_uuid()
crew_id uuid not null            -- denormalised, = roll.crew_id
roll_id uuid                     -- null only for kind = snap (P2)
kind photo_kind not null default 'roll'
uploader_id uuid not null references profiles on delete cascade
chapter_id uuid references tags on delete set null
status photo_status not null default 'pending'
visibility photo_visibility not null default 'everyone'
content_hash text not null       -- 'md5:<hex>' of original bytes
mime text not null, bytes bigint not null, width int, height int
taken_at timestamptz             -- EXIF DateTimeOriginal if known
sort_at timestamptz not null     -- coalesce(taken_at, created_at), set by trigger
original_key text not null, display_key text not null, thumb_key text not null   -- R2 keys
blurhash text
caption text check (char_length <= 280)
lat double precision, lng double precision, place_name text   -- P2 passport, only if user allowed
removed_at timestamptz, removed_by uuid, removed_reason text
updated_at
```
Indexes: unique `(roll_id, content_hash) where status <> 'removed'` (de-dupe), `(roll_id, sort_at desc, id desc) where status = 'ready'` (grid keyset), `(uploader_id, created_at desc)`, `(crew_id) where kind = 'snap'`.

**R2 keys** (set by `upload-init`, never by clients):
`o/{crew_id}/{roll_id}/{photo_id}` (original, as uploaded), `d/{crew_id}/{roll_id}/{photo_id}.jpg` (display, JPEG, long edge 2048, q≈0.85), `t/{crew_id}/{roll_id}/{photo_id}.jpg` (thumb, JPEG, long edge 480, q≈0.7). Avatars: `a/{user_id}/{uuid}.jpg`.

### photo_audience
pk `(photo_id, user_id)`. Used when `visibility = 'selected'` (Ghost Mode).

### reactions
pk `(photo_id, user_id)`, `kind reaction_kind`. One reaction per person per photo (re-react replaces). Direct insert/update/delete of own row when the photo is visible and the user is not a guest.
RPC-free counts: view `photo_reaction_counts(photo_id, kind, n)` (security_invoker).

### messages (Crew chat and Roll chat)
`crew_id not null`, `roll_id` (null = Crew chat), `thread_key text generated always as (case when roll_id is null then 'c:' || crew_id else 'r:' || roll_id end) stored`, `author_id not null`, `client_id uuid not null unique` (idempotent retry), `body text (<= 2000)`, `photo_id uuid` (photo message or reply-to-photo), `reply_to_id uuid references messages`, `kind text check in (text, photo, system)`, `deleted_at`.
Index `(thread_key, created_at desc)`. **Direct insert** allowed: `author_id = auth.uid()`, not guest, member of thread, `photo_id` null or visible (subquery under RLS).
`message_reactions` pk `(message_id, user_id)`, `kind reaction_kind`.
`thread_reads` pk `(user_id, thread_key)`, `last_read_at`. RPC `mark_thread_read(p_thread_key)`.

### invites (links / QR / WhatsApp)
`code text unique not null` (10 chars from `abcdefghjkmnpqrstuvwxyz23456789`), `crew_id not null`, `roll_id` (null = whole-Crew invite), `created_by`, `expires_at not null` (default now + invite_ttl_days), `max_uses int`, `use_count int default 0`, `requires_approval bool default false`, `allow_guests bool default true` (roll invites only), `revoked_at`.
Links: `https://dumpr.app/r/{code}` (roll) and `https://dumpr.app/c/{code}` (crew). App scheme fallback `dumpr://r/{code}`.

### direct_invites (in-app invite to an existing user → Inbox card + push)
`invite_id references invites`, `invitee_id`, `status request_status default 'pending'`, unique `(invite_id, invitee_id)`.

### join_requests
`crew_id not null`, `roll_id`, `user_id not null`, `invite_id`, `status request_status default 'pending'`, `decided_by`, `decided_at`. Unique pending per `(user_id, crew_id, coalesce(roll_id, zero-uuid))`.

### moderation
`reports`: `reporter_id`, `target report_target`, `target_id uuid`, `crew_id`, `reason text (<= 500)`, `status request_status default 'pending'`, `decided_by`, `decided_at`. Hosts/cohosts of `crew_id` see and decide them (moderation queue). Reporter sees own.
`removal_requests`: `photo_id`, `requester_id`, `reason`, `status`, `decided_by`, `decided_at`. Uploader and roll admins see/decide; requester sees own.
`blocks`: pk `(blocker_id, blocked_id)`. Direct insert/delete of own rows. Blocked users cannot add you to crews (checked in RPCs); clients hide content from blocked users.

### notifications
`push_tokens`: `token text pk`, `user_id`, `platform text check in (ios, android, web)`, `last_seen_at`. Direct upsert/delete of own rows.
`notification_prefs`: `user_id pk`, booleans `invites, uploads, chats, reveals, games` default true. Direct upsert own.
`activity_events`: `id bigint generated always as identity pk`, `recipient_id not null`, `actor_id`, `crew_id`, `roll_id`, `photo_id`, `kind activity_kind`, `payload jsonb not null default '{}'`, `instant bool not null default true`, `created_at`, `read_at`, `pushed_at`. Index `(recipient_id, created_at desc)`, partial `(created_at) where pushed_at is null`. Select own only. Updates via RPC `mark_activity_read(p_ids bigint[] default null)` (null = all).
`upload_batches`: pk `(roll_id, uploader_id, bucket_start)`, `photo_count int`, `sample_photo_ids uuid[]` (≤4), `notified_at`. Written only by trigger. No client grants.

### media_uploads (server only)
`photo_id pk references photos on delete cascade`, `multipart_upload_id text`, `part_size int`, `parts int`, `expires_at`. No client grants at all.

## 4. Access helpers (schema `private`, not exposed by PostgREST)

All `security definer`, `stable`, `set search_path = ''`, fully-qualified names, `(select auth.uid())`.

```
private.my_crew_ids()        returns uuid[]  -- crews where I'm a crew_member (crew not purged)
private.my_roll_ids()        returns uuid[]  -- rolls of my crews + my roll_members rolls,
                                             -- EXCLUDING rolls where surprise_honoree_id = me and now() < reveal_at
private.my_open_roll_ids()   returns uuid[]  -- my_roll_ids() minus sealed ones (reveal_at > now() or locked_until > now())
private.my_admin_roll_ids()  returns uuid[]  -- rolls where is_roll_admin
private.my_visible_crew_ids() returns uuid[] -- my_crew_ids() ∪ crews of my roll-only rolls
private.is_crew_admin(crew uuid) returns bool
private.is_roll_admin(roll uuid) returns bool
private.can_upload(roll uuid) returns bool   -- access, not deleted, allow_uploads (admins always), guest rules
private.shares_space(other uuid) returns bool
private.is_guest() returns bool
```
**Policy pattern (performance-critical):** compare against the array once per statement, never call a per-row function:
```sql
using (roll_id = any ((select private.my_roll_ids())::uuid[]))
```

### photos select policy (the privacy core)
```
uploader_id = (select auth.uid())
or ( status = 'ready'
     and roll_id = any ((select private.my_open_roll_ids()))
     and ( visibility = 'everyone'
           or (visibility = 'selected' and exists (select 1 from photo_audience a
                                                   where a.photo_id = photos.id and a.user_id = (select auth.uid()))) ) )
or ( status = 'review' and roll_id = any ((select private.my_admin_roll_ids())) )
or ( kind = 'snap' and status = 'ready' and crew_id = any ((select private.my_crew_ids())) )   -- P2
```
Consequences that tests must prove: sealed rolls leak nothing but your own photos; the Surprise honoree cannot see the roll row, its photos, its chat, its activity or its invites; `only_me` photos are uploader-only; `selected` photos are audience-only; removed photos are invisible to everyone but the uploader (uploader sees the `removed` row so the client can show F6 "This photo was removed").

Photos have **no** client insert grant (only `upload-init`, service role). Update: uploader may update `caption`, `chapter_id`, `visibility` (column grants; policy uploader = me). Roll admin changes go through RPCs.

## 5. RPCs (public, `security definer`, validate everything, raise `exception using errcode = 'P0001', message = '<snake_code>'`)

Error messages are stable snake_case codes the clients map to copy: `not_authenticated`, `guest_not_allowed`, `not_a_member`, `not_admin`, `invite_not_found`, `invite_expired`, `invite_revoked`, `invite_full`, `guests_not_allowed`, `uploads_disabled`, `downloads_disabled`, `already_member`, `blocked`, `last_host`, `invalid_input`, `handle_taken`, `crew_deleted`.

| RPC | Who | Returns / effect |
|---|---|---|
| `check_handle(p_handle)` | anon/auth | `{available, suggestions[]}` |
| `create_crew(p_name, p_tint)` | non-guest | crew row; creator becomes host |
| `create_roll(p_crew_id, p_name, p_kind, p_starts_on, p_ends_on, p_reveal_mode default 'live', p_chapters text[] default '{}')` | non-guest crew member | roll row; chapters inserted as tags with sort order |
| `update_crew(p_crew_id, p_name, p_tint, p_cover_photo_id)` | crew admin | crew row |
| `create_invite(p_crew_id, p_roll_id, p_ttl_days, p_requires_approval, p_allow_guests, p_max_uses)` | admin, or member if `allow_member_invites` | `{code, url, expires_at}` (reuses an existing un-expired, un-revoked invite with identical settings created by the same user) |
| `revoke_invite(p_code)` | admin or creator | void |
| `invite_preview(p_code)` | **anon + auth** | `{status: ok|expired|revoked|full|not_found, kind: crew|roll, crew:{id,name,tint}, roll:{id,name,starts_on,ends_on,photo_count,sealed,reveal_at}|null, host:{display_name,avatar_key}, member_count, facepile:[{display_name,avatar_key,ring_color}] (≤5), cover_thumb_key|null, requires_approval, allow_guests, viewer:{is_member, request_pending}}`. Never returns photo keys of sealed rolls. Never returns phones. A dead link (`revoked`/`expired`/`full`) returns only `{status, kind, host:{display_name}}`; `revoked` also covers a link whose creator no longer has the authority to create it (removed from the crew, demoted from admin for a crew link, left the roll, deleted account). `avatar_key`s are only returned when under the profile's own `a/<id>/` prefix. |
| `join_via_invite(p_code)` | auth (guest only if roll invite with allow_guests and roll.guests_allowed; `invite_revoked` when the creator lost their authority; `request_cooldown` when a join request to the same space was denied < 24 h ago) | `{status: joined|requested|already_member, crew_id, roll_id}`; increments use_count; inserts crew_members(member) for crew invites, roll_members(member|guest) for roll invites when not already a crew member; creates join_request when requires_approval; activity `joined` / `join_request` to admins |
| `decide_join_request(p_id, p_approve)` | admin | void |
| `invite_users(p_crew_id, p_roll_id, p_user_ids uuid[])` | as create_invite | creates/reuses invite + direct_invites + activity `invite` (respects blocks and `who_can_add`) |
| `respond_direct_invite(p_id, p_accept)` | invitee | `{status, crew_id, roll_id}` |
| `set_member_role(p_crew_id, p_user_id, p_role)` | host | void (cannot demote last host) |
| `remove_member(p_crew_id, p_user_id)` | admin (cohost can't remove host) | void + activity `removed_from_crew` |
| `leave_crew(p_crew_id)` / `leave_roll(p_roll_id)` | member | void (`last_host` if sole host with other members) |
| `transfer_host(p_crew_id, p_user_id)` | host | void |
| `delete_crew(p_crew_id)` | host | soft delete: `deleted_at = now()`, `purge_after = now() + grace`; activity `crew_deleted` to all members |
| `set_photo_visibility(p_photo_id, p_visibility, p_audience uuid[])` | uploader | void |
| `remove_photo(p_photo_id, p_reason)` | uploader or roll admin | status → removed; activity `photo_removed` to uploader if removed by admin |
| `request_photo_removal(p_photo_id, p_reason)` | anyone who can see it | removal_request + activity to uploader & admins |
| `decide_removal_request(p_id, p_approve)` | uploader or admin | void |
| `review_guest_photos(p_photo_ids uuid[], p_approve bool)` | roll admin | review → ready / removed |
| `report(p_target, p_target_id, p_reason)` | auth | report row; reported messages hidden for reporter immediately (client) |
| `decide_report(p_id, p_action text)` | crew admin | `dismiss` / `remove` |
| `mark_thread_read(p_thread_key)` / `mark_activity_read(p_ids)` | auth | void |
| `home_feed()` | auth | ONE call for B1: `{live_rolls:[...], pending_invites:[...], crews:[{id,name,tint,role,muted,member_count,facepile(≤5),last_activity_at,unread_count,stack:[thumb_key ≤3],live_roll:{id,name}|null}]}` ordered by last_activity_at desc. No N+1 from the client. |
| `crew_overview(p_crew_id)` | member | crew + members(role) + rolls (id,name,kind,cover thumb_key,photo_count,starts_on,ends_on,sealed,reveal_at) |
| `roll_header(p_roll_id)` | roll access | roll + chapters + my role/admin flag + counts (`photo_count`, `my_pending`, `sealed`) + contributor facepile |
| `inbox_threads()` | auth | one row per crew/roll thread I'm in: last message preview, unread count, tint |
| `my_storage()` | auth | `{used_bytes, limit_bytes|null, by_crew:[{crew_id,name,tint,bytes}]}` |
| `my_profile_stats()` | auth | `{rolls, crews, photos}` (F5 strip) |

Grid paging is a plain RLS-protected select (keyset):
```
from photos select id, uploader_id, sort_at, width, height, thumb_key, display_key, blurhash, chapter_id, status, visibility, caption
where roll_id = $1 and status in ('ready','review') [and chapter_id = $2]
and (sort_at, id) < ($cursor_sort_at, $cursor_id) order by sort_at desc, id desc limit 60
```
plus the caller's own `pending` rows (they're visible only to the uploader anyway).

## 6. Triggers

* `auth.users` after insert/update → upsert `profiles` (display_name from `raw_user_meta_data.display_name`/`full_name`/`name` else `'Guest'` for anonymous / `'New user'`), `is_guest`.
* `photos` before insert/update: `sort_at = coalesce(taken_at, created_at)`, `updated_at`.
* `photos` after update of `status`:
  * → `ready`: `rolls.photo_count += 1`, `rolls/crews.last_activity_at = now()`, roll/crew `cover_photo_id` set if null, `profiles.storage_used_bytes += bytes`, upsert `upload_batches` for `date_trunc('hour', now())`.
  * `ready` → `removed`: counters down, storage down.
  * `pending` → `review`: activity `guest_review` (instant) to roll admins.
* `messages` after insert: `last_activity_at`, `@handle` mentions → activity `mention` (instant) for mentioned members of the thread.
* `crew_members` / `roll_members` after insert → activity `joined` (instant=false, no push) to admins.
* `rolls` after update of `reveal_at` crossing now is handled by the cron job `private.fire_reveals()` (activity `reveal`, instant) — P2, but the function exists.

## 7. Jobs (pg_cron; skipped gracefully when the extension is missing, e.g. local tests)

| Job | Schedule | Does |
|---|---|---|
| `private.fanout_upload_batches()` | `5 * * * *` | closed hour buckets (`bucket_start < date_trunc('hour', now())`, `notified_at is null`) → one `upload_batch` activity per non-muted member (not the uploader), payload `{count, uploader_name, roll_name, sample_photo_ids}`, `instant=false`; marks notified. Copy: "Diya added 24 to Goa '26". |
| push dispatch | every minute | `pg_net` POST to Edge Function `push-dispatch` with header `x-cron-secret` (from Vault secret `cron_secret`). |
| `private.purge_deleted()` | daily 03:17 | hard-delete crews past `purge_after` (R2 objects are deleted by the `media-purge` path of `account` function — queue rows in `media_purge_queue(key text)`). |

`media_purge_queue(key text pk, enqueued_at)` filled by triggers when photos are removed (after 7 days grace for undo) / crews purged / accounts deleted; drained by `push-dispatch`'s sibling path `?job=purge` (same function, cheap).

## 8. Edge Functions (Deno, `supabase/functions/<name>/index.ts`)

All functions: deployed with `verify_jwt = false` and authenticate **in code** (works with both the legacy anon JWT and the new `sb_publishable_` keys): `requireUser(req)` reads `Authorization: Bearer <access token>`, calls `admin.auth.getUser(token)`; returns `{ user, isGuest, userClient /* RLS as the user */, admin /* service role */ }`. CORS for `https://dumpr.app`, `http://localhost:3000`, and native (no Origin).

Shared (`supabase/functions/_shared/`): `http.ts` (cors, `json()`, `fail(code, status)`), `auth.ts`, `r2.ts` (SigV4 via `aws4fetch`: `presignPut`, `presignGet`, `createMultipart`, `presignPart`, `completeMultipart`, `abortMultipart`, `headObject`, `deleteObjects`), `push.ts` (Expo push, chunks of 100), `env.ts`.
Errors: `{ "error": { "code": "<snake_code>", "message": "...", "details"?: ... } }` with HTTP 400/401/403/404/409/413/503 (see `_shared/http.ts` `serve()`; a P0001 RPC exception with a snake_code message becomes a 400 with that code).

| Function | Request | Response |
|---|---|---|
| `upload-init` | `{photo_id, roll_id, content_hash, mime, bytes, width, height, taken_at?, chapter_id?, caption?, display_bytes, thumb_bytes}` | `{status:'duplicate', existing_photo_id?}` (id only when the caller can see that photo through RLS) or `{status:'upload', photo_id, original: {mode:'put', url, headers, content_length} | {mode:'multipart', upload_id, part_size, parts:[{n,url,content_length}]}, display:{url,headers,content_length}, thumb:{url,headers,content_length}, expires_at}`. **Every presigned PUT signs `content-type` (single PUTs) and `content-length` (exact body size; per part for multipart)**: clients send exactly `headers` and a body of `content_length` bytes (the HTTP stack sets the Content-Length header itself). `display_bytes`/`thumb_bytes` are stored in `media_uploads` and verified exactly by `upload-complete`. More than 500 unfinished (`pending`) uploads per user → 429 `rate_limited`; their bytes count toward the quota. Idempotent on `photo_id` (re-init returns fresh URLs for a `pending` photo owned by caller). Checks: access, `can_upload`, guest limits, `max_photo_bytes`, quota (`storage_used_bytes + bytes > limit` → 413 `storage_full`). Multipart when `bytes > 16 MiB`, part 8 MiB. |
| `upload-complete` | `{photo_id, parts?:[{n, etag}], blurhash?}` | `{status:'ready'|'review', photo}`. Completes multipart, HEADs all 3 objects (exact sizes: original = `bytes`, display / thumb = the sizes recorded at init; `Content-Type` = declared mime / `image/jpeg`; single-PUT ETag must equal md5 of `content_hash`), flips status. |
| `media-sign` | `{items:[{photo_id, variant:'thumb'|'display'|'original'}]}` (≤ 300) or `{avatar_keys:[...]}` | `{urls:{[photo_id+':'+variant]: url}, expires_at}`. Selects the photos **through `userClient`** (RLS decides visibility); `original` additionally requires `allow_downloads` unless uploader/admin. URL TTL 6 h. Clients cache by `cacheKey = photo_id:variant`, never by URL. |
| `invite-preview` | `GET ?code=` (anon ok) | `invite_preview` RPC result (called with the caller's `Authorization` when it is a user token, else as anon; user-token responses are `Cache-Control: private, no-store`) + `cover_url` (signed thumb, only when not sealed) + `facepile[].avatar_url`. Used by web landing + OG image + app A4. |
| `push-dispatch` | cron (`x-cron-secret`) | claims ≤ 500 un-pushed instant events via `private.claim_push_batch()`, honours prefs + mutes, sends Expo pushes, marks `pushed_at`, deletes `DeviceNotRegistered` tokens. `?job=purge` drains `media_purge_queue`. |
| `account` | `POST {action:'export'}` / `{action:'delete', confirm:'DELETE'}` | export: `{profile, crews, photos:[{id, roll, taken_at, url (24 h)}]}`; delete: refuses `last_host` (list of crews to transfer), queues R2 deletes, deletes auth user. |
| `send-sms-msg91` | Supabase Send-SMS hook (Standard Webhooks signature, secret `SEND_SMS_HOOK_SECRET`) | sends only to Indian mobiles (`^91[6-9]\d{9}$`, widen with `SMS_ALLOWED_PREFIXES`, else hook error `sms_country_not_supported`); calls MSG91 OTP/Flow API with `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` (DLT), `MSG91_SENDER_ID`; message `"<#> {otp} is your Dumpr code. It expires in 10 minutes. {android_hash}"` where `MSG91_ANDROID_HASH` enables SMS Retriever auto-read. |

Secrets (set with `supabase secrets set` / dashboard): `R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, CRON_SECRET, SEND_SMS_HOOK_SECRET, MSG91_AUTH_KEY, MSG91_TEMPLATE_ID, MSG91_SENDER_ID, MSG91_ANDROID_HASH, EXPO_ACCESS_TOKEN (optional)`. Missing R2 secrets → upload/media functions answer `503` with code `storage_not_configured` (clients show "Uploads are paused" not a crash).

R2 bucket CORS (documented in docs/SETUP.md): allow `PUT, GET, HEAD` from `https://dumpr.app`, `http://localhost:3000`, expose `ETag`.

## 9. Upload pipeline (mobile + web)

Owned by the upload-pipeline engineer. Contract:
1. Client picks/captures → creates queue item `{photo_id: uuid v4, roll_id, local_uri, taken_at, chapter_id}` persisted in **expo-sqlite** (mobile) / IndexedDB-free in-memory + `beforeunload` warning (web).
2. Prepare: read size/dimensions, md5 of original (`expo-file-system` `File#md5` on mobile; `spark-md5` incremental on web), generate display (2048) + thumb (480) JPEGs (`expo-image-manipulator` / canvas), blurhash from thumb (pure TS encoder in `@dumpr/core`).
3. `upload-init` → `duplicate` ends the item (tile shows "IN ROLL") / `upload` → PUT thumb, display, original (multipart parts with per-part retry; parts persisted so a restart resumes at the next part).
4. `upload-complete`.
State machine and backoff live in `@dumpr/core/upload` (pure, unit-tested): `queued → preparing → initiating → uploading → completing → done | duplicate | failed(retryable) | blocked(storage_full|uploads_disabled|not_a_member|storage_not_configured) | paused(no_network|wifi_only)`; backoff `min(5s·2^n, 15min) ± 20 % jitter`, max 8 attempts before `failed` needs manual retry. Concurrency 3 items. Wi-Fi-only toggle. Never deletes local originals.

## 10. Mobile app structure

```
src/app/
  _layout.tsx                 providers, fonts, auth gate, deep-link handling (dumpr.app/r|c/<code>, dumpr://)
  (onboarding)/welcome.tsx    A1      phone.tsx A2      profile.tsx A3
  (main)/_layout.tsx          floating nav pill: Crews · Shutter · Inbox
  (main)/index.tsx            B1 Home · Crews
  (main)/inbox.tsx            C6 Chats | Activity
  crew/[id].tsx               B2 (tabs Rolls · Chat; Snaps/Lore/Play hidden at MVP)
  roll/[id].tsx               B3 grid, chapters, select mode
  photo/[id].tsx              B4 viewer (modal)
  invite/[code].tsx           A4 join preview
  camera.tsx                  C1 (fullScreenModal)
  import.tsx                  C3 (fullScreenModal)
  uploads.tsx                 C4
  chat/[thread].tsx           C5   (thread = c:<crew> | r:<roll>)
  you/index.tsx F5   you/privacy.tsx F3   you/storage.tsx F4   you/edit.tsx
  sheets/create.tsx B5  sheets/invite.tsx B6  sheets/destination.tsx C2  sheets/download.tsx F1
  sheets/photo-actions.tsx F2  sheets/roll-settings.tsx  (presentation: 'formSheet')
src/ui/        primitives: Button (primary lime / strong ink / secondary / tertiary / destructive), Text (display/title/heading/body/caption/stamp), Sheet, Toast (+Undo), Dialog, Chip, ReactionChip, Stamp, Facepile, Avatar(ring), PhotoTile (default/selected/uploading/failed/duplicate/sealed), EdgeState (F6), PermissionPrimer (A6), Skeleton, NavPill, Screen
src/data/      supabase client, query hooks per domain, realtime subscriptions, media URL cache (useSignedUrl batching)
src/features/  uploads (queue, sqlite store, worker), downloads, auth, invites, notifications(push registration)
src/lib/       errors (code → copy), format (dates, bytes), deeplinks
```
Rules: one lime button per screen; every screen has empty / loading / error states from `docs/blueprint/screens.md`; permissions only at moment of use with the A6 primer; Android back pops one level; copy never blames the user.

## 11. Web structure

`/` marketing · `/r/[code]` and `/c/[code]` invite landing = A5 (server component fetches `invite-preview` for SSR + `generateMetadata` OG tags; `opengraph-image.tsx` renders cover + count card for WhatsApp) · guest flow: name field → `signInAnonymously({options:{data:{display_name}}})` → `join_via_invite` → upload (same pipeline, browser) → grid of latest photos via `media-sign` · sticky "Get the app to keep the full Roll" banner with Play Store / App Store links and `dumpr://r/<code>` open-in-app · `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`.

## 12. Agent ownership map (who touches what)

| Path | Owner |
|---|---|
| `supabase/migrations/**`, `supabase/tests/**`, `supabase/seed.sql` | DB builder (Sonnet) |
| `supabase/functions/_shared/{http,auth,env,r2}.ts` | Orchestrator (contracts, already written) |
| `supabase/functions/{upload-init,upload-complete}/**`, `packages/core/src/upload/**`, `packages/core/src/blurhash/**`, `apps/mobile/src/features/uploads/**` | Upload engineer (Opus) |
| `supabase/functions/{media-sign,invite-preview,push-dispatch,account,send-sms-msg91}/**`, `_shared/push.ts` | Functions builder (Sonnet) |
| `apps/web/**` | Web builder (Sonnet) |
| `apps/mobile/**` except uploads | Mobile builders (Sonnet), split by screen IDs |
| reviews | Security reviewer (Opus), performance reviewer (Opus) — read-only, report findings |

## 13. Known limitations (accepted risks from the security review)

* **Multipart originals are not MD5-verified (F12d).** A single-PUT original must have an ETag equal to the MD5 in `content_hash`. For a multipart original (> 16 MiB) the ETag is not an MD5, so `upload-complete` checks the exact size and Content-Type only. A corrupted or substituted multipart original is therefore detected by the uploader's own client (`checksum_mismatch` is only possible on single PUTs) or not at all. The object is still bound to the uploader's own signed URLs (exact part lengths), cannot exceed `bytes`, and is only ever served to people who may see the photo. Accepted for the MVP; a server-side checksum job would need R2 `x-amz-checksum-*` support for multipart.
* **Guest caps are per anonymous account, not per person (F12e).** `guest_max_photos_per_roll`, quotas and the 500-pending-uploads cap are keyed on `auth.uid()`. A guest who signs in anonymously again gets a fresh account and fresh limits. Mitigations to configure on the Supabase project, not in this repo: enable CAPTCHA (Turnstile) for anonymous sign-ins and keep Auth's per-IP anonymous sign-in rate limit low. Hosts can switch a roll's `guests_allowed` / `guest_uploads_review` off at any time.
* **Realtime DELETE events are not RLS filtered (F13).** Supabase Realtime evaluates RLS for INSERT/UPDATE but cannot for DELETE: every subscriber of `messages`, `activity_events` or `photos` receives the primary key of a deleted row. That discloses an opaque uuid only, as long as the tables keep `REPLICA IDENTITY DEFAULT` (primary key). **Never set `REPLICA IDENTITY FULL` on a published table**: it would put the whole old row (message body, photo keys) into every subscriber's DELETE event. Clients treat DELETE as "remove id from cache" and never rely on its payload.
* **Presigned content-length enforcement depends on R2 (F2).** The upload URLs sign `content-length`. R2 verifies SigV4 over the signed headers, so a request with another length or content type fails with 403 `SignatureDoesNotMatch`; this has been checked against the signing code (`X-Amz-SignedHeaders=content-length;content-type;host`) but not against a live bucket. `upload-complete` re-checks sizes and Content-Type with HEAD, so a bypass would still be caught before a photo becomes `ready`.
