-- 14 · Performance review fixes (items 1-13 and 15 of the 300k-photo review; item 14 is documented only).
--
-- Migrations 01-13 are already applied in production and are never edited; every change lives here.
-- Functions are replaced with `create or replace` and IDENTICAL signatures; EXECUTE grants are re-asserted at the
-- bottom (pattern of 10 / 13). Every definition below starts from the LATEST one (13 where it redefined a function,
-- else the original) and keeps all of its semantics, in particular the security fixes of 13:
--   F7  my_roll_ids(): roll-only members stop reading once the crew's purge window has passed
--   F6  fanout_upload_batches(): only ready + 'everyone' photo ids, none for sealed rolls
--   F4/F12b/F3/F9/F10/F12c  (messages_update_author, reports_select, join_core, invite_preview, ...) are not touched.
--
--   1   messages_select reads through the chat index (thread_key = any(private.my_thread_keys())).
--   2   one full grid index (roll_id, sort_at desc, id desc) + keyset RPC public.roll_photos(...).
--   3   `offset 0` pins the plan of the EXISTS policies on reactions (select / insert / update).
--   4   upload digest: ONE activity row per (recipient, roll, closed hour), set-based; the push claim hands out
--       instant rows first.
--   5   home_feed: facepile limited before the join, inline unread count, plain rolls(crew_id) index.
--   6   inbox_threads: inline unread count joined to thread_reads.
--   7   public.photos_by_ids(uuid[]) (security invoker, PK lookups) for media-sign; the P2 'snap' branch is gone
--       from photos_select until P2 ships.
--   8   (nothing) rolls.last_activity_at is never indexed so roll updates stay HOT -- asserted below.
--   9   photos leave the supabase_realtime publication; a status / visibility change broadcasts
--       `photos_changed` on the (public) channel `roll:<roll id>` through realtime.send (guarded).
--   10  call_push_dispatch() only calls pg_net when there is something to claim / purge.
--   11  membership helpers: plpgsql, my_roll_ids() evaluated once, index-driven unions.
--   12  photo_audience.uploader_id: both photo_audience and photos policies are plain (no definer call per row).
--   13  merged grid indexes (item 2), BRIN on activity_events(created_at) for the retention delete.

-- ---------------------------------------------------------------------------------------------
-- 8 / 13 · indexes
-- ---------------------------------------------------------------------------------------------
-- One full index serves the grid (ready + review), cover selection, roll_header counts and the roll FK cascade.
-- (The old partial one has status = 'ready' in its predicate, so `status in ('ready','review')` could not use it.)
create index photos_grid_full_idx on public.photos (roll_id, sort_at desc, id desc);
drop index public.photos_grid_idx;
drop index public.photos_roll_idx;
alter index public.photos_grid_full_idx rename to photos_grid_idx;

-- rolls(crew_id) without a predicate: policies, helpers and FK cascades do not always say `deleted_at is null`.
-- Deliberately NOT (crew_id, last_activity_at): indexing last_activity_at would make every chat message / upload
-- a non-HOT update of rolls (item 8).
create index rolls_crew_all_idx on public.rolls (crew_id);
drop index public.rolls_crew_idx;
alter index public.rolls_crew_all_idx rename to rolls_crew_idx;

-- append-only timestamp: the 180-day retention delete and the stale-unpushed sweep touch a tiny block range
create index activity_events_created_brin on public.activity_events using brin (created_at);

do $$
begin
  if exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
              where i.indrelid in ('public.rolls'::regclass, 'public.crews'::regclass) and a.attname = 'last_activity_at') then
    raise exception 'item 8: last_activity_at must stay unindexed (HOT updates)';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 11 · membership helpers
-- ---------------------------------------------------------------------------------------------
-- rolls of my crews + my roll_members rolls, EXCLUDING rolls hidden from me as the Surprise honoree.
-- F7 (13): a roll-only membership stops counting once the roll's crew is past its purge window.
create or replace function private.my_roll_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me  uuid := (select auth.uid());
  v_out uuid[];
begin
  if v_me is null then
    return '{}'::uuid[];
  end if;
  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_out
  from (
    select r.id, r.surprise_honoree_id, r.reveal_at
      from public.crew_members cm
      join public.crews c on c.id = cm.crew_id and (c.purge_after is null or c.purge_after > now())
      join public.rolls r on r.crew_id = cm.crew_id and r.deleted_at is null
     where cm.user_id = v_me
    union
    select r.id, r.surprise_honoree_id, r.reveal_at
      from public.roll_members rm
      join public.rolls r on r.id = rm.roll_id and r.deleted_at is null
      join public.crews c on c.id = r.crew_id and (c.purge_after is null or c.purge_after > now())
     where rm.user_id = v_me
  ) x
  where not coalesce(x.surprise_honoree_id = v_me and now() < x.reveal_at, false);
  return v_out;
end;
$$;

-- my_roll_ids() minus sealed ones (reveal_at in the future or locked_until in the future)
create or replace function private.my_open_roll_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rolls uuid[] := private.my_roll_ids();
  v_out   uuid[];
begin
  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_out
  from public.rolls r
  where r.id = any (v_rolls)
    and not (coalesce(r.reveal_at > now(), false) or coalesce(r.locked_until > now(), false));
  return v_out;
