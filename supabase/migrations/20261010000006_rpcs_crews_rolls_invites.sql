-- 06 · RPCs: handle check, crews, rolls, invites, membership & roles (docs/architecture.md §5).
--
-- Every RPC is security definer, set search_path = '', validates everything and raises
--     raise exception using errcode = 'P0001', message = '<snake_code>';
-- Execute grants are applied centrally in 10_grants_realtime (nothing here is callable by anon
-- except check_handle and invite_preview).

-- ---------------------------------------------------------------------------------------------
-- Internal guards
-- ---------------------------------------------------------------------------------------------
-- crew must exist (else not_a_member, so ids can't be probed) and must not be soft-deleted
create function private.assert_crew_writable(p_crew uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_deleted timestamptz;
  v_found   boolean;
begin
  select true, c.deleted_at into v_found, v_deleted from public.crews c where c.id = p_crew;
  if v_found is null then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if v_deleted is not null then
    raise exception using errcode = 'P0001', message = 'crew_deleted';
  end if;
end;
$$;

-- Caller may create invites for this crew (roll_id null) or roll: admins always; for a roll, any
-- non-guest with roll access while rolls.allow_member_invites. Whole-crew invites are admin only.
create function private.assert_can_invite(p_crew uuid, p_roll uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.require_non_guest();
  v_roll   public.rolls;
begin
  perform private.assert_crew_writable(p_crew);
  if p_roll is null then
    if not exists (select 1 from public.crew_members cm where cm.crew_id = p_crew and cm.user_id = v_me) then
      raise exception using errcode = 'P0001', message = 'not_a_member';
    end if;
    if not private.is_crew_admin(p_crew) then
      raise exception using errcode = 'P0001', message = 'not_admin';
    end if;
    return;
  end if;
  select * into v_roll from public.rolls r where r.id = p_roll and r.deleted_at is null;
  if not found or v_roll.crew_id <> p_crew or not (p_roll = any (private.my_roll_ids())) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if private.is_roll_admin(p_roll) then
    return;
  end if;
  if not v_roll.allow_member_invites then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- check_handle (A3) · anon + authenticated
-- ---------------------------------------------------------------------------------------------
create function public.check_handle(p_handle text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me    uuid := (select auth.uid());
  v_h     text := ltrim(lower(btrim(coalesce(p_handle, ''))), '@');
  v_valid boolean;
  v_avail boolean;
  v_base  text;
  v_cand  text;
  v_sugg  text[] := '{}';
  v_try   integer := 0;
begin
  v_valid := v_h ~ '^[a-z0-9._]{3,24}$';
  v_avail := v_valid and not exists (
    select 1 from public.profiles p where lower(p.handle) = v_h and p.id is distinct from v_me
  );
  v_base := left(regexp_replace(v_h, '[^a-z0-9._]', '', 'g'), 18);
  if char_length(v_base) < 3 then
    v_base := left(v_base || 'user', 18);
  end if;
  while cardinality(v_sugg) < 3 and v_try < 60 loop
    v_try := v_try + 1;
    v_cand := v_base || case v_try % 3
      when 1 then (floor(random() * 90) + 10)::integer::text
      when 2 then '_' || (floor(random() * 900) + 100)::integer::text
      else '.' || (floor(random() * 90) + 10)::integer::text
    end;
    if v_cand ~ '^[a-z0-9._]{3,24}$'
       and v_cand <> v_h
       and not (v_cand = any (v_sugg))
       and not exists (select 1 from public.profiles p where lower(p.handle) = v_cand) then
      v_sugg := v_sugg || v_cand;
    end if;
  end loop;
  return jsonb_build_object('available', v_avail, 'suggestions', to_jsonb(v_sugg));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Crews & rolls
-- ---------------------------------------------------------------------------------------------
create function public.create_crew(p_name text, p_tint public.crew_tint default 'lilac')
returns public.crews
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me   uuid := private.require_non_guest();
  v_name text := btrim(coalesce(p_name, ''));
  v_crew public.crews;
begin
  if char_length(v_name) not between 1 and 60 or p_tint is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_me) then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  insert into public.crews (name, tint, created_by) values (v_name, p_tint, v_me) returning * into v_crew;
  insert into public.crew_members (crew_id, user_id, role) values (v_crew.id, v_me, 'host');
  return v_crew;
end;
$$;

create function public.create_roll(
  p_crew_id     uuid,
  p_name        text,
  p_kind        public.roll_kind   default 'other',
  p_starts_on   date               default null,
  p_ends_on     date               default null,
  p_reveal_mode public.reveal_mode default 'live',
  p_chapters    text[]             default '{}'
)
returns public.rolls
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me        uuid := private.require_non_guest();
  v_name      text := btrim(coalesce(p_name, ''));
  v_reveal_at timestamptz;
  v_roll      public.rolls;
  v_chapter   text;
  v_seen      text[] := '{}';
  v_sort      smallint := 0;
begin
  if char_length(v_name) not between 1 and 60
     or p_kind is null
     or p_reveal_mode is null
     or (p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on)
     or cardinality(coalesce(p_chapters, '{}'::text[])) > 30 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  perform private.assert_crew_writable(p_crew_id);
  if not exists (select 1 from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = v_me) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;

  -- delayed reveal (P2 UI): open at 00:00 IST the day after the event ends, or 08:00 for next_morning
  if p_reveal_mode <> 'live' then
    if p_ends_on is null then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    v_reveal_at := ((p_ends_on + 1)::timestamp
                    + case p_reveal_mode when 'next_morning' then interval '8 hours' else interval '0' end)
                   at time zone 'Asia/Kolkata';
  end if;

  insert into public.rolls (crew_id, name, kind, starts_on, ends_on, reveal_mode, reveal_at, created_by)
  values (p_crew_id, v_name, p_kind, p_starts_on, p_ends_on, p_reveal_mode, v_reveal_at, v_me)
  returning * into v_roll;

  foreach v_chapter in array coalesce(p_chapters, '{}'::text[]) loop
    v_chapter := btrim(coalesce(v_chapter, ''));
    if v_chapter = '' then
      continue;
    end if;
    if char_length(v_chapter) > 40 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    if lower(v_chapter) = any (v_seen) then
      continue;
    end if;
    v_seen := v_seen || lower(v_chapter);
    insert into public.tags (crew_id, roll_id, kind, name, sort)
    values (p_crew_id, v_roll.id, 'chapter', v_chapter, v_sort);
    v_sort := v_sort + 1;
  end loop;

  update public.crews set last_activity_at = now() where id = p_crew_id;
  return v_roll;
end;
$$;

-- NULL arguments leave a field unchanged (the cover can be replaced, not cleared)
create function public.update_crew(
  p_crew_id        uuid,
  p_name           text             default null,
  p_tint           public.crew_tint default null,
  p_cover_photo_id uuid             default null
)
returns public.crews
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me   uuid := private.require_user();
  v_name text := case when p_name is null then null else btrim(p_name) end;
  v_crew public.crews;
begin
  perform private.assert_crew_writable(p_crew_id);
  if not exists (select 1 from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = v_me) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if not private.is_crew_admin(p_crew_id) then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  if v_name is not null and char_length(v_name) not between 1 and 60 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if p_cover_photo_id is not null and not exists (
    select 1 from public.photos p where p.id = p_cover_photo_id and p.crew_id = p_crew_id
      and p.status = 'ready' and p.visibility = 'everyone'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  update public.crews c
     set name           = coalesce(v_name, c.name),
         tint           = coalesce(p_tint, c.tint),
         cover_photo_id = coalesce(p_cover_photo_id, c.cover_photo_id)
   where c.id = p_crew_id
   returning * into v_crew;
  return v_crew;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------------------------
-- Creates or reuses (same creator + identical settings incl. ttl, still valid) an invite. Caller already authorised.
create function private.create_invite_core(
  p_user uuid, p_crew uuid, p_roll uuid, p_ttl_days integer,
  p_requires_approval boolean, p_allow_guests boolean, p_max_uses integer
)
returns public.invites
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ttl    integer := coalesce(p_ttl_days, private.setting_int('limits', 'invite_ttl_days')::integer, 7);
  v_guests boolean := case when p_roll is null then false else coalesce(p_allow_guests, true) end;
  v_req    boolean := coalesce(p_requires_approval, false);
  v_inv    public.invites;
  v_try    integer := 0;
begin
  if v_ttl not between 1 and 365 or (p_max_uses is not null and p_max_uses < 1) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  select * into v_inv
  from public.invites i
  where i.created_by = p_user
    and i.crew_id = p_crew
    and i.roll_id is not distinct from p_roll
    and i.revoked_at is null
    and i.expires_at > now()
    and (i.max_uses is null or i.use_count < i.max_uses)
    and i.requires_approval = v_req
    and i.allow_guests = v_guests
    and i.max_uses is not distinct from p_max_uses
    and round(extract(epoch from (i.expires_at - i.created_at)) / 86400) = v_ttl   -- same link lifetime
  order by i.created_at desc
  limit 1;
  if found then
    return v_inv;
  end if;

  loop
    begin
      insert into public.invites (code, crew_id, roll_id, created_by, expires_at, max_uses, requires_approval, allow_guests)
      values (private.gen_invite_code(), p_crew, p_roll, p_user, now() + make_interval(days => v_ttl),
              p_max_uses, v_req, v_guests)
      returning * into v_inv;
      return v_inv;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

create function public.create_invite(
  p_crew_id           uuid,
  p_roll_id           uuid    default null,
  p_ttl_days          integer default null,
  p_requires_approval boolean default false,
  p_allow_guests      boolean default true,
  p_max_uses          integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.require_non_guest();
  v_inv public.invites;
begin
  perform private.assert_can_invite(p_crew_id, p_roll_id);
  v_inv := private.create_invite_core(v_me, p_crew_id, p_roll_id, p_ttl_days, p_requires_approval, p_allow_guests, p_max_uses);
  return jsonb_build_object(
    'code', v_inv.code,
    'url', private.invite_url(v_inv.roll_id, v_inv.code),
    'expires_at', v_inv.expires_at);
end;
$$;

create function public.revoke_invite(p_code text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.require_user();
  v_inv public.invites;
begin
  select * into v_inv from public.invites i where i.code = lower(btrim(coalesce(p_code, '')));
  if not found then
    raise exception using errcode = 'P0001', message = 'invite_not_found';
  end if;
  if v_inv.created_by is distinct from v_me
     and not (case when v_inv.roll_id is null then private.is_crew_admin(v_inv.crew_id)
                   else private.is_roll_admin(v_inv.roll_id) end) then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  update public.invites set revoked_at = coalesce(revoked_at, now()) where id = v_inv.id;
end;
$$;

-- anon + authenticated. Never returns phones; never returns photo keys of sealed rolls; reports
-- not_found for a Surprise Roll to its own honoree.
create function public.invite_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me      uuid := (select auth.uid());
  v_inv     public.invites;
  v_crew    public.crews;
  v_roll    public.rolls;
  v_status  text;
  v_host    jsonb;
  v_members integer;
  v_face    jsonb;
  v_cover   text;
  v_is_member boolean := false;
  v_pending boolean := false;
begin
  select * into v_inv from public.invites i where i.code = lower(btrim(coalesce(p_code, '')));
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into v_crew from public.crews c where c.id = v_inv.crew_id;
  if not found or v_crew.deleted_at is not null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_inv.roll_id is not null then
    select * into v_roll from public.rolls r where r.id = v_inv.roll_id and r.deleted_at is null;
    if not found or coalesce(v_roll.surprise_honoree_id = v_me and now() < v_roll.reveal_at, false) then
      return jsonb_build_object('status', 'not_found');
    end if;
  end if;

  v_status := case
    when v_inv.revoked_at is not null then 'revoked'
    when v_inv.expires_at <= now() then 'expired'
    when v_inv.max_uses is not null and v_inv.use_count >= v_inv.max_uses then 'full'
    else 'ok' end;

  -- the person who made the link (usually the host); falls back to the crew's oldest host
  select jsonb_build_object('display_name', p.display_name, 'avatar_key', p.avatar_key) into v_host
  from public.profiles p
  where p.id = coalesce(
    (select i.created_by from public.invites i where i.id = v_inv.id and exists (select 1 from public.profiles x where x.id = i.created_by)),
    (select cm.user_id from public.crew_members cm where cm.crew_id = v_crew.id and cm.role = 'host' order by cm.joined_at limit 1));

  select count(*) into v_members from (
    select cm.user_id from public.crew_members cm where cm.crew_id = v_crew.id
    union
    select rm.user_id from public.roll_members rm where rm.roll_id = v_inv.roll_id
  ) m;

  select coalesce(jsonb_agg(jsonb_build_object(
           'display_name', f.display_name, 'avatar_key', f.avatar_key, 'ring_color', f.ring_color)), '[]'::jsonb)
    into v_face
  from (
    select p.display_name, p.avatar_key, p.ring_color
    from public.crew_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.crew_id = v_crew.id
    order by (cm.role = 'host') desc, cm.joined_at, cm.user_id
    limit 5
  ) f;

  v_cover := private.cover_thumb(case when v_inv.roll_id is null then v_crew.cover_photo_id else v_roll.cover_photo_id end);

  if v_me is not null then
    v_is_member := exists (select 1 from public.crew_members cm where cm.crew_id = v_crew.id and cm.user_id = v_me)
      or (v_inv.roll_id is not null and exists (
            select 1 from public.roll_members rm where rm.roll_id = v_inv.roll_id and rm.user_id = v_me));
    v_pending := exists (
      select 1 from public.join_requests jr
      where jr.user_id = v_me and jr.crew_id = v_crew.id and jr.roll_id is not distinct from v_inv.roll_id
        and jr.status = 'pending');
  end if;

  return jsonb_build_object(
    'status', v_status,
    'kind', case when v_inv.roll_id is null then 'crew' else 'roll' end,
    'crew', jsonb_build_object('id', v_crew.id, 'name', v_crew.name, 'tint', v_crew.tint),
    'roll', case when v_inv.roll_id is null then null else jsonb_build_object(
              'id', v_roll.id, 'name', v_roll.name, 'starts_on', v_roll.starts_on, 'ends_on', v_roll.ends_on,
              'photo_count', v_roll.photo_count, 'sealed', private.roll_is_sealed(v_roll),
              'reveal_at', v_roll.reveal_at) end,
    'host', coalesce(v_host, jsonb_build_object('display_name', null, 'avatar_key', null)),
    'member_count', v_members,
    'facepile', v_face,
    'cover_thumb_key', v_cover,
    'requires_approval', v_inv.requires_approval,
    'allow_guests', v_inv.allow_guests and (v_inv.roll_id is not null and v_roll.guests_allowed),
    'viewer', jsonb_build_object('is_member', v_is_member, 'request_pending', v_pending)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Joining
-- ---------------------------------------------------------------------------------------------
-- Puts a user into the crew (crew invite) or the roll (roll invite, only when not a crew member).
create function private.add_member(
  p_user uuid, p_crew uuid, p_roll uuid, p_invited_by uuid, p_guest boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_roll is null then
    insert into public.crew_members (crew_id, user_id, role, invited_by)
    values (p_crew, p_user, 'member', p_invited_by)
    on conflict do nothing;
    -- crew membership supersedes roll-only access to this crew's rolls
    delete from public.roll_members rm
    using public.rolls r
    where rm.roll_id = r.id and r.crew_id = p_crew and rm.user_id = p_user;
  else
    insert into public.roll_members (roll_id, user_id, role, invited_by)
    values (p_roll, p_user, case when p_guest then 'guest' else 'member' end::public.roll_member_role, p_invited_by)
    on conflict do nothing;
  end if;
end;
$$;

-- p_mode: 'link'     link/QR join (full validation, approval honoured)
--         'direct'   in-app invite accepted by the invitee (full validation, approval bypassed)
create function private.join_core(p_user uuid, p_inv public.invites, p_guest boolean, p_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_crew      public.crews;
  v_roll      public.rolls;
  v_is_member boolean;
  v_req_id    uuid;
begin
  select * into v_crew from public.crews c where c.id = p_inv.crew_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'invite_not_found';
  end if;
  if p_inv.roll_id is not null then
    select * into v_roll from public.rolls r where r.id = p_inv.roll_id and r.deleted_at is null;
    if not found or coalesce(v_roll.surprise_honoree_id = p_user and now() < v_roll.reveal_at, false) then
      raise exception using errcode = 'P0001', message = 'invite_not_found';
    end if;
  end if;

  v_is_member := exists (select 1 from public.crew_members cm where cm.crew_id = p_inv.crew_id and cm.user_id = p_user)
    or (p_inv.roll_id is not null and exists (
          select 1 from public.roll_members rm where rm.roll_id = p_inv.roll_id and rm.user_id = p_user));
  if v_is_member then
    return jsonb_build_object('status', 'already_member', 'crew_id', p_inv.crew_id, 'roll_id', p_inv.roll_id);
  end if;

  if v_crew.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'crew_deleted';
  end if;
  if p_inv.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'invite_revoked';
  end if;
  if p_inv.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'invite_expired';
  end if;
  if p_inv.max_uses is not null and p_inv.use_count >= p_inv.max_uses then
    raise exception using errcode = 'P0001', message = 'invite_full';
  end if;

  if p_guest then
    if p_inv.roll_id is null then
      raise exception using errcode = 'P0001', message = 'guest_not_allowed';
    end if;
    if not p_inv.allow_guests or not v_roll.guests_allowed then
      raise exception using errcode = 'P0001', message = 'guests_not_allowed';
    end if;
  end if;

  if p_inv.created_by is not null and exists (
    select 1 from public.blocks b where b.blocker_id = p_inv.created_by and b.blocked_id = p_user
  ) then
    raise exception using errcode = 'P0001', message = 'blocked';
  end if;

  if p_inv.requires_approval and p_mode = 'link' then
    begin
      insert into public.join_requests (crew_id, roll_id, user_id, invite_id)
      values (p_inv.crew_id, p_inv.roll_id, p_user, p_inv.id)
      returning id into v_req_id;
      perform private.emit_activity(
        private.admin_ids_for(p_inv.crew_id, p_inv.roll_id), p_user, p_inv.crew_id, p_inv.roll_id, null,
        'join_request',
        jsonb_build_object('request_id', v_req_id, 'requester_name', private.display_name_of(p_user)), true);
    exception when unique_violation then
      null;   -- already pending: idempotent
    end;
    return jsonb_build_object('status', 'requested', 'crew_id', p_inv.crew_id, 'roll_id', p_inv.roll_id);
  end if;

  perform private.add_member(p_user, p_inv.crew_id, p_inv.roll_id, p_inv.created_by, p_guest);
  update public.invites set use_count = use_count + 1 where id = p_inv.id;
  return jsonb_build_object('status', 'joined', 'crew_id', p_inv.crew_id, 'roll_id', p_inv.roll_id);
end;
$$;

create function public.join_via_invite(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.require_user();
  v_inv   public.invites;
  v_guest boolean;
begin
  select * into v_inv from public.invites i where i.code = lower(btrim(coalesce(p_code, ''))) for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invite_not_found';
  end if;
  v_guest := private.is_guest()
    or coalesce((select p.is_guest from public.profiles p where p.id = v_me), false);
  return private.join_core(v_me, v_inv, v_guest, 'link');
end;
$$;

create function public.decide_join_request(p_id uuid, p_approve boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.require_non_guest();
  v_req   public.join_requests;
  v_guest boolean;
  v_roll  public.rolls;
begin
  select * into v_req from public.join_requests jr where jr.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if not (case when v_req.roll_id is null then private.is_crew_admin(v_req.crew_id)
               else private.is_roll_admin(v_req.roll_id) end) then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  if v_req.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if p_approve is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if p_approve then
    perform private.assert_crew_writable(v_req.crew_id);
    v_guest := coalesce((select p.is_guest from public.profiles p where p.id = v_req.user_id), false);
    if v_req.roll_id is not null then
      select * into v_roll from public.rolls r where r.id = v_req.roll_id and r.deleted_at is null;
      if not found then
        raise exception using errcode = 'P0001', message = 'invalid_input';
      end if;
      if v_guest and not v_roll.guests_allowed then
        raise exception using errcode = 'P0001', message = 'guests_not_allowed';
      end if;
    end if;
    perform private.add_member(v_req.user_id, v_req.crew_id, v_req.roll_id, v_me, v_guest);
    if v_req.invite_id is not null then
      update public.invites set use_count = use_count + 1 where id = v_req.invite_id;
    end if;
    -- tell the requester they are in
    perform private.emit_activity(array[v_req.user_id], v_me, v_req.crew_id, v_req.roll_id, null, 'joined',
                                  jsonb_build_object('status', 'approved'), true);
  end if;

  update public.join_requests
     set status = case when p_approve then 'approved' else 'denied' end::public.request_status,
         decided_by = v_me,
         decided_at = now()
   where id = p_id;
end;
$$;

-- In-app invite to existing users -> direct_invites + Inbox activity (+ push). Returns
-- {invite:{code,url,expires_at}, invited:[uuid], skipped:[{user_id, reason}]}.
create function public.invite_users(p_crew_id uuid, p_roll_id uuid, p_user_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.require_non_guest();
  v_inv     public.invites;
  v_roll    public.rolls;
  v_u       uuid;
  v_ids     uuid[];
  v_invited uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_reason  text;
  v_di      uuid;
  v_prof    public.profiles;
begin
  if p_user_ids is null or cardinality(p_user_ids) = 0 or cardinality(p_user_ids) > 100 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  perform private.assert_can_invite(p_crew_id, p_roll_id);
  if p_roll_id is not null then
    select * into v_roll from public.rolls r where r.id = p_roll_id;
  end if;
  v_inv := private.create_invite_core(v_me, p_crew_id, p_roll_id, null, false, false, null);

  select array_agg(distinct x) into v_ids from unnest(p_user_ids) x where x is not null;
  foreach v_u in array coalesce(v_ids, '{}'::uuid[]) loop
    v_reason := null;
    select * into v_prof from public.profiles p where p.id = v_u;
    if v_u = v_me then v_reason := 'self';
    elsif v_prof.id is null then v_reason := 'not_found';
    elsif v_prof.is_guest then v_reason := 'guest';
    elsif exists (select 1 from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = v_u)
       or (p_roll_id is not null and exists (
            select 1 from public.roll_members rm where rm.roll_id = p_roll_id and rm.user_id = v_u)) then
      v_reason := 'already_member';
    elsif private.is_blocked_between(v_me, v_u) then v_reason := 'blocked';
    elsif v_prof.who_can_add = 'nobody' then v_reason := 'not_accepting';
    elsif p_roll_id is not null and coalesce(v_roll.surprise_honoree_id = v_u and now() < v_roll.reveal_at, false)
      then v_reason := 'not_found';
    end if;

    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_object('user_id', v_u, 'reason', v_reason);
      continue;
    end if;

    insert into public.direct_invites (invite_id, invitee_id) values (v_inv.id, v_u)
    on conflict (invite_id, invitee_id) do update set status = 'pending'
      where public.direct_invites.status = 'denied'
    returning id into v_di;
    if v_di is null then   -- already pending / accepted: nothing new to announce
      v_skipped := v_skipped || jsonb_build_object('user_id', v_u, 'reason', 'already_invited');
      continue;
    end if;
    v_invited := v_invited || v_u;
    perform private.emit_activity(array[v_u], v_me, p_crew_id, p_roll_id, null, 'invite',
      jsonb_build_object('code', v_inv.code, 'direct_invite_id', v_di,
                         'kind', case when p_roll_id is null then 'crew' else 'roll' end), true);
  end loop;

  return jsonb_build_object(
    'invite', jsonb_build_object('code', v_inv.code, 'url', private.invite_url(v_inv.roll_id, v_inv.code),
                                 'expires_at', v_inv.expires_at),
    'invited', to_jsonb(v_invited),
    'skipped', v_skipped);
end;
$$;

-- Returns {status: joined|requested|already_member|declined, crew_id, roll_id}.
-- Declining can be reversed (accept later) until the invite expires.
create function public.respond_direct_invite(p_id uuid, p_accept boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.require_non_guest();
  v_di  public.direct_invites;
  v_inv public.invites;
  v_res jsonb;
begin
  if p_accept is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select * into v_di from public.direct_invites d where d.id = p_id and d.invitee_id = v_me for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invite_not_found';
  end if;
  select * into v_inv from public.invites i where i.id = v_di.invite_id for update;

  if not p_accept then
    if v_di.status = 'pending' then
      update public.direct_invites set status = 'denied' where id = p_id;
    end if;
    return jsonb_build_object('status', 'declined', 'crew_id', v_inv.crew_id, 'roll_id', v_inv.roll_id);
  end if;

  v_res := private.join_core(v_me, v_inv, false, 'direct');
  update public.direct_invites set status = 'approved' where id = p_id;
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Roles & membership
-- ---------------------------------------------------------------------------------------------
create function public.set_member_role(p_crew_id uuid, p_user_id uuid, p_role public.member_role)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.require_user();
  v_target public.member_role;
begin
  if p_role is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  perform private.assert_crew_writable(p_crew_id);
  if not exists (select 1 from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = v_me) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if not exists (select 1 from public.crew_members cm
                 where cm.crew_id = p_crew_id and cm.user_id = v_me and cm.role = 'host') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  select cm.role into v_target from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = p_user_id for update;
  if v_target is null then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if v_target = 'host' and p_role <> 'host'
     and (select count(*) from public.crew_members cm where cm.crew_id = p_crew_id and cm.role = 'host') <= 1 then
    raise exception using errcode = 'P0001', message = 'last_host';
  end if;
  update public.crew_members set role = p_role where crew_id = p_crew_id and user_id = p_user_id;
end;
$$;

-- Core of remove_member; permission checks for p_actor live here so decide_report can reuse it.
create function private.remove_member_core(p_actor uuid, p_crew uuid, p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.member_role;
  v_target public.member_role;
begin
  perform private.assert_crew_writable(p_crew);
  select cm.role into v_actor from public.crew_members cm where cm.crew_id = p_crew and cm.user_id = p_actor;
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if v_actor = 'member' and p_user is distinct from p_actor then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  select cm.role into v_target from public.crew_members cm where cm.crew_id = p_crew and cm.user_id = p_user for update;
  if v_target is null then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if v_target = 'host' then
    if v_actor <> 'host' then
      raise exception using errcode = 'P0001', message = 'not_admin';
    end if;
    if (select count(*) from public.crew_members cm where cm.crew_id = p_crew and cm.role = 'host') <= 1 then
      raise exception using errcode = 'P0001', message = 'last_host';
    end if;
  end if;
  delete from public.crew_members where crew_id = p_crew and user_id = p_user;
  if p_user is distinct from p_actor then
    perform private.emit_activity(array[p_user], p_actor, p_crew, null, null, 'removed_from_crew', '{}'::jsonb, false);
  end if;
end;
$$;

create function public.remove_member(p_crew_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.remove_member_core(private.require_user(), p_crew_id, p_user_id);
end;
$$;

create function public.leave_crew(p_crew_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me   uuid := private.require_user();
  v_role public.member_role;
  v_grace integer := coalesce(private.setting_int('limits', 'deleted_crew_grace_days')::integer, 30);
begin
  select cm.role into v_role from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = v_me for update;
  if v_role is null then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if v_role = 'host'
     and not exists (select 1 from public.crew_members cm
                     where cm.crew_id = p_crew_id and cm.role = 'host' and cm.user_id <> v_me) then
    if exists (select 1 from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id <> v_me) then
      raise exception using errcode = 'P0001', message = 'last_host';
    end if;
    -- last person out: the crew goes to the deleted state (same grace window as delete_crew)
    update public.crews
       set deleted_at = coalesce(deleted_at, now()),
           purge_after = coalesce(purge_after, now() + make_interval(days => v_grace))
     where id = p_crew_id;
  end if;
  delete from public.crew_members where crew_id = p_crew_id and user_id = v_me;
end;
$$;

create function public.leave_roll(p_roll_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.require_user();
  v_n   integer;
begin
  delete from public.roll_members where roll_id = p_roll_id and user_id = v_me;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    if exists (select 1 from public.rolls r join public.crew_members cm on cm.crew_id = r.crew_id and cm.user_id = v_me
               where r.id = p_roll_id) then
      raise exception using errcode = 'P0001', message = 'invalid_input';   -- crew members leave the crew, not a roll
    end if;
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
end;
$$;

-- The caller stays on as cohost.
create function public.transfer_host(p_crew_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_user();
begin
  perform private.assert_crew_writable(p_crew_id);
  if not exists (select 1 from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = v_me) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if not exists (select 1 from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = v_me and cm.role = 'host') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  if p_user_id is null or p_user_id = v_me then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if not exists (select 1 from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  update public.crew_members set role = 'host' where crew_id = p_crew_id and user_id = p_user_id;
  update public.crew_members set role = 'cohost' where crew_id = p_crew_id and user_id = v_me;
end;
$$;

create function public.delete_crew(p_crew_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.require_user();
  v_grace integer := coalesce(private.setting_int('limits', 'deleted_crew_grace_days')::integer, 30);
begin
  perform private.assert_crew_writable(p_crew_id);
  if not exists (select 1 from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = v_me) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if not exists (select 1 from public.crew_members cm where cm.crew_id = p_crew_id and cm.user_id = v_me and cm.role = 'host') then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  update public.crews
     set deleted_at = now(), purge_after = now() + make_interval(days => v_grace)
   where id = p_crew_id;
  perform private.emit_activity(
    (select coalesce(array_agg(cm.user_id), '{}'::uuid[]) from public.crew_members cm where cm.crew_id = p_crew_id),
    v_me, p_crew_id, null, null, 'crew_deleted',
    jsonb_build_object('purge_after', now() + make_interval(days => v_grace)), true);
end;
$$;
