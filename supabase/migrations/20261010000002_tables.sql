-- 02 · Tables, constraints, indexes (docs/architecture.md §3).
-- RLS is enabled here on EVERY table; policies are in 04_rls, privileges in 10_grants_realtime.
-- Deviations / additions beyond §3 (all internal, documented in the DB builder report):
--   * removal_requests.roll_id / uploader_id  (denormalised so its policy can use the array pattern)
--   * activity_events.push_claimed_at         (lease column for private.claim_push_batch)
--   * media_purge_queue.claimed_at            (lease column for svc_media_purge_claim)

-- ---------------------------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  display_name         text not null check (char_length(display_name) between 1 and 40),
  handle               text unique check (handle ~ '^[a-z0-9._]{3,24}$'),
  avatar_key           text,
  ring_color           text not null default 'lime' check (ring_color in ('lime', 'lilac', 'sky', 'peach')),
  birthday_day         smallint,
  birthday_month       smallint,
  is_guest             boolean not null default false,
  phone_visible        boolean not null default false,
  who_can_add          text not null default 'contacts' check (who_can_add in ('everyone', 'contacts', 'nobody')),
  consent_stickers     boolean not null default false,
  consent_discovery    boolean not null default false,
  consent_then_now     boolean not null default false,
  storage_used_bytes   bigint not null default 0 check (storage_used_bytes >= 0),
  storage_quota_bytes  bigint check (storage_quota_bytes >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint profiles_birthday_valid check (
    (birthday_day is null and birthday_month is null)
    or (birthday_day between 1 and 31 and birthday_month between 1 and 12)
  )
);
create unique index profiles_handle_lower_key on public.profiles (lower(handle)) where handle is not null;

-- ---------------------------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------------------------
create table public.app_settings (
  key    text primary key,
  value  jsonb not null
);

-- ---------------------------------------------------------------------------------------------
-- crews / crew_members
-- ---------------------------------------------------------------------------------------------
create table public.crews (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 60),
  tint             public.crew_tint not null,
  cover_photo_id   uuid,                       -- fk to photos added below (circular)
  created_by       uuid references public.profiles (id) on delete set null,
  last_activity_at timestamptz not null default now(),
  deleted_at       timestamptz,
  purge_after      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index crews_purge_after_idx on public.crews (purge_after) where purge_after is not null;