end;
$$;

-- rolls where I'm admin: crew host/cohost of the roll's crew OR the roll's creator (while a crew member)
create or replace function private.my_admin_roll_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me    uuid := (select auth.uid());
  v_rolls uuid[] := private.my_roll_ids();
  v_out   uuid[];
begin
  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_out
  from public.rolls r
  join public.crew_members cm on cm.crew_id = r.crew_id and cm.user_id = v_me
  where r.id = any (v_rolls)
    and (cm.role in ('host', 'cohost') or r.created_by = v_me);
  return v_out;
end;
$$;

-- my_crew_ids() ∪ crews of the rolls I only have roll-level access to
create or replace function private.my_visible_crew_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rolls uuid[] := private.my_roll_ids();
  v_out   uuid[];
begin
  select coalesce(array_agg(x.crew_id), '{}'::uuid[]) into v_out
  from (
    select unnest(private.my_crew_ids()) as crew_id
    union
    select r.crew_id from public.rolls r where r.id = any (v_rolls)
  ) x;
  return v_out;
end;
$$;

-- every user I share a crew or a roll with, plus users with a pending join request to a space I administer.
-- (my_roll_ids() is evaluated ONCE; "members of crews that own my rolls" is one scan over the visible crews,
-- which also covers the crews I only reach through a roll_members row.)
create or replace function private.my_space_user_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid := (select auth.uid());
  v_rolls  uuid[];
  v_vis    uuid[];
  v_admin_crews uuid[];
  v_admin_rolls uuid[];
  v_out    uuid[];
begin
  if v_me is null then
    return '{}'::uuid[];
  end if;
  v_rolls := private.my_roll_ids();
  v_admin_crews := private.my_admin_crew_ids();
  select coalesce(array_agg(x.crew_id), '{}'::uuid[]) into v_vis
  from (
    select unnest(private.my_crew_ids()) as crew_id
    union
    select r.crew_id from public.rolls r where r.id = any (v_rolls)
  ) x;
  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_admin_rolls
  from public.rolls r
  join public.crew_members cm on cm.crew_id = r.crew_id and cm.user_id = v_me
  where r.id = any (v_rolls)
    and (cm.role in ('host', 'cohost') or r.created_by = v_me);
  select coalesce(array_agg(u), '{}'::uuid[]) into v_out
  from (
    select cm.user_id as u from public.crew_members cm where cm.crew_id = any (v_vis)
    union
    select rm.user_id from public.roll_members rm where rm.roll_id = any (v_rolls)
    union
    select jr.user_id
      from public.join_requests jr
      where jr.status = 'pending'
        and (jr.crew_id = any (v_admin_crews) or jr.roll_id = any (v_admin_rolls))
  ) s;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1 · chat reads through the thread index
-- ---------------------------------------------------------------------------------------------
-- 'c:<crew>' for my crews, 'r:<roll>' for my rolls; empty for guests (guests neither read nor write chat).
-- The policy compares the column the chat index leads with, so the array check becomes an index qual.
create or replace function private.my_thread_keys()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.is_guest()) then
    return '{}'::text[];
  end if;
  return array(select 'c:' || x::text from unnest(private.my_crew_ids()) x)
      || array(select 'r:' || x::text from unnest(private.my_roll_ids()) x);
end;
$$;

alter policy messages_select on public.messages
  using (thread_key = any ((select private.my_thread_keys())::text[]));

-- ---------------------------------------------------------------------------------------------
-- 12 · photo_audience.uploader_id: no definer call per photo row, no photos <-> photo_audience recursion
-- ---------------------------------------------------------------------------------------------
alter table public.photo_audience add column uploader_id uuid;
update public.photo_audience a set uploader_id = p.uploader_id from public.photos p where p.id = a.photo_id;
alter table public.photo_audience alter column uploader_id set not null;

-- uploader_id always mirrors the photo's uploader (photos.uploader_id never changes)
create or replace function private.photo_audience_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.uploader_id := (select p.uploader_id from public.photos p where p.id = new.photo_id);
  return new;
end;
$$;
create trigger photo_audience_before_insert before insert on public.photo_audience
  for each row execute function private.photo_audience_before_insert();

