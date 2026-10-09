-- 08 · Read-model RPCs: home_feed, crew_overview, roll_header, inbox_threads, my_storage,
-- my_profile_stats (docs/architecture.md §5). One call per screen, no N+1 from the client.
--
-- All of them are security definer but scope strictly through the caller's private.my_*_ids()
-- arrays, so they show exactly what RLS would show, minus anything that must not leave a roll
-- (cover thumbs of sealed rolls come back null; the Surprise honoree gets nothing for the roll).
--
-- Shapes (extras beyond §5 are additive):
--   home_feed()        -> {live_rolls:[{id,name,crew_id,crew_name,crew_tint,photo_count,starts_on,ends_on,sealed,
--                           reveal_at,cover_thumb_key,last_activity_at}],
--                          pending_invites:[{id,invite_code,kind,crew:{id,name,tint},roll:{id,name}|null,
--                           inviter:{id,display_name,avatar_key},expires_at,created_at}],
--                          crews:[{id,name,tint,role,muted,member_count,facepile:[{id,display_name,avatar_key,ring_color}],
--                           last_activity_at,unread_count,stack:[thumb_key<=3],live_roll:{id,name}|null,
--                           deleted_at,purge_after}]}
--   crew_overview(id)  -> {crew:{id,name,tint,cover_thumb_key,last_activity_at,deleted_at,purge_after,created_by},
--                          my:{role,muted,is_admin}, pending_join_requests:int,
--                          members:[{user_id,display_name,handle,avatar_key,ring_color,role,joined_at}],
--                          rolls:[{id,name,kind,cover_thumb_key,photo_count,starts_on,ends_on,sealed,reveal_at,
--                           locked_until,live,last_activity_at}]}
--   roll_header(id)    -> {roll:{...settings...}, crew:{id,name,tint,deleted_at,purge_after}, chapters:[{id,name,sort,day}],
--                          my:{role,via,is_admin,is_guest,can_upload,muted}, photo_count, my_pending, review_count,
--                          sealed, contributors:[{id,display_name,avatar_key,ring_color,photo_count}]}
--   my_storage()       -> {used_bytes, limit_bytes|null, by_crew:[{crew_id,name,tint,bytes}]}
--   my_profile_stats() -> {rolls, crews, photos}
-- "Live" = private.roll_is_live(): today (IST) inside [starts_on, ends_on], or activity in the last 24h on
-- a roll that has not ended.

