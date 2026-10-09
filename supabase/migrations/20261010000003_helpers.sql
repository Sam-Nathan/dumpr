-- 03 · Access helpers + shared internals (docs/architecture.md §4).
--
-- Everything in schema `private` is invisible to PostgREST. RLS policies call the helpers as the
-- INVOKING role, so 10_grants_realtime grants `authenticated` USAGE on the schema and EXECUTE on the
-- helpers the policies use. All security definer functions: set search_path = '', fully qualified
-- names, `(select auth.uid())`.
--
-- Array helpers return uuid[] and are compared once per statement:
--     using (roll_id = any ((select private.my_roll_ids())::uuid[]))

-- ---------------------------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------------------------
create function private.is_guest()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
$$;

-- Raises not_authenticated unless there is a signed-in user (anonymous guests count as signed in).
create function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  return v_uid;
end;
$$;

-- As require_user() but also rejects guests (anonymous sign-ins).
create function private.require_non_guest()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  if (select private.is_guest()) then
    raise exception using errcode = 'P0001', message = 'guest_not_allowed';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------
create function private.setting(p_key text, p_path text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_path is null then s.value else s.value #> string_to_array(p_path, '.') end
  from public.app_settings s
  where s.key = p_key
$$;

-- Integer view of a setting; JSON null / missing -> SQL null ("no limit").
create function private.setting_int(p_key text, p_path text default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(private.setting(p_key, p_path) #>> '{}', 'null')::bigint
$$;

-- ---------------------------------------------------------------------------------------------
-- Membership arrays
-- ---------------------------------------------------------------------------------------------
-- crews where I'm a crew_member (a purged crew no longer exists; one inside its purge window still counts)
create function private.my_crew_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(cm.crew_id), '{}'::uuid[])
  from public.crew_members cm
  join public.crews c on c.id = cm.crew_id
  where cm.user_id = (select auth.uid())
    and (c.purge_after is null or c.purge_after > now())
$$;

-- crews where I'm host or cohost
create function private.my_admin_crew_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(cm.crew_id), '{}'::uuid[])
  from public.crew_members cm
  join public.crews c on c.id = cm.crew_id
  where cm.user_id = (select auth.uid())
    and cm.role in ('host', 'cohost')
    and (c.purge_after is null or c.purge_after > now())
$$;

-- rolls of my crews + my roll_members rolls, EXCLUDING rolls hidden from me as the Surprise honoree
create function private.my_roll_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me    uuid := (select auth.uid());
  v_crews uuid[];
  v_out   uuid[];
begin
  if v_me is null then
    return '{}'::uuid[];
  end if;
  v_crews := private.my_crew_ids();
  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_out
  from public.rolls r
  where r.deleted_at is null
    and (
      r.crew_id = any (v_crews)
      or r.id in (select rm.roll_id from public.roll_members rm where rm.user_id = v_me)
    )
    and not coalesce(r.surprise_honoree_id = v_me and now() < r.reveal_at, false);
  return v_out;
end;
$$;

-- my_roll_ids() minus sealed ones (reveal_at in the future or locked_until in the future)
create function private.my_open_roll_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.id), '{}'::uuid[])
  from public.rolls r
  where r.id = any (private.my_roll_ids())
    and not (coalesce(r.reveal_at > now(), false) or coalesce(r.locked_until > now(), false))
$$;

-- rolls where I'm admin: crew host/cohost of the roll's crew OR the roll's creator (while a crew member)
create function private.my_admin_roll_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.id), '{}'::uuid[])
  from public.rolls r
  join public.crew_members cm on cm.crew_id = r.crew_id and cm.user_id = (select auth.uid())
  where r.id = any (private.my_roll_ids())
    and (cm.role in ('host', 'cohost') or r.created_by = (select auth.uid()))
$$;

-- my_crew_ids() ∪ crews of the rolls I only have roll-level access to
create function private.my_visible_crew_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x.crew_id), '{}'::uuid[])
  from (
    select unnest(private.my_crew_ids()) as crew_id
    union
    select r.crew_id from public.rolls r where r.id = any (private.my_roll_ids())
  ) x