create table public.crew_members (
  crew_id     uuid not null references public.crews (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.member_role not null default 'member',
  muted       boolean not null default false,
  invited_by  uuid references public.profiles (id) on delete set null,
  joined_at   timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index crew_members_user_idx on public.crew_members (user_id);
create index crew_members_admin_idx on public.crew_members (crew_id) where role in ('host', 'cohost');

-- ---------------------------------------------------------------------------------------------
-- rolls / roll_members
-- ---------------------------------------------------------------------------------------------
create table public.rolls (
  id                    uuid primary key default gen_random_uuid(),
  crew_id               uuid not null references public.crews (id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 60),
  kind                  public.roll_kind not null default 'other',
  cover_photo_id        uuid,                  -- fk to photos added below (circular)
  starts_on             date,
  ends_on               date,
  location_name         text,
  reveal_mode           public.reveal_mode not null default 'live',
  reveal_at             timestamptz,
  locked_until          timestamptz,
  surprise_honoree_id   uuid references public.profiles (id) on delete set null,
  allow_uploads         boolean not null default true,
  allow_downloads       boolean not null default true,
  allow_member_invites  boolean not null default true,
  guests_allowed        boolean not null default true,
  guest_uploads_review  boolean not null default false,
  photo_count           integer not null default 0 check (photo_count >= 0),
  last_activity_at      timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint rolls_dates_ordered check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index rolls_crew_idx on public.rolls (crew_id) where deleted_at is null;
create index rolls_honoree_idx on public.rolls (surprise_honoree_id) where surprise_honoree_id is not null;
create index rolls_reveal_idx on public.rolls (reveal_at) where reveal_at is not null;

create table public.roll_members (
  roll_id     uuid not null references public.rolls (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.roll_member_role not null default 'member',
  muted       boolean not null default false,
  invited_by  uuid references public.profiles (id) on delete set null,
  joined_at   timestamptz not null default now(),
  primary key (roll_id, user_id)
);
create index roll_members_user_idx on public.roll_members (user_id);

-- ---------------------------------------------------------------------------------------------
-- tags (Chapters now, Lore later)
-- ---------------------------------------------------------------------------------------------
create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  crew_id     uuid not null references public.crews (id) on delete cascade,
  roll_id     uuid references public.rolls (id) on delete cascade,
  kind        public.tag_kind not null default 'chapter',
  name        text not null check (char_length(name) between 1 and 40),
  sort        smallint not null default 0,
  day         date,
  created_at  timestamptz not null default now()
);
-- (roll_id, kind, lower(name)); crew-level lore (roll_id null) is unique per crew instead.
create unique index tags_unique_name_idx on public.tags (coalesce(roll_id, crew_id), kind, lower(name));
create index tags_roll_idx on public.tags (roll_id, sort);

-- ---------------------------------------------------------------------------------------------
-- photos
-- ---------------------------------------------------------------------------------------------
create table public.photos (
  id            uuid primary key default gen_random_uuid(),   -- client-generated for idempotent upload-init
  crew_id       uuid not null references public.crews (id) on delete cascade,
  roll_id       uuid references public.rolls (id) on delete cascade,
  kind          public.photo_kind not null default 'roll',
  uploader_id   uuid not null references public.profiles (id) on delete cascade,
  chapter_id    uuid references public.tags (id) on delete set null,
  status        public.photo_status not null default 'pending',
  visibility    public.photo_visibility not null default 'everyone',
  content_hash  text not null,
  mime          text not null,
  bytes         bigint not null check (bytes >= 0),
  width         integer,
  height        integer,
  taken_at      timestamptz,
  sort_at       timestamptz not null default now(),            -- coalesce(taken_at, created_at) by trigger
  original_key  text not null,
  display_key   text not null,
  thumb_key     text not null,
  blurhash      text,
  caption       text check (char_length(caption) <= 280),
  lat           double precision,
  lng           double precision,
  place_name    text,
  removed_at    timestamptz,
  removed_by    uuid,
  removed_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint photos_roll_required check (kind = 'snap' or roll_id is not null)
);
-- de-dupe: one live copy of the same bytes per roll
create unique index photos_roll_content_hash_key on public.photos (roll_id, content_hash) where status <> 'removed';
-- grid keyset paging
create index photos_grid_idx on public.photos (roll_id, sort_at desc, id desc) where status = 'ready';
create index photos_uploader_idx on public.photos (uploader_id, created_at desc);
create index photos_snap_idx on public.photos (crew_id) where kind = 'snap';
-- fk / maintenance lookups
create index photos_roll_idx on public.photos (roll_id);
create index photos_crew_idx on public.photos (crew_id);
create index photos_chapter_idx on public.photos (chapter_id) where chapter_id is not null;
create index photos_review_idx on public.photos (roll_id) where status = 'review';
create index photos_removed_idx on public.photos (removed_at) where status = 'removed';
create index photos_pending_idx on public.photos (created_at) where status = 'pending';

alter table public.crews
  add constraint crews_cover_photo_fk foreign key (cover_photo_id)
  references public.photos (id) on delete set null deferrable initially deferred;
alter table public.rolls
  add constraint rolls_cover_photo_fk foreign key (cover_photo_id)
  references public.photos (id) on delete set null deferrable initially deferred;
create index crews_cover_photo_idx on public.crews (cover_photo_id) where cover_photo_id is not null;
create index rolls_cover_photo_idx on public.rolls (cover_photo_id) where cover_photo_id is not null;

create table public.photo_audience (
  photo_id  uuid not null references public.photos (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  primary key (photo_id, user_id)
);
create index photo_audience_user_idx on public.photo_audience (user_id);

-- ---------------------------------------------------------------------------------------------
-- reactions + the RPC-free counts view
-- ---------------------------------------------------------------------------------------------
create table public.reactions (
  photo_id    uuid not null references public.photos (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        public.reaction_kind not null,
  created_at  timestamptz not null default now(),
  primary key (photo_id, user_id)
);
create index reactions_user_idx on public.reactions (user_id);

create view public.photo_reaction_counts
with (security_invoker = true) as
  select r.photo_id, r.kind, count(*)::integer as n
  from public.reactions r
  group by r.photo_id, r.kind;

-- ---------------------------------------------------------------------------------------------
-- messages (+ reactions, read markers)
-- ---------------------------------------------------------------------------------------------
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  crew_id      uuid not null references public.crews (id) on delete cascade,
  roll_id      uuid references public.rolls (id) on delete cascade,
  thread_key   text generated always as (
                 case when roll_id is null then 'c:' || crew_id::text else 'r:' || roll_id::text end
               ) stored,
  author_id    uuid not null references public.profiles (id) on delete cascade,
  client_id    uuid not null unique,
  body         text check (char_length(body) <= 2000),
  photo_id     uuid references public.photos (id) on delete set null,
  reply_to_id  uuid references public.messages (id) on delete set null,
  kind         text not null default 'text' check (kind in ('text', 'photo', 'system')),
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint messages_has_content check (body is not null or photo_id is not null or kind = 'system')
);
create index messages_thread_idx on public.messages (thread_key, created_at desc);
create index messages_crew_idx on public.messages (crew_id);
create index messages_roll_idx on public.messages (roll_id) where roll_id is not null;
create index messages_author_idx on public.messages (author_id);
create index messages_photo_idx on public.messages (photo_id) where photo_id is not null;
create index messages_reply_idx on public.messages (reply_to_id) where reply_to_id is not null;

create table public.message_reactions (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        public.reaction_kind not null,
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_reactions_user_idx on public.message_reactions (user_id);

create table public.thread_reads (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  thread_key    text not null,
  last_read_at  timestamptz not null default now(),
  primary key (user_id, thread_key)
);

-- ---------------------------------------------------------------------------------------------
-- invites, direct_invites, join_requests
-- ---------------------------------------------------------------------------------------------
create table public.invites (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[abcdefghjkmnpqrstuvwxyz23456789]{10}$'),
  crew_id            uuid not null references public.crews (id) on delete cascade,
  roll_id            uuid references public.rolls (id) on delete cascade,   -- null = whole-Crew invite
  created_by         uuid references public.profiles (id) on delete set null,
  expires_at         timestamptz not null default (now() + interval '7 days'),
  max_uses           integer check (max_uses is null or max_uses >= 1),
  use_count          integer not null default 0 check (use_count >= 0),
  requires_approval  boolean not null default false,
  allow_guests       boolean not null default true,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index invites_crew_idx on public.invites (crew_id);
create index invites_roll_idx on public.invites (roll_id) where roll_id is not null;
create index invites_creator_idx on public.invites (created_by, created_at desc);

create table public.direct_invites (
  id          uuid primary key default gen_random_uuid(),
  invite_id   uuid not null references public.invites (id) on delete cascade,
  invitee_id  uuid not null references public.profiles (id) on delete cascade,
  status      public.request_status not null default 'pending',
  created_at  timestamptz not null default now(),
  unique (invite_id, invitee_id)
);
create index direct_invites_invitee_idx on public.direct_invites (invitee_id, status);

create table public.join_requests (
  id          uuid primary key default gen_random_uuid(),
  crew_id     uuid not null references public.crews (id) on delete cascade,
  roll_id     uuid references public.rolls (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  invite_id   uuid references public.invites (id) on delete set null,
  status      public.request_status not null default 'pending',
  decided_by  uuid references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index join_requests_pending_key
  on public.join_requests (user_id, crew_id, coalesce(roll_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'pending';
create index join_requests_crew_idx on public.join_requests (crew_id, status);
create index join_requests_roll_idx on public.join_requests (roll_id, status) where roll_id is not null;

-- ---------------------------------------------------------------------------------------------
-- moderation
-- ---------------------------------------------------------------------------------------------
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  target       public.report_target not null,
  target_id    uuid not null,
  crew_id      uuid references public.crews (id) on delete cascade,
  reason       text check (char_length(reason) <= 500),
  status       public.request_status not null default 'pending',
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index reports_crew_idx on public.reports (crew_id, status);
create index reports_reporter_idx on public.reports (reporter_id);

create table public.removal_requests (
  id            uuid primary key default gen_random_uuid(),
  photo_id      uuid not null references public.photos (id) on delete cascade,
  roll_id       uuid references public.rolls (id) on delete cascade,        -- denormalised (policy arrays)
  uploader_id   uuid references public.profiles (id) on delete cascade,     -- denormalised (policy)
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  reason        text check (char_length(reason) <= 500),
  status        public.request_status not null default 'pending',
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index removal_requests_photo_idx on public.removal_requests (photo_id);
create index removal_requests_roll_idx on public.removal_requests (roll_id, status);
create index removal_requests_uploader_idx on public.removal_requests (uploader_id, status);
create index removal_requests_requester_idx on public.removal_requests (requester_id);
create unique index removal_requests_pending_key
  on public.removal_requests (photo_id, requester_id) where status = 'pending';

create table public.blocks (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- ---------------------------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------------------------
create table public.push_tokens (
  token         text primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  platform      text not null check (platform in ('ios', 'android', 'web')),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

create table public.notification_prefs (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  invites     boolean not null default true,
  uploads     boolean not null default true,
  chats       boolean not null default true,
  reveals     boolean not null default true,
  games       boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table public.activity_events (
  id               bigint generated always as identity primary key,
  recipient_id     uuid not null references public.profiles (id) on delete cascade,
  actor_id         uuid references public.profiles (id) on delete set null,
  crew_id          uuid references public.crews (id) on delete cascade,
  roll_id          uuid references public.rolls (id) on delete cascade,
  photo_id         uuid references public.photos (id) on delete cascade,
  kind             public.activity_kind not null,
  payload          jsonb not null default '{}'::jsonb,
  instant          boolean not null default true,
  created_at       timestamptz not null default now(),
  read_at          timestamptz,
  pushed_at        timestamptz,
  push_claimed_at  timestamptz
);
create index activity_events_recipient_idx on public.activity_events (recipient_id, created_at desc);
create index activity_events_unpushed_idx on public.activity_events (created_at) where pushed_at is null;
create index activity_events_crew_idx on public.activity_events (crew_id) where crew_id is not null;
create index activity_events_roll_idx on public.activity_events (roll_id) where roll_id is not null;
create index activity_events_photo_idx on public.activity_events (photo_id) where photo_id is not null;
create index activity_events_actor_idx on public.activity_events (actor_id) where actor_id is not null;

create table public.upload_batches (
  roll_id           uuid not null references public.rolls (id) on delete cascade,
  uploader_id       uuid not null references public.profiles (id) on delete cascade,
  bucket_start      timestamptz not null,
  photo_count       integer not null default 0,
  sample_photo_ids  uuid[] not null default '{}' check (cardinality(sample_photo_ids) <= 4),
  notified_at       timestamptz,
  primary key (roll_id, uploader_id, bucket_start)
);
create index upload_batches_pending_idx on public.upload_batches (bucket_start) where notified_at is null;
create index upload_batches_uploader_idx on public.upload_batches (uploader_id);

-- ---------------------------------------------------------------------------------------------
-- server-only tables
-- ---------------------------------------------------------------------------------------------
create table public.media_uploads (
  photo_id            uuid primary key references public.photos (id) on delete cascade,
  multipart_upload_id text,
  part_size           integer,
  parts               integer,
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);

create table public.media_purge_queue (
  key          text primary key,
  enqueued_at  timestamptz not null default now(),
  claimed_at   timestamptz
);
create index media_purge_queue_idx on public.media_purge_queue (enqueued_at);

-- ---------------------------------------------------------------------------------------------
-- RLS on every table (policies: 04_rls; with RLS on and no policy a table is closed to clients)
-- ---------------------------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.app_settings       enable row level security;
alter table public.crews              enable row level security;
alter table public.crew_members       enable row level security;
alter table public.rolls              enable row level security;
alter table public.roll_members       enable row level security;
alter table public.tags               enable row level security;
alter table public.photos             enable row level security;
alter table public.photo_audience     enable row level security;
alter table public.reactions          enable row level security;
alter table public.messages           enable row level security;
alter table public.message_reactions  enable row level security;
alter table public.thread_reads       enable row level security;
alter table public.invites            enable row level security;
alter table public.direct_invites     enable row level security;
alter table public.join_requests      enable row level security;
alter table public.reports            enable row level security;
alter table public.removal_requests   enable row level security;
alter table public.blocks             enable row level security;
alter table public.push_tokens        enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.activity_events    enable row level security;
alter table public.upload_batches     enable row level security;
alter table public.media_uploads      enable row level security;
alter table public.media_purge_queue  enable row level security;

-- Supabase's default privileges hand every new table to anon + authenticated. Remove that
-- up front; 10_grants_realtime then grants back only what each table's section allows.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