-- the audience member sees their own row, the uploader the whole audience (3: offset 0 not needed any more)
alter policy photo_audience_select on public.photo_audience
  using (user_id = (select auth.uid()) or uploader_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- 7 / 12 · photos_select: plain EXISTS on photo_audience; P2 'snap' branch dropped until P2 ships
-- ---------------------------------------------------------------------------------------------
-- (an 'only_me' or 'selected' photo is still only visible to its uploader / audience; sealed rolls, review
--  rows and the surprise honoree rule are unchanged)
alter policy photos_select on public.photos
  using (
    uploader_id = (select auth.uid())
    or (
      status = 'ready'
      and roll_id = any ((select private.my_open_roll_ids())::uuid[])
      and (
        visibility = 'everyone'
        or (visibility = 'selected'
            and exists (select 1 from public.photo_audience a
                        where a.photo_id = photos.id and a.user_id = (select auth.uid()) offset 0))
      )
    )
    or (status = 'review' and roll_id = any ((select private.my_admin_roll_ids())::uuid[]))
  );

-- ---------------------------------------------------------------------------------------------
-- 3 · reactions: `offset 0` keeps the EXISTS as a per-row PK probe instead of a pulled-up semi join that
--     can scan every visible photo
-- ---------------------------------------------------------------------------------------------
alter policy reactions_select on public.reactions
  using (exists (select 1 from public.photos p where p.id = reactions.photo_id offset 0));

alter policy reactions_insert_own on public.reactions
  with check (
    user_id = (select auth.uid())
    and not (select private.is_guest())
    and exists (select 1 from public.photos p where p.id = reactions.photo_id offset 0)
  );

alter policy reactions_update_own on public.reactions
  using (user_id = (select auth.uid()) and not (select private.is_guest()))
  with check (user_id = (select auth.uid()) and not (select private.is_guest())
              and exists (select 1 from public.photos p where p.id = reactions.photo_id offset 0));

-- ---------------------------------------------------------------------------------------------
-- 2 · keyset grid RPC
-- ---------------------------------------------------------------------------------------------
-- Authorises the roll ONCE (a single-roll lookup instead of the three array helpers), then runs an ordered
-- scan on photos_grid_idx with the visibility rules of photos_select spelled out for this roll:
--   own rows (ready / review) | ready + everyone / selected-for-me in an open roll | review rows for roll admins.
-- Raises not_a_member for rolls I cannot read (non-member, deleted roll, hidden Surprise roll, purged crew).
-- Guests (anonymous sessions) are members through roll_members and may call it.
create or replace function public.roll_photos(
  p_roll_id        uuid,
  p_before_sort_at timestamptz default null,
  p_before_id      uuid        default null,
  p_chapter_id     uuid        default null,
  p_limit          integer     default 60
)
returns table (
  id uuid, uploader_id uuid, sort_at timestamptz, width integer, height integer, thumb_key text,
  display_key text, blurhash text, chapter_id uuid, status public.photo_status,
  visibility public.photo_visibility, caption text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me    uuid := private.require_user();
  v_open  boolean;
  v_admin boolean;
  v_lim   integer := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_sort  timestamptz := coalesce(p_before_sort_at, 'infinity'::timestamptz);
  v_id    uuid        := coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
begin
  -- same rules as my_roll_ids / my_open_roll_ids / my_admin_roll_ids, for this one roll
  select m.member and not (coalesce(r.reveal_at > now(), false) or coalesce(r.locked_until > now(), false)),
         m.member and cm.user_id is not null and (cm.role in ('host', 'cohost') or r.created_by = v_me)
    into v_open, v_admin
  from public.rolls r
  join public.crews c on c.id = r.crew_id
  left join public.crew_members cm on cm.crew_id = r.crew_id and cm.user_id = v_me
  left join public.roll_members rm on rm.roll_id = r.id and rm.user_id = v_me
  cross join lateral (select (cm.user_id is not null or rm.user_id is not null)
                             and (c.purge_after is null or c.purge_after > now()) as member) m
  where r.id = p_roll_id and r.deleted_at is null
    and not coalesce(r.surprise_honoree_id = v_me and now() < r.reveal_at, false)
    and m.member;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  return query
  select p.id, p.uploader_id, p.sort_at, p.width, p.height, p.thumb_key, p.display_key, p.blurhash,
         p.chapter_id, p.status, p.visibility, p.caption
  from public.photos p
  where p.roll_id = p_roll_id
    and (p.sort_at, p.id) < (v_sort, v_id)
    and p.status in ('ready', 'review')
    and (p_chapter_id is null or p.chapter_id = p_chapter_id)
    and (
      p.uploader_id = v_me
      or (v_open and p.status = 'ready'
          and (p.visibility = 'everyone'
               or (p.visibility = 'selected'
                   and exists (select 1 from public.photo_audience a where a.photo_id = p.id and a.user_id = v_me))))
      or (v_admin and p.status = 'review')
    )
  order by p.sort_at desc, p.id desc
  limit v_lim;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7 · photos_by_ids: what media-sign needs in ONE request (security INVOKER: RLS decides what comes back)
-- ---------------------------------------------------------------------------------------------
-- A photo / roll the caller cannot read is simply absent (roll_visible = false when the photo is readable but
-- its roll is not). is_admin = rolls.created_by or host / cohost of the roll's crew (same rule media-sign used).
create or replace function public.photos_by_ids(p_ids uuid[])
returns table (
  id uuid, crew_id uuid, roll_id uuid, uploader_id uuid, thumb_key text, display_key text, original_key text,
  status public.photo_status, mime text,
  roll_visible boolean, roll_name text, allow_downloads boolean, is_uploader boolean, is_admin boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := (select auth.uid());
begin
  if p_ids is null or cardinality(p_ids) > 500 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  return query
  select p.id, p.crew_id, p.roll_id, p.uploader_id, p.thumb_key, p.display_key, p.original_key, p.status, p.mime,
         r.id is not null, r.name, r.allow_downloads,
         p.uploader_id = v_me,
         coalesce(r.created_by = v_me
                  or exists (select 1 from public.crew_members cm
                             where cm.crew_id = r.crew_id and cm.user_id = v_me and cm.role in ('host', 'cohost')),
                  false)
  from public.photos p
  left join public.rolls r on r.id = p.roll_id
  where p.id = any (p_ids);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5 · home_feed / thread_unread
-- ---------------------------------------------------------------------------------------------
-- plpgsql so the plan is cached (a SQL definer function is re-planned on every call)
create or replace function private.thread_unread(p_user uuid, p_thread_key text, p_since timestamptz)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select count(*)::integer from (
    select 1 from public.messages m
    where m.thread_key = p_thread_key
      and m.created_at > coalesce((select tr.last_read_at from public.thread_reads tr
                                    where tr.user_id = p_user and tr.thread_key = p_thread_key), p_since)
      and m.author_id <> p_user and m.deleted_at is null
    limit 100) x);
end;
$$;

create or replace function public.home_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.require_user();
  v_guest   boolean := private.is_guest();
  v_crews   uuid[] := private.my_crew_ids();
  v_rolls   uuid[] := private.my_roll_ids();
  v_open    uuid[] := private.my_open_roll_ids();
  v_live    jsonb;
  v_pending jsonb;
  v_list    jsonb;
begin
  select coalesce(jsonb_agg(x.j order by x.la desc, x.id), '[]'::jsonb) into v_live
  from (
    select r.id, r.last_activity_at as la,
           jsonb_build_object(
             'id', r.id, 'name', r.name, 'crew_id', r.crew_id, 'crew_name', c.name, 'crew_tint', c.tint,
             'photo_count', r.photo_count, 'starts_on', r.starts_on, 'ends_on', r.ends_on,
             'sealed', private.roll_is_sealed(r), 'reveal_at', r.reveal_at,
             'cover_thumb_key', private.cover_thumb(r.cover_photo_id),
             'last_activity_at', r.last_activity_at) as j
    from public.rolls r
    join public.crews c on c.id = r.crew_id
    where r.id = any (v_rolls) and c.deleted_at is null and private.roll_is_live(r)
    order by r.last_activity_at desc, r.id
    limit 10
  ) x;

  select coalesce(jsonb_agg(x.j order by x.created_at desc, x.id), '[]'::jsonb) into v_pending
  from (
    select di.id, di.created_at,
           jsonb_build_object(
             'id', di.id, 'invite_code', i.code,
             'kind', case when i.roll_id is null then 'crew' else 'roll' end,
             'crew', jsonb_build_object('id', c.id, 'name', c.name, 'tint', c.tint),
             'roll', case when r.id is null then null else jsonb_build_object('id', r.id, 'name', r.name) end,
             'inviter', jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'avatar_key', pr.avatar_key),
             'expires_at', i.expires_at, 'created_at', di.created_at) as j
    from public.direct_invites di
    join public.invites i on i.id = di.invite_id
    join public.crews c on c.id = i.crew_id
    left join public.rolls r on r.id = i.roll_id
    left join public.profiles pr on pr.id = i.created_by
    where di.invitee_id = v_me
      and di.status = 'pending'
      and i.revoked_at is null and i.expires_at > now()
      and (i.max_uses is null or i.use_count < i.max_uses)
      and c.deleted_at is null
      and (i.roll_id is null or (r.deleted_at is null
           and not coalesce(r.surprise_honoree_id = v_me and now() < r.reveal_at, false)))
      and not exists (select 1 from public.crew_members cm where cm.crew_id = c.id and cm.user_id = v_me)
  ) x;

  select coalesce(jsonb_agg(x.j order by x.la desc, x.id), '[]'::jsonb) into v_list
  from (
    select c.id, c.last_activity_at as la,
      jsonb_build_object(
        'id', c.id, 'name', c.name, 'tint', c.tint, 'role', me.role, 'muted', me.muted,
        'member_count', (select count(*) from public.crew_members m where m.crew_id = c.id),
        'facepile', (
          -- LIMIT before the profile join: a 150-member crew reads 5 profiles, not 150
          select coalesce(jsonb_agg(jsonb_build_object(
                   'id', f.id, 'display_name', f.display_name, 'avatar_key', f.avatar_key, 'ring_color', f.ring_color)
                 order by f.mine, f.joined_at, f.id), '[]'::jsonb)
          from (
            select p.id, p.display_name, p.avatar_key, p.ring_color, m.mine, m.joined_at
            from (select m.user_id, (m.user_id = v_me) as mine, m.joined_at from public.crew_members m
                  where m.crew_id = c.id order by (m.user_id = v_me), m.joined_at, m.user_id limit 5) m
            join public.profiles p on p.id = m.user_id
          ) f),
        'last_activity_at', c.last_activity_at,
        -- unread: crew thread + every roll thread of this crew I can read, each capped at 100, inline
        'unread_count', case when v_guest then 0 else
            (select coalesce(sum(u.n), 0)::integer
             from (select 'c:' || c.id::text as tk
                   union all
                   select 'r:' || r.id::text from public.rolls r where r.crew_id = c.id and r.id = any (v_rolls)) k
             left join public.thread_reads tr on tr.user_id = v_me and tr.thread_key = k.tk
             cross join lateral (
               select count(*) as n from (
                 select 1 from public.messages m
                 where m.thread_key = k.tk and m.created_at > coalesce(tr.last_read_at, me.joined_at)
                   and m.author_id <> v_me and m.deleted_at is null
                 limit 100) x) u)
          end,
        'stack', (
          select coalesce(jsonb_agg(s.thumb_key order by s.sort_at desc, s.id desc), '[]'::jsonb)
          from (
            select p.thumb_key, p.sort_at, p.id
            from (select r.id from public.rolls r
                  where r.crew_id = c.id and r.id = any (v_open) and r.photo_count > 0
                  order by r.last_activity_at desc limit 3) rr
            cross join lateral (
              select ph.thumb_key, ph.sort_at, ph.id from public.photos ph
              where ph.roll_id = rr.id and ph.status = 'ready' and ph.visibility = 'everyone'
              order by ph.sort_at desc, ph.id desc limit 3) p
            order by p.sort_at desc, p.id desc
            limit 3
          ) s),
        'live_roll', (
          select jsonb_build_object('id', r.id, 'name', r.name)
          from public.rolls r
          where r.crew_id = c.id and r.id = any (v_rolls) and private.roll_is_live(r)
          order by r.last_activity_at desc, r.id limit 1),
        'deleted_at', c.deleted_at, 'purge_after', c.purge_after
      ) as j
    from public.crews c
    join public.crew_members me on me.crew_id = c.id and me.user_id = v_me
    where c.id = any (v_crews)
  ) x;

  return jsonb_build_object('live_rolls', v_live, 'pending_invites', v_pending, 'crews', v_list);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6 · inbox_threads: unread count inline, joined to thread_reads
-- ---------------------------------------------------------------------------------------------
create or replace function public.inbox_threads()
returns table (
  thread_key           text,
  kind                 text,
  crew_id              uuid,
  roll_id              uuid,
  title                text,
  crew_name            text,
  tint                 public.crew_tint,
  last_message_id      uuid,
  last_message_body    text,
  last_message_kind    text,
  last_message_photo_id uuid,
  last_message_at      timestamptz,
  last_author_id       uuid,
  last_author_name     text,
  unread_count         integer,
  muted                boolean,
  last_activity_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me    uuid := private.require_user();
  v_crews uuid[] := private.my_crew_ids();
  v_rolls uuid[] := private.my_roll_ids();
begin
  if private.is_guest() then
    return;
  end if;
  return query
  with threads as (
    select 'c:' || c.id::text as tk, 'crew'::text as kd, c.id as cid, null::uuid as rid,
           c.name as ttl, c.name as cname, c.tint as tnt, cm.muted as mt, cm.joined_at as since,
           c.last_activity_at as la
    from public.crews c
    join public.crew_members cm on cm.crew_id = c.id and cm.user_id = v_me
    where c.id = any (v_crews)
    union all
    select 'r:' || r.id::text, 'roll'::text, r.crew_id, r.id,
           r.name, c.name, c.tint, coalesce(cm.muted, false) or coalesce(rm.muted, false),
           coalesce(cm.joined_at, rm.joined_at), r.last_activity_at
    from public.rolls r
    join public.crews c on c.id = r.crew_id
    left join public.crew_members cm on cm.crew_id = r.crew_id and cm.user_id = v_me
    left join public.roll_members rm on rm.roll_id = r.id and rm.user_id = v_me
    where r.id = any (v_rolls)
  )
  select t.tk, t.kd, t.cid, t.rid, t.ttl, t.cname, t.tnt,
         lm.id, left(lm.body, 120), lm.kind, lm.photo_id, lm.created_at, lm.author_id, pr.display_name,
         (select count(*)::integer from (
            select 1 from public.messages m2
            where m2.thread_key = t.tk and m2.created_at > coalesce(tr.last_read_at, t.since)
              and m2.author_id <> v_me and m2.deleted_at is null limit 100) u), t.mt, t.la
  from threads t
  left join lateral (
    select m.id, m.body, m.kind, m.photo_id, m.created_at, m.author_id
    from public.messages m
    where m.thread_key = t.tk and m.deleted_at is null
    order by m.created_at desc limit 1
  ) lm on true
  left join public.profiles pr on pr.id = lm.author_id
  left join public.thread_reads tr on tr.user_id = v_me and tr.thread_key = t.tk
  order by lm.created_at desc nulls last, t.la desc, t.tk;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4 · upload digest: one activity row per (recipient, roll, closed hour)
-- ---------------------------------------------------------------------------------------------
-- Set-based. Same recipients and filters as before (non-muted crew / roll members, no guests, no honoree of a hidden
-- Surprise roll, blocks) and the F6 rule: sample ids are ready + 'everyone' photos only, none for sealed rolls.
-- Counts exclude the recipient's own uploads and the uploaders the recipient blocked.
--   payload: {count, uploaders, uploader_name, actor_name, roll_name, crew_name, sample_photo_ids}
--   actor_id / uploader_name / actor_name = the recipient's top uploader of that hour.
create or replace function private.fanout_upload_batches()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with closed as (
    update public.upload_batches ub
       set notified_at = now()
     where ub.notified_at is null and ub.bucket_start < date_trunc('hour', now())
    returning ub.roll_id, ub.uploader_id, ub.bucket_start, ub.photo_count, ub.sample_photo_ids
  ), live as (
    select c.roll_id, c.uploader_id, c.bucket_start, c.photo_count, c.sample_photo_ids,
           r.crew_id, r.name as roll_name, r.surprise_honoree_id, r.reveal_at, cr.name as crew_name,
           (coalesce(r.reveal_at > now(), false) or coalesce(r.locked_until > now(), false)) as sealed
    from closed c
    join public.rolls r on r.id = c.roll_id and r.deleted_at is null
    join public.crews cr on cr.id = r.crew_id and cr.deleted_at is null
    where c.photo_count > 0
  ), samples as materialized (
    -- F6: the digest reaches the whole crew, so only ready + everyone photos may be named, never in a sealed roll
    select l.roll_id, l.bucket_start, l.uploader_id, l.photo_count, s.id as photo_id, s.ord
    from live l
    cross join lateral unnest(l.sample_photo_ids) with ordinality as s(id, ord)
    join public.photos p on p.id = s.id and p.status = 'ready' and p.visibility = 'everyone'
    where not l.sealed
  ), rolls_ as (
    select distinct roll_id, crew_id, roll_name, crew_name, surprise_honoree_id, reveal_at from live
  ), recips as (
    select ro.roll_id, ro.crew_id, ro.roll_name, ro.crew_name, m.u
    from rolls_ ro
    cross join lateral (
      select cm.user_id as u from public.crew_members cm where cm.crew_id = ro.crew_id and not cm.muted
      union
      select rm.user_id from public.roll_members rm where rm.roll_id = ro.roll_id and not rm.muted) m
    join public.profiles pr on pr.id = m.u and not pr.is_guest
    where not coalesce(ro.surprise_honoree_id = m.u and now() < ro.reveal_at, false)
  ), agg as (
    select rc.u, rc.roll_id, rc.crew_id, rc.roll_name, rc.crew_name, l.bucket_start,
           sum(l.photo_count)::bigint as n, count(*) as uploaders,
           (array_agg(l.uploader_id order by l.photo_count desc, l.uploader_id))[1] as top_uploader
    from recips rc
    join live l on l.roll_id = rc.roll_id and l.uploader_id <> rc.u
    where not exists (select 1 from public.blocks b where b.blocker_id = rc.u and b.blocked_id = l.uploader_id)
    group by rc.u, rc.roll_id, rc.crew_id, rc.roll_name, rc.crew_name, l.bucket_start
  )
  insert into public.activity_events (recipient_id, actor_id, crew_id, roll_id, kind, payload, instant)
  select a.u, a.top_uploader, a.crew_id, a.roll_id, 'upload_batch',
         jsonb_build_object(
           'count', a.n, 'uploaders', a.uploaders,
           'uploader_name', pr.display_name, 'actor_name', pr.display_name,
           'roll_name', a.roll_name, 'crew_name', a.crew_name,
           'sample_photo_ids', to_jsonb(smp.ids)),
         false
  from agg a
  join public.profiles pr on pr.id = a.top_uploader
  cross join lateral (
    select coalesce(array_agg(t.photo_id), '{}'::uuid[]) as ids
    from (
      select s.photo_id
      from samples s
      where s.roll_id = a.roll_id and s.bucket_start = a.bucket_start and s.uploader_id <> a.u
        and not exists (select 1 from public.blocks b where b.blocker_id = a.u and b.blocked_id = s.uploader_id)
      order by s.ord, s.photo_count desc, s.uploader_id
      limit 4) t
  ) smp;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Push claim (lease semantics of 09 unchanged): instant rows first, so a large hourly digest can never starve
-- invites / mentions / join requests behind it.
create or replace function private.claim_push_batch(p_limit integer default 500)
returns table (
  id           bigint,
  recipient_id uuid,
  actor_id     uuid,
  kind         public.activity_kind,
  crew_id      uuid,
  roll_id      uuid,
  photo_id     uuid,
  payload      jsonb,
  created_at   timestamptz,
  tokens       text[],
  prefs        jsonb,
  muted        boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with claimed as (
    update public.activity_events ae
       set push_claimed_at = now()
     where ae.id in (
       select a.id
       from public.activity_events a
       where a.pushed_at is null
         and (a.instant or a.kind = 'upload_batch')
         and a.created_at > now() - interval '6 hours'
         and (a.push_claimed_at is null or a.push_claimed_at < now() - interval '2 minutes')
       order by a.instant desc, a.created_at, a.id
       limit greatest(1, least(coalesce(p_limit, 500), 1000))
       for update skip locked)
    returning ae.id, ae.recipient_id, ae.actor_id, ae.kind, ae.crew_id, ae.roll_id, ae.photo_id, ae.payload,
              ae.created_at, ae.instant
  )
  select c.id, c.recipient_id, c.actor_id, c.kind, c.crew_id, c.roll_id, c.photo_id, c.payload, c.created_at,
         coalesce((select array_agg(t.token order by t.last_seen_at desc)
                   from public.push_tokens t where t.user_id = c.recipient_id), '{}'::text[]),
         coalesce((select to_jsonb(np) - 'user_id' - 'updated_at'
                   from public.notification_prefs np where np.user_id = c.recipient_id),
                  jsonb_build_object('invites', true, 'uploads', true, 'chats', true, 'reveals', true, 'games', true)),
         coalesce((select cm.muted from public.crew_members cm
                   where cm.crew_id = c.crew_id and cm.user_id = c.recipient_id), false)
           or coalesce((select rm.muted from public.roll_members rm
                        where rm.roll_id = c.roll_id and rm.user_id = c.recipient_id), false)
  from claimed c
  order by c.instant desc, c.created_at, c.id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 10 · cron cost: only POST to the Edge Function when there is work
-- ---------------------------------------------------------------------------------------------
create or replace function private.call_push_dispatch(p_query text default '')
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url    text := 'https://evxufdovegjrlwpxfmhl.supabase.co/functions/v1/push-dispatch' || coalesce(p_query, '');
  v_secret text;
  v_req    bigint;
begin
  -- nothing to claim / purge -> no pg_net request, no cold start (same predicates as the claim / purge leases)
  if coalesce(p_query, '') like '%job=purge%' then
    if not exists (select 1 from public.media_purge_queue q
                   where q.claimed_at is null or q.claimed_at < now() - interval '10 minutes') then
      return null;
    end if;
  elsif not exists (
    select 1 from public.activity_events a
    where a.pushed_at is null
      and (a.instant or a.kind = 'upload_batch')
      and a.created_at > now() - interval '6 hours'
      and (a.push_claimed_at is null or a.push_claimed_at < now() - interval '2 minutes')) then
    return null;
  end if;

  if to_regclass('vault.decrypted_secrets') is null
     or not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'net' and p.proname = 'http_post') then
    raise notice 'call_push_dispatch: pg_net or vault not available, skipping';
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_secret using 'cron_secret';
  if v_secret is null then
    raise notice 'call_push_dispatch: vault secret cron_secret is missing, skipping';
    return null;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    into v_req
    using v_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
  return v_req;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 9 · Realtime: photos leave the postgres_changes publication; rolls get a broadcast instead
-- ---------------------------------------------------------------------------------------------
-- postgres_changes on photos evaluated the (expensive) photos policy for every subscriber on every row change.
-- Clients now subscribe to the broadcast channel `roll:<roll id>`, event `photos_changed` ({roll_id}), debounce
-- for ~2 s and refetch page 1 through roll_photos(). The channel is public (private = false) and carries no
-- photo data: only "something changed in this roll"; reads still go through RLS / roll_photos.
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'photos') then
    alter publication supabase_realtime drop table public.photos;
  end if;
end;
$$;

-- realtime.send(payload jsonb, event text, topic text, private boolean) exists on Supabase only; elsewhere
-- (plain PostgreSQL in the pgTAP run) this is a no-op. Never lets realtime break an upload / moderation.
create or replace function private.broadcast_photos_changed(p_roll uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_roll is null or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return;
  end if;
  begin
    execute 'select realtime.send($1, $2, $3, $4)'
      using jsonb_build_object('roll_id', p_roll), 'photos_changed', 'roll:' || p_roll::text, false;
  exception when others then
    null;
  end;
end;
$$;

-- photos_after_status (05) + the broadcast at the end. Everything else is the original body.
create or replace function private.photos_after_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old  public.photo_status := case when tg_op = 'INSERT' then null else old.status end;
  v_cover uuid;
  v_n    integer;
begin
  if v_old is not distinct from new.status then
    return null;
  end if;

  -- -> ready
  if new.status = 'ready' then
    if new.roll_id is not null then
      update public.rolls
         set photo_count      = photo_count + 1,
             last_activity_at = now(),
             cover_photo_id   = coalesce(cover_photo_id, case when new.visibility = 'everyone' then new.id end)
       where id = new.roll_id;
      insert into public.upload_batches (roll_id, uploader_id, bucket_start, photo_count, sample_photo_ids)
      values (new.roll_id, new.uploader_id, date_trunc('hour', now()), 1, array[new.id])
      on conflict (roll_id, uploader_id, bucket_start) do update
        set photo_count = public.upload_batches.photo_count + 1,
            sample_photo_ids = case
              when cardinality(public.upload_batches.sample_photo_ids) < 4
                then public.upload_batches.sample_photo_ids || new.id
              else public.upload_batches.sample_photo_ids end;
    end if;
    update public.crews
       set last_activity_at = now(),
           cover_photo_id   = coalesce(cover_photo_id, case when new.visibility = 'everyone' then new.id end)
     where id = new.crew_id;
    update public.profiles set storage_used_bytes = storage_used_bytes + new.bytes where id = new.uploader_id;

  -- ready -> anything else (removed, or pushed back to review): counters down
  elsif v_old = 'ready' then
    if new.roll_id is not null then
      update public.rolls set photo_count = greatest(photo_count - 1, 0) where id = new.roll_id;
      -- roll cover: pick the newest remaining public ready photo
      select r.cover_photo_id into v_cover from public.rolls r where r.id = new.roll_id;
      if v_cover = new.id then
        update public.rolls
           set cover_photo_id = (
             select p.id from public.photos p
             where p.roll_id = new.roll_id and p.status = 'ready' and p.visibility = 'everyone' and p.id <> new.id
             order by p.sort_at desc, p.id desc limit 1)
         where id = new.roll_id;
      end if;
      -- walk back the newest un-notified digest bucket of this uploader (approximate by design)
      update public.upload_batches ub
         set photo_count = greatest(ub.photo_count - 1, 0),
             sample_photo_ids = array_remove(ub.sample_photo_ids, new.id)
       where (ub.roll_id, ub.uploader_id, ub.bucket_start) = (
         select b.roll_id, b.uploader_id, b.bucket_start
         from public.upload_batches b
         where b.roll_id = new.roll_id and b.uploader_id = new.uploader_id
           and b.notified_at is null and b.photo_count > 0
         order by b.bucket_start desc limit 1);
    end if;
    select c.cover_photo_id into v_cover from public.crews c where c.id = new.crew_id;
    if v_cover = new.id then
      update public.crews
         set cover_photo_id = (
           select p.id from public.photos p
           where p.crew_id = new.crew_id and p.status = 'ready' and p.visibility = 'everyone' and p.id <> new.id
           order by p.sort_at desc, p.id desc limit 1)
       where id = new.crew_id;
    end if;
    update public.profiles
       set storage_used_bytes = greatest(storage_used_bytes - new.bytes, 0)
     where id = new.uploader_id;
  end if;

  -- pending -> review: tell the roll's admins (instant), throttled to one rolling row per uploader
  if new.status = 'review' and (v_old is null or v_old = 'pending') then
    update public.activity_events ae
       set payload = jsonb_set(ae.payload, '{count}', to_jsonb(coalesce((ae.payload ->> 'count')::integer, 1) + 1))
     where ae.kind = 'guest_review'
       and ae.roll_id = new.roll_id
       and ae.actor_id = new.uploader_id
       and ae.created_at > now() - interval '15 minutes';
    get diagnostics v_n = row_count;
    if v_n = 0 then
      perform private.emit_activity(
        private.admin_ids_for(new.crew_id, new.roll_id), new.uploader_id, new.crew_id, new.roll_id, new.id,
        'guest_review', jsonb_build_object('count', 1, 'uploader_name', private.display_name_of(new.uploader_id)), true);
    end if;
  end if;

  -- grids of this roll are stale now (a new pending upload is invisible to everyone else: no broadcast)
  if new.status <> 'pending' then
    perform private.broadcast_photos_changed(new.roll_id);
  end if;
  return null;
end;
$$;

-- a visibility change (everyone <-> only_me / selected) changes what other members' grids show
create or replace function private.photos_after_visibility()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.status in ('ready', 'review') then
    perform private.broadcast_photos_changed(new.roll_id);
  end if;
  return null;
end;
$$;
create trigger photos_after_visibility after update of visibility on public.photos
  for each row when (old.visibility is distinct from new.visibility)
  execute function private.photos_after_visibility();

-- ---------------------------------------------------------------------------------------------
-- Privileges (pattern of 10 / 13): nothing new is callable by PUBLIC / anon unless listed below.
-- create or replace keeps existing grants; they are re-asserted to be explicit.
-- ---------------------------------------------------------------------------------------------
revoke all on function
  private.my_roll_ids(),
  private.my_open_roll_ids(),
  private.my_admin_roll_ids(),
  private.my_visible_crew_ids(),
  private.my_space_user_ids(),
  private.my_thread_keys(),
  private.thread_unread(uuid, text, timestamptz),
  private.photo_audience_before_insert(),
  private.fanout_upload_batches(),
  private.claim_push_batch(integer),
  private.call_push_dispatch(text),
  private.broadcast_photos_changed(uuid),
  private.photos_after_status(),
  private.photos_after_visibility(),
  public.roll_photos(uuid, timestamptz, uuid, uuid, integer),
  public.photos_by_ids(uuid[]),
  public.home_feed(),
  public.inbox_threads()
from public, anon, authenticated;

grant execute on function
  private.my_roll_ids(),
  private.my_open_roll_ids(),
  private.my_admin_roll_ids(),
  private.my_visible_crew_ids(),
  private.my_space_user_ids(),
  private.my_thread_keys(),
  private.thread_unread(uuid, text, timestamptz),
  private.photo_audience_before_insert(),
  private.fanout_upload_batches(),
  private.claim_push_batch(integer),
  private.call_push_dispatch(text),
  private.broadcast_photos_changed(uuid),
  private.photos_after_status(),
  private.photos_after_visibility(),
  public.roll_photos(uuid, timestamptz, uuid, uuid, integer),
  public.photos_by_ids(uuid[]),
  public.home_feed(),
  public.inbox_threads()
to service_role;

-- helpers that RLS policies call as the invoking role
grant execute on function
  private.my_roll_ids(),
  private.my_open_roll_ids(),
  private.my_admin_roll_ids(),
  private.my_visible_crew_ids(),
  private.my_space_user_ids(),
  private.my_thread_keys()
to authenticated;

-- authenticated RPCs (guests are role `authenticated` with the is_anonymous claim, so roll_photos and
-- photos_by_ids work for them; the visibility rules decide what comes back)
grant execute on function
  public.roll_photos(uuid, timestamptz, uuid, uuid, integer),
  public.photos_by_ids(uuid[]),
  public.home_feed(),
  public.inbox_threads()
to authenticated;

analyze public.photos;
analyze public.rolls;