$$;

-- every user I share a crew or a roll with, plus users with a pending join request to a space I administer
create function private.my_space_user_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid := (select auth.uid());
  v_crews  uuid[];
  v_rolls  uuid[];
  v_admin_crews uuid[];
  v_admin_rolls uuid[];
  v_out    uuid[];
begin
  if v_me is null then
    return '{}'::uuid[];
  end if;
  v_crews := private.my_crew_ids();
  v_rolls := private.my_roll_ids();
  v_admin_crews := private.my_admin_crew_ids();
  v_admin_rolls := private.my_admin_roll_ids();
  select coalesce(array_agg(u), '{}'::uuid[]) into v_out
  from (
    select cm.user_id as u from public.crew_members cm where cm.crew_id = any (v_crews)
    union
    select rm.user_id from public.roll_members rm where rm.roll_id = any (v_rolls)
    union
    select cm.user_id
      from public.crew_members cm
      join public.rolls r on r.crew_id = cm.crew_id
      where r.id = any (v_rolls)
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
-- Scalar checks (RPCs / policies on small tables only)
-- ---------------------------------------------------------------------------------------------
create function private.is_crew_admin(p_crew uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.crew_members cm
    where cm.crew_id = p_crew and cm.user_id = (select auth.uid()) and cm.role in ('host', 'cohost')
  )
$$;

-- crew host/cohost of the roll's crew OR rolls.created_by (while still a crew member); never for the
-- Surprise honoree before the reveal.
create function private.is_roll_admin(p_roll uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rolls r
    join public.crew_members cm on cm.crew_id = r.crew_id and cm.user_id = (select auth.uid())
    where r.id = p_roll
      and r.deleted_at is null
      and (cm.role in ('host', 'cohost') or r.created_by = (select auth.uid()))
      and not coalesce(r.surprise_honoree_id = (select auth.uid()) and now() < r.reveal_at, false)
  )
$$;

-- Same rule as can_upload() for an explicit user (service-role contexts have no JWT).
create function private.can_upload_as(p_user uuid, p_roll uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rolls r
    join public.crews c on c.id = r.crew_id
    join public.profiles pr on pr.id = p_user
    left join public.crew_members cm on cm.crew_id = r.crew_id and cm.user_id = p_user
    left join public.roll_members rm on rm.roll_id = r.id and rm.user_id = p_user
    where r.id = p_roll
      and r.deleted_at is null
      and c.deleted_at is null
      and (cm.user_id is not null or rm.user_id is not null)
      and not coalesce(r.surprise_honoree_id = p_user and now() < r.reveal_at, false)
      and (
        (cm.user_id is not null and (cm.role in ('host', 'cohost') or r.created_by = p_user))  -- admins always
        or r.allow_uploads
      )
      and (not pr.is_guest or r.guests_allowed)
  )
$$;

-- access to the roll, roll + crew not deleted, allow_uploads (admins always), guest rules
create function private.can_upload(p_roll uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_upload_as((select auth.uid()), p_roll)
$$;

create function private.shares_space(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_other = (select auth.uid()) or p_other = any (private.my_space_user_ids())
$$;

-- photo_audience lookup that bypasses photo_audience RLS (avoids photos <-> photo_audience policy recursion)
create function private.is_in_audience(p_photo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.photo_audience a
    where a.photo_id = p_photo and a.user_id = (select auth.uid())
  )
$$;

create function private.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a)
  )
$$;

create function private.display_name_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pr.display_name from public.profiles pr where pr.id = p_user
$$;

-- ---------------------------------------------------------------------------------------------
-- Roll state helpers
-- ---------------------------------------------------------------------------------------------
create function private.roll_is_sealed(p_roll public.rolls)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_roll.reveal_at > now(), false) or coalesce(p_roll.locked_until > now(), false)
$$;