-- unread messages in one thread since the reader's marker (or since they joined), capped at 100
create function private.thread_unread(p_user uuid, p_thread_key text, p_since timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from (
    select 1
    from public.messages m
    where m.thread_key = p_thread_key
      and m.created_at > coalesce(
            (select tr.last_read_at from public.thread_reads tr
              where tr.user_id = p_user and tr.thread_key = p_thread_key),
            p_since)
      and m.author_id <> p_user
      and m.deleted_at is null
    limit 100
  ) x
$$;

-- ---------------------------------------------------------------------------------------------
-- home_feed (B1)
-- ---------------------------------------------------------------------------------------------
create function public.home_feed()
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
          select coalesce(jsonb_agg(jsonb_build_object(
                   'id', f.id, 'display_name', f.display_name, 'avatar_key', f.avatar_key, 'ring_color', f.ring_color)
                 order by f.mine, f.joined_at, f.id), '[]'::jsonb)
          from (
            select p.id, p.display_name, p.avatar_key, p.ring_color, (p.id = v_me) as mine, m.joined_at
            from public.crew_members m join public.profiles p on p.id = m.user_id
            where m.crew_id = c.id
            order by (p.id = v_me), m.joined_at, p.id
            limit 5
          ) f),
        'last_activity_at', c.last_activity_at,
        'unread_count', case when v_guest then 0 else
            private.thread_unread(v_me, 'c:' || c.id::text, me.joined_at)
            + coalesce((select sum(private.thread_unread(v_me, 'r:' || r.id::text, me.joined_at))::integer
                        from public.rolls r where r.crew_id = c.id and r.id = any (v_rolls)), 0)
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
-- crew_overview (B2)
-- ---------------------------------------------------------------------------------------------
create function public.crew_overview(p_crew_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.require_user();
  v_crew   public.crews;
  v_my     public.crew_members;
  v_rolls  uuid[];
  v_members jsonb;
  v_list   jsonb;
  v_pending integer := 0;
begin
  if not (p_crew_id = any (private.my_crew_ids())) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  select * into v_crew from public.crews c where c.id = p_crew_id;
  select * into v_my from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = v_me;
  v_rolls := private.my_roll_ids();

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p.id, 'display_name', p.display_name, 'handle', p.handle, 'avatar_key', p.avatar_key,
           'ring_color', p.ring_color, 'role', cm.role, 'joined_at', cm.joined_at)
         order by (cm.role = 'host') desc, (cm.role = 'cohost') desc, cm.joined_at, p.id), '[]'::jsonb)
    into v_members
  from public.crew_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.crew_id = p_crew_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'kind', r.kind,
           'cover_thumb_key', private.cover_thumb(r.cover_photo_id),
           'photo_count', r.photo_count, 'starts_on', r.starts_on, 'ends_on', r.ends_on,
           'sealed', private.roll_is_sealed(r), 'reveal_at', r.reveal_at, 'locked_until', r.locked_until,
           'live', private.roll_is_live(r), 'last_activity_at', r.last_activity_at)
         order by r.last_activity_at desc, r.id), '[]'::jsonb)
    into v_list
  from public.rolls r
  where r.crew_id = p_crew_id and r.id = any (v_rolls);

  if v_my.role in ('host', 'cohost') then
    select count(*) into v_pending from public.join_requests jr
     where jr.crew_id = p_crew_id and jr.status = 'pending';
  end if;

  return jsonb_build_object(
    'crew', jsonb_build_object(
      'id', v_crew.id, 'name', v_crew.name, 'tint', v_crew.tint,
      'cover_thumb_key', private.cover_thumb(v_crew.cover_photo_id),
      'last_activity_at', v_crew.last_activity_at, 'deleted_at', v_crew.deleted_at,
      'purge_after', v_crew.purge_after, 'created_by', v_crew.created_by),
    'my', jsonb_build_object('role', v_my.role, 'muted', v_my.muted, 'is_admin', v_my.role in ('host', 'cohost')),
    'pending_join_requests', v_pending,
    'members', v_members,
    'rolls', v_list);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- roll_header (B3)
