-- 07 · RPCs: photo visibility, removal, moderation, read markers, push token (docs/architecture.md §5).
--
-- Note on request_photo_removal / report: "anyone who can see it" must be decided by the REAL photo /
-- message RLS policies, and a security definer function runs as the table owner (RLS bypassed). So
-- these two public functions are thin SECURITY INVOKER wrappers: they probe visibility as the caller
-- (RLS applies), then call a private security definer implementation. Same error codes, same results.

-- ---------------------------------------------------------------------------------------------
-- Internals
-- ---------------------------------------------------------------------------------------------
-- roll admin for roll photos, crew admin for crew snaps
create function private.can_moderate_photo(p_roll uuid, p_crew uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_roll is not null then private.is_roll_admin(p_roll) else private.is_crew_admin(p_crew) end
$$;

-- Marks a photo removed (counters/cover/storage follow from the status trigger) and tells the
-- uploader when somebody else removed it. Caller has authorised p_actor. Idempotent.
create function private.remove_photo_core(p_photo uuid, p_actor uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_p public.photos;
begin
  select * into v_p from public.photos p where p.id = p_photo for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_p.status = 'removed' then
    return;
  end if;
  update public.photos
     set status = 'removed', removed_at = now(), removed_by = p_actor, removed_reason = left(p_reason, 500)
   where id = p_photo;
  if v_p.uploader_id <> p_actor then
    perform private.emit_activity(array[v_p.uploader_id], p_actor, v_p.crew_id, v_p.roll_id, p_photo,
                                  'photo_removed', jsonb_build_object('reason', left(p_reason, 200)), true);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Visibility / removal
-- ---------------------------------------------------------------------------------------------
create function public.set_photo_visibility(
  p_photo_id   uuid,
  p_visibility public.photo_visibility,
  p_audience   uuid[] default '{}'
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.require_user();
  v_p   public.photos;
  v_aud uuid[];
begin
  if p_visibility is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select * into v_p from public.photos p where p.id = p_photo_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_p.uploader_id <> v_me then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  if v_p.status = 'removed' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if p_visibility = 'selected' then
    select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_aud
    from unnest(coalesce(p_audience, '{}'::uuid[])) x where x is not null and x <> v_me;
    if cardinality(v_aud) = 0 or cardinality(v_aud) > 500 then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    -- everyone in the audience must belong to the photo's space
    if exists (
      select 1 from unnest(v_aud) a
      where not exists (select 1 from public.crew_members cm where cm.crew_id = v_p.crew_id and cm.user_id = a)
        and not (v_p.roll_id is not null and exists (
              select 1 from public.roll_members rm where rm.roll_id = v_p.roll_id and rm.user_id = a))
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    delete from public.photo_audience where photo_id = p_photo_id and user_id <> all (v_aud);
    insert into public.photo_audience (photo_id, user_id)
    select p_photo_id, a from unnest(v_aud) a
    on conflict do nothing;
  else
    delete from public.photo_audience where photo_id = p_photo_id;
  end if;

  update public.photos set visibility = p_visibility where id = p_photo_id;
end;
$$;

create function public.remove_photo(p_photo_id uuid, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_user();
  v_p  public.photos;
begin
  if char_length(coalesce(p_reason, '')) > 500 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select * into v_p from public.photos p where p.id = p_photo_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_p.uploader_id <> v_me and not private.can_moderate_photo(v_p.roll_id, v_p.crew_id) then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  perform private.remove_photo_core(p_photo_id, v_me, p_reason);
end;
$$;

create function private.request_photo_removal_impl(p_photo_id uuid, p_reason text)
returns public.removal_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.require_user();
  v_p   public.photos;
  v_req public.removal_requests;
begin
  if char_length(coalesce(p_reason, '')) > 500 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select * into v_p from public.photos p where p.id = p_photo_id;
  if not found or v_p.status = 'removed' or v_p.uploader_id = v_me then
    raise exception using errcode = 'P0001', message = 'invalid_input';   -- uploaders just remove_photo()
  end if;
  select * into v_req from public.removal_requests r
   where r.photo_id = p_photo_id and r.requester_id = v_me and r.status = 'pending';
  if found then
    return v_req;
  end if;
  insert into public.removal_requests (photo_id, roll_id, uploader_id, requester_id, reason)
  values (p_photo_id, v_p.roll_id, v_p.uploader_id, v_me, p_reason)
  returning * into v_req;
  perform private.emit_activity(
    array[v_p.uploader_id] || private.admin_ids_for(v_p.crew_id, v_p.roll_id),
    v_me, v_p.crew_id, v_p.roll_id, p_photo_id, 'removal_request',
    jsonb_build_object('request_id', v_req.id, 'status', 'pending'), true);
  return v_req;
end;
$$;

create function public.request_photo_removal(p_photo_id uuid, p_reason text default null)
returns public.removal_requests
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform private.require_user();
  -- RLS decides: only photos the caller can actually see
  if not exists (select 1 from public.photos p where p.id = p_photo_id) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  return private.request_photo_removal_impl(p_photo_id, p_reason);
end;
$$;

create function public.decide_removal_request(p_id uuid, p_approve boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.require_user();
  v_req public.removal_requests;
  v_p   public.photos;
begin
  if p_approve is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select * into v_req from public.removal_requests r where r.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select * into v_p from public.photos p where p.id = v_req.photo_id;
  if v_p.uploader_id <> v_me and not private.can_moderate_photo(v_p.roll_id, v_p.crew_id) then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  if v_req.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if p_approve then
    perform private.remove_photo_core(v_req.photo_id, v_me, 'removal_request');
  end if;
  update public.removal_requests
     set status = case when p_approve then 'approved' else 'denied' end::public.request_status,
         decided_by = v_me, decided_at = now()
   where id = p_id;
  perform private.emit_activity(array[v_req.requester_id], v_me, v_p.crew_id, v_p.roll_id, v_req.photo_id,
    'removal_request',
    jsonb_build_object('request_id', p_id, 'status', case when p_approve then 'approved' else 'denied' end), false);
end;
$$;

-- guest uploads held for review: approve -> ready (counters via trigger), deny -> removed
create function public.review_guest_photos(p_photo_ids uuid[], p_approve boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_non_guest();
  v_p  public.photos;
begin
  if p_approve is null or p_photo_ids is null or cardinality(p_photo_ids) > 200 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  -- authorise everything first so a mixed batch changes nothing
  for v_p in select * from public.photos p where p.id = any (p_photo_ids) loop
    if not private.can_moderate_photo(v_p.roll_id, v_p.crew_id) then
      raise exception using errcode = 'P0001', message = 'not_admin';
    end if;
  end loop;
  for v_p in select * from public.photos p where p.id = any (p_photo_ids) and p.status = 'review' for update loop
    if p_approve then
      update public.photos set status = 'ready' where id = v_p.id;
    else
      perform private.remove_photo_core(v_p.id, v_me, 'guest_review');
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------------------------
create function private.report_impl(p_target public.report_target, p_target_id uuid, p_reason text)
returns public.reports
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.require_user();
  v_crew   uuid;
  v_report public.reports;
  v_owner  uuid;
begin
  if p_target is null or p_target_id is null or char_length(coalesce(p_reason, '')) > 500 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  case p_target
    when 'photo' then
      select p.crew_id, p.uploader_id into v_crew, v_owner from public.photos p where p.id = p_target_id;
    when 'message' then
      select m.crew_id, m.author_id into v_crew, v_owner from public.messages m where m.id = p_target_id;
    when 'user' then
      v_owner := p_target_id;
      if not exists (select 1 from public.profiles p where p.id = p_target_id) then
        raise exception using errcode = 'P0001', message = 'invalid_input';
      end if;
      if not private.shares_space(p_target_id) then
        raise exception using errcode = 'P0001', message = 'not_a_member';
      end if;
      select a.crew_id into v_crew
      from public.crew_members a
      join public.crew_members b on b.crew_id = a.crew_id and b.user_id = p_target_id
      where a.user_id = v_me
      order by a.joined_at limit 1;
    when 'crew' then
      if not (p_target_id = any (private.my_visible_crew_ids())) then
        raise exception using errcode = 'P0001', message = 'not_a_member';
      end if;
      v_crew := p_target_id;
    when 'roll' then
      if not (p_target_id = any (private.my_roll_ids())) then
        raise exception using errcode = 'P0001', message = 'not_a_member';
      end if;
      select r.crew_id into v_crew from public.rolls r where r.id = p_target_id;
  end case;

  if p_target in ('photo', 'message') and v_crew is null then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_owner = v_me then
    raise exception using errcode = 'P0001', message = 'invalid_input';   -- can't report yourself
  end if;

  select * into v_report from public.reports r
   where r.reporter_id = v_me and r.target = p_target and r.target_id = p_target_id and r.status = 'pending';
  if found then
    return v_report;
  end if;
  insert into public.reports (reporter_id, target, target_id, crew_id, reason)
  values (v_me, p_target, p_target_id, v_crew, p_reason)
  returning * into v_report;
  return v_report;
end;
$$;

create function public.report(p_target public.report_target, p_target_id uuid, p_reason text default null)
returns public.reports
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform private.require_user();
  -- photos and messages must be visible to the reporter under the real RLS policies
  if p_target = 'photo' and not exists (select 1 from public.photos p where p.id = p_target_id) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  if p_target = 'message' and not exists (select 1 from public.messages m where m.id = p_target_id) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  return private.report_impl(p_target, p_target_id, p_reason);
end;
$$;

-- crew admin decides: 'dismiss' or 'remove' (photo -> removed, message -> hidden, user -> removed from the
-- crew; crew/roll reports have nothing to remove and are simply closed as handled)
create function public.decide_report(p_id uuid, p_action text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.require_user();
  v_rep public.reports;
begin
  if p_action is null or p_action not in ('dismiss', 'remove') then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select * into v_rep from public.reports r where r.id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if v_rep.crew_id is null or not private.is_crew_admin(v_rep.crew_id) then
    raise exception using errcode = 'P0001', message = 'not_admin';
  end if;
  if v_rep.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if p_action = 'remove' then
    case v_rep.target
      when 'photo' then
        perform private.remove_photo_core(v_rep.target_id, v_me, 'report');
      when 'message' then
        update public.messages set deleted_at = coalesce(deleted_at, now()) where id = v_rep.target_id;
      when 'user' then
        if exists (select 1 from public.crew_members cm where cm.crew_id = v_rep.crew_id and cm.user_id = v_rep.target_id) then
          perform private.remove_member_core(v_me, v_rep.crew_id, v_rep.target_id);
        end if;
      else
        null;
    end case;
  end if;

  update public.reports
     set status = case when p_action = 'remove' then 'approved' else 'denied' end::public.request_status,
         decided_by = v_me, decided_at = now()
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Read markers
-- ---------------------------------------------------------------------------------------------
create function public.mark_thread_read(p_thread_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_user();
  v_id uuid;
begin
  if p_thread_key is null or p_thread_key !~ '^[cr]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  v_id := substr(p_thread_key, 3)::uuid;
  if left(p_thread_key, 1) = 'c' then
    if not (v_id = any (private.my_crew_ids())) then
      raise exception using errcode = 'P0001', message = 'not_a_member';
    end if;
  elsif not (v_id = any (private.my_roll_ids())) then
    raise exception using errcode = 'P0001', message = 'not_a_member';
  end if;
  insert into public.thread_reads (user_id, thread_key, last_read_at)
  values (v_me, p_thread_key, now())
  on conflict (user_id, thread_key) do update set last_read_at = excluded.last_read_at;
end;
$$;

create function public.mark_activity_read(p_ids bigint[] default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_user();
begin
  update public.activity_events ae
     set read_at = now()
   where ae.recipient_id = v_me
     and ae.read_at is null
     and (p_ids is null or ae.id = any (p_ids));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Push token registration. A device token can move between accounts on a shared phone; the direct
-- upsert grant can't re-own a row (RLS), so this RPC is the path clients use.
-- ---------------------------------------------------------------------------------------------
create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_user();
begin
  if p_token is null or char_length(p_token) not between 8 and 4096 or p_platform not in ('ios', 'android', 'web') then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  insert into public.push_tokens (token, user_id, platform, last_seen_at)
  values (p_token, v_me, p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
end;
$$;