-- "Live now" = today inside [starts_on, ends_on] (IST), or recent activity on a roll that hasn't ended.
create function private.roll_is_live(p_roll public.rolls)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_roll.deleted_at is null and (
    (p_roll.starts_on is not null
       and p_roll.starts_on <= (now() at time zone 'Asia/Kolkata')::date
       and coalesce(p_roll.ends_on, p_roll.starts_on) >= (now() at time zone 'Asia/Kolkata')::date)
    or (p_roll.last_activity_at > now() - interval '24 hours'
       and (p_roll.ends_on is null or p_roll.ends_on >= (now() at time zone 'Asia/Kolkata')::date))
  )
$$;

-- thumb key that may be shown outside the roll (previews, covers): ready, 'everyone', roll not sealed
create function private.cover_thumb(p_photo uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.thumb_key
  from public.photos p
  left join public.rolls r on r.id = p.roll_id
  where p.id = p_photo
    and p.status = 'ready'
    and p.visibility = 'everyone'
    and (r.id is null or (r.deleted_at is null and not private.roll_is_sealed(r)))
$$;

-- ---------------------------------------------------------------------------------------------
-- Invite internals
-- ---------------------------------------------------------------------------------------------
-- 10 chars from abcdefghjkmnpqrstuvwxyz23456789 (31 symbols, rejection sampling => no modulo bias)
create function private.gen_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_code  text := '';
  v_bytes bytea;
  v_b     integer;
  i       integer;
begin
  while char_length(v_code) < 10 loop
    v_bytes := extensions.gen_random_bytes(32);
    for i in 0..31 loop
      v_b := get_byte(v_bytes, i);
      if v_b < 248 then
        v_code := v_code || substr(c_alphabet, (v_b % 31) + 1, 1);
        exit when char_length(v_code) = 10;
      end if;
    end loop;
  end loop;
  return v_code;
end;
$$;

create function private.invite_url(p_roll uuid, p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'https://dumpr.app/' || case when p_roll is null then 'c/' else 'r/' end || p_code
$$;

-- ---------------------------------------------------------------------------------------------
-- Activity emission (single choke point: honoree + block filtering lives here)
-- ---------------------------------------------------------------------------------------------
-- Inserts one activity_events row per distinct recipient except: nulls, the actor, users without a
-- profile, the Surprise honoree of a still-hidden roll, and users who blocked the actor.
create function private.emit_activity(
  p_recipients uuid[],
  p_actor      uuid,
  p_crew       uuid,
  p_roll       uuid,
  p_photo      uuid,
  p_kind       public.activity_kind,
  p_payload    jsonb   default '{}'::jsonb,
  p_instant    boolean default true
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.activity_events (recipient_id, actor_id, crew_id, roll_id, photo_id, kind, payload, instant)
  select distinct u, p_actor, p_crew, p_roll, p_photo, p_kind,
         -- push copy keys (actor_name / crew_name / roll_name) are filled centrally; callers' keys win
         jsonb_strip_nulls(jsonb_build_object(
           'actor_name', (select pr.display_name from public.profiles pr where pr.id = p_actor),
           'crew_name',  (select c.name from public.crews c where c.id = p_crew),
           'roll_name',  (select r.name from public.rolls r where r.id = p_roll)
         )) || coalesce(p_payload, '{}'::jsonb),
         p_instant
  from unnest(p_recipients) as u
  where u is not null
    and u is distinct from p_actor
    and exists (select 1 from public.profiles pr where pr.id = u)
    and not exists (
      select 1 from public.rolls r
      where r.id = p_roll and r.surprise_honoree_id = u and now() < r.reveal_at
    )
    and not exists (
      select 1 from public.blocks b where b.blocker_id = u and b.blocked_id = p_actor
    );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Admin recipients of a crew (host/cohost) or of a roll (crew admins + the roll's creator).
create function private.admin_ids_for(p_crew uuid, p_roll uuid default null)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.u), '{}'::uuid[])
  from (
    select cm.user_id as u from public.crew_members cm
      where cm.crew_id = p_crew and cm.role in ('host', 'cohost')
    union
    select r.created_by from public.rolls r
      join public.crew_members cm on cm.crew_id = r.crew_id and cm.user_id = r.created_by
      where r.id = p_roll
  ) x
  where x.u is not null
$$;