-- ---------------------------------------------------------------------------------------------
create function public.roll_header(p_roll_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.require_user();
  v_roll    public.rolls;
  v_crew    public.crews;
  v_cm      public.crew_members;
  v_rm      public.roll_members;
  v_sealed  boolean;
  v_chapters jsonb;
  v_contrib jsonb := '[]'::jsonb;
  v_pending integer;
  v_review  integer := 0;
  v_admin   boolean;
begin
  if not (p_roll_id = any (private.my_roll_ids())) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  select * into v_roll from public.rolls r where r.id = p_roll_id;
  select * into v_crew from public.crews c where c.id = v_roll.crew_id;
  select * into v_cm from public.crew_members cm where cm.crew_id = v_roll.crew_id and cm.user_id = v_me;
  select * into v_rm from public.roll_members rm where rm.roll_id = p_roll_id and rm.user_id = v_me;
  v_sealed := private.roll_is_sealed(v_roll);
  v_admin := private.is_roll_admin(p_roll_id);

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'sort', t.sort, 'day', t.day)
                            order by t.sort, t.name), '[]'::jsonb) into v_chapters
  from public.tags t where t.roll_id = p_roll_id and t.kind = 'chapter';

  select count(*) into v_pending from public.photos p
   where p.roll_id = p_roll_id and p.uploader_id = v_me and p.status in ('pending', 'review');
  if v_admin then
    select count(*) into v_review from public.photos p where p.roll_id = p_roll_id and p.status = 'review';
  end if;

  if not v_sealed then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'display_name', pr.display_name, 'avatar_key', pr.avatar_key,
             'ring_color', pr.ring_color, 'photo_count', c.n) order by c.n desc, c.uploader_id), '[]'::jsonb)
      into v_contrib
    from (
      select p.uploader_id as id, p.uploader_id, count(*) as n
      from public.photos p
      where p.roll_id = p_roll_id and p.status = 'ready' and p.visibility = 'everyone'
      group by p.uploader_id
      order by count(*) desc, p.uploader_id
      limit 5
    ) c
    join public.profiles pr on pr.id = c.uploader_id;
  end if;

  return jsonb_build_object(
    'roll', jsonb_build_object(
      'id', v_roll.id, 'crew_id', v_roll.crew_id, 'name', v_roll.name, 'kind', v_roll.kind,
      'cover_thumb_key', private.cover_thumb(v_roll.cover_photo_id),
      'starts_on', v_roll.starts_on, 'ends_on', v_roll.ends_on, 'location_name', v_roll.location_name,
      'reveal_mode', v_roll.reveal_mode, 'reveal_at', v_roll.reveal_at, 'locked_until', v_roll.locked_until,
      'allow_uploads', v_roll.allow_uploads, 'allow_downloads', v_roll.allow_downloads,
      'allow_member_invites', v_roll.allow_member_invites, 'guests_allowed', v_roll.guests_allowed,
      'guest_uploads_review', v_roll.guest_uploads_review, 'created_by', v_roll.created_by,
      'last_activity_at', v_roll.last_activity_at),
    'crew', jsonb_build_object('id', v_crew.id, 'name', v_crew.name, 'tint', v_crew.tint,
                               'deleted_at', v_crew.deleted_at, 'purge_after', v_crew.purge_after),
    'chapters', v_chapters,
    'my', jsonb_build_object(
      'role', coalesce(v_cm.role::text, v_rm.role::text),
      'via', case when v_cm.user_id is not null then 'crew' else 'roll' end,
      'is_admin', v_admin,
      'is_guest', coalesce(v_rm.role = 'guest', false),
      'can_upload', private.can_upload(p_roll_id),
      'muted', coalesce(v_cm.muted, false) or coalesce(v_rm.muted, false)),
    'photo_count', v_roll.photo_count,
    'my_pending', v_pending,
    'review_count', v_review,
    'sealed', v_sealed,
    'contributors', v_contrib);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- inbox_threads (C6 Chats): one row per crew thread and per roll thread I can read.
-- Guests have no chat, so they get no rows.
-- ---------------------------------------------------------------------------------------------
create function public.inbox_threads()
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
         private.thread_unread(v_me, t.tk, t.since), t.mt, t.la
  from threads t
  left join lateral (
    select m.id, m.body, m.kind, m.photo_id, m.created_at, m.author_id
    from public.messages m
    where m.thread_key = t.tk and m.deleted_at is null
    order by m.created_at desc limit 1
  ) lm on true
  left join public.profiles pr on pr.id = lm.author_id
  order by lm.created_at desc nulls last, t.la desc, t.tk;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- my_storage (F4) / my_profile_stats (F5)
-- ---------------------------------------------------------------------------------------------
create function public.my_storage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.require_user();
  v_used    bigint;
  v_limit   bigint;
  v_by_crew jsonb;
begin
  select pr.storage_used_bytes, coalesce(pr.storage_quota_bytes, private.setting_int('limits', 'storage_bytes_per_user'))
    into v_used, v_limit
  from public.profiles pr where pr.id = v_me;

  select coalesce(jsonb_agg(jsonb_build_object('crew_id', x.id, 'name', x.name, 'tint', x.tint, 'bytes', x.bytes)
                            order by x.bytes desc, x.id), '[]'::jsonb) into v_by_crew
  from (
    select c.id, c.name, c.tint, sum(p.bytes)::bigint as bytes
    from public.photos p join public.crews c on c.id = p.crew_id
    where p.uploader_id = v_me and p.status = 'ready'
    group by c.id, c.name, c.tint
  ) x;

  return jsonb_build_object('used_bytes', coalesce(v_used, 0), 'limit_bytes', v_limit, 'by_crew', v_by_crew);
end;
$$;

create function public.my_profile_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_user();
begin
  return jsonb_build_object(
    'rolls', cardinality(private.my_roll_ids()),
    'crews', cardinality(private.my_crew_ids()),
    'photos', (select count(*) from public.photos p where p.uploader_id = v_me and p.status = 'ready'));
end;
$$;
