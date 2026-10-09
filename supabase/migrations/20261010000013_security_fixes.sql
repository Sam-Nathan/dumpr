-- 13 · Security review fixes (F1, F3-F7, F10, F12 b/c, plus the DB side of F2).
--
-- Migrations 01-12 are already applied in production and are never edited; every change lives here.
-- Functions are replaced with `create or replace` and IDENTICAL signatures (security definer,
-- set search_path = '', same return types); EXECUTE grants are re-asserted at the bottom (pattern of 10).
--
--   F1   profiles.avatar_key may only point at a/<own id>/<uuid>.jpg (constraint + cleanup); the purge
--        paths (profiles_after_delete, svc_enqueue_user_media) enqueue only keys under a/<that user>/.
--   F2   svc_upload_context also returns pending_count / pending_bytes (upload-init counts them toward the
--        quota and caps the number of unfinished uploads).
--   F3   invites die with their creator's authority: removing/leaving a crew revokes the member's invites,
--        demoting an admin revokes their crew-wide links, and join_core / invite_preview treat a link whose
--        creator no longer qualifies (see private.invite_creator_valid) as revoked.
--   F4   authors may soft-delete their own message but can no longer undo a deletion.
--   F5   when the last crew member disappears (account deleted, removed, left) the crew is soft-deleted
--        with the normal grace window and its invites are revoked; roll-only members are told.
--   F6   the hourly upload digest only carries ids of ready + 'everyone' photos, none for sealed rolls.
--   F7   roll-only members lose access to a crew once its purge window has passed (my_roll_ids).
--   F9   invite_preview of a revoked / expired / full link returns {status, kind, host:{display_name}} only;
--        a live preview only carries avatar keys that sit under the profile's own a/<id>/ prefix (F1).
--   F10  who_can_add = 'contacts' is enforced by invite_users; a block is reported as 'not_accepting'.
--   F12b reports about an admin (user target, or their photo / message) are neither visible to nor decidable
--        by that admin; they stay pending for the other admins.
--   F12c a denied join request cannot be re-submitted for 24 h (request_cooldown).

-- ---------------------------------------------------------------------------------------------
-- F1 · avatar_key confinement
-- ---------------------------------------------------------------------------------------------
-- Clean-up first. Nothing is queued for purge here: a key outside a/<own id>/ may belong to someone else.
update public.profiles p
   set avatar_key = null
 where p.avatar_key is not null
   and p.avatar_key !~ ('^a/' || p.id::text || '/[0-9a-fA-F-]{36}\.jpg$');

alter table public.profiles
  add constraint profiles_avatar_key_own
  check (avatar_key is null or avatar_key ~ ('^a/' || id::text || '/[0-9a-fA-F-]{36}\.jpg$'));

create or replace function private.profiles_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- defence in depth: only ever purge keys under the deleted user's own avatar prefix
  if old.avatar_key is not null and starts_with(old.avatar_key, 'a/' || old.id::text || '/') then
    perform private.enqueue_media(array[old.avatar_key]);
  end if;
  return null;
end;
$$;

create or replace function public.svc_enqueue_user_media(p_user uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.media_purge_queue (key)
  select distinct k from (
    select unnest(array[p.original_key, p.display_key, p.thumb_key]) as k
    from public.photos p where p.uploader_id = p_user
    union all
    select pr.avatar_key from public.profiles pr
     where pr.id = p_user and starts_with(pr.avatar_key, 'a/' || pr.id::text || '/')
  ) x
  where k is not null
  on conflict (key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- F2 · upload context: unfinished uploads count toward quota / rate limit
-- ---------------------------------------------------------------------------------------------
create or replace function public.svc_upload_context(p_user uuid, p_roll uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_roll    public.rolls;
  v_crew    public.crews;
  v_prof    public.profiles;
  v_cm      public.crew_members;
  v_rm      public.roll_members;
  v_live    boolean;
  v_guest_n integer := 0;
  v_guest_max integer := coalesce(private.setting_int('limits', 'guest_max_photos_per_roll')::integer, 300);
  v_pend_n  bigint;
  v_pend_b  bigint;
begin
  select * into v_roll from public.rolls r where r.id = p_roll;
  select * into v_prof from public.profiles pr where pr.id = p_user;
  select * into v_crew from public.crews c where c.id = v_roll.crew_id;
  select * into v_cm from public.crew_members cm where cm.crew_id = v_roll.crew_id and cm.user_id = p_user;
  select * into v_rm from public.roll_members rm where rm.roll_id = p_roll and rm.user_id = p_user;
  -- live = the roll exists and neither it nor its crew is (soft-)deleted
  v_live := v_roll.id is not null and v_roll.deleted_at is null and v_crew.deleted_at is null;
  if coalesce(v_prof.is_guest, false) and v_roll.id is not null then
    select count(*) into v_guest_n from public.photos p
     where p.roll_id = p_roll and p.uploader_id = p_user and p.status in ('pending', 'ready', 'review');
  end if;
  -- unfinished uploads of this user (all rolls): their bytes are not in storage_used_bytes yet
  select count(*), coalesce(sum(p.bytes), 0) into v_pend_n, v_pend_b
    from public.photos p where p.uploader_id = p_user and p.status = 'pending';
  return jsonb_build_object(
    'found', v_roll.id is not null and v_prof.id is not null,
    'can_upload', coalesce(private.can_upload_as(p_user, p_roll), false),
    'crew_id', case when v_live then v_roll.crew_id end,
    'roll_id', case when v_live then v_roll.id end,
    'is_member', v_live and (v_cm.user_id is not null or v_rm.user_id is not null)
                 and not coalesce(v_roll.surprise_honoree_id = p_user and now() < v_roll.reveal_at, false),
    'is_admin', v_live and v_cm.user_id is not null and (v_cm.role in ('host', 'cohost') or v_roll.created_by = p_user),
    'is_guest', coalesce(v_prof.is_guest, false),
    'crew_deleted', v_roll.id is not null and not v_live,
    'sealed', coalesce(private.roll_is_sealed(v_roll), false),
    'allow_uploads', coalesce(v_roll.allow_uploads, false),
    'guests_allowed', coalesce(v_roll.guests_allowed, false),
    'guest_uploads_review', coalesce(v_roll.guest_uploads_review, false),
    'guest_photo_count', v_guest_n,
    'guest_max_photos_per_roll', v_guest_max,
    'guest_max_photos', v_guest_max,
    'guest_limit_reached', coalesce(v_prof.is_guest, false) and v_guest_n >= v_guest_max,
    'storage_used_bytes', coalesce(v_prof.storage_used_bytes, 0),
    'storage_limit_bytes', coalesce(v_prof.storage_quota_bytes, private.setting_int('limits', 'storage_bytes_per_user')),
    'max_photo_bytes', coalesce(private.setting_int('limits', 'max_photo_bytes'), 52428800),
    'max_upload_parts', coalesce(private.setting_int('limits', 'max_upload_parts'), 100),
    'pending_count', v_pend_n,
    'pending_bytes', v_pend_b
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- F3 · invites follow their creator's authority
-- ---------------------------------------------------------------------------------------------
-- A link is only good while its creator could still create it: crew-wide links need an admin of the crew,
-- roll links a member of the crew or a roll member. A link whose creator deleted their account is dead.
create or replace function private.invite_creator_valid(p_inv public.invites)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_inv.created_by is not null and (
    case when p_inv.roll_id is null then
      exists (select 1 from public.crew_members cm
              where cm.crew_id = p_inv.crew_id and cm.user_id = p_inv.created_by and cm.role in ('host', 'cohost'))
    else
      exists (select 1 from public.crew_members cm
              where cm.crew_id = p_inv.crew_id and cm.user_id = p_inv.created_by)
      or exists (select 1 from public.roll_members rm
                 where rm.roll_id = p_inv.roll_id and rm.user_id = p_inv.created_by)
    end)
$$;

-- F3 + F5: runs for remove_member, leave_crew, decide_report(remove user) and account-deletion cascades
create or replace function private.crew_members_after_delete()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_grace integer := coalesce(private.setting_int('limits', 'deleted_crew_grace_days')::integer, 30);
  v_purge timestamptz;
  v_roll_only uuid[];
begin
  -- F3: whatever this person invited into the crew stops working
  update public.invites
     set revoked_at = now()
   where crew_id = old.crew_id and created_by = old.user_id and revoked_at is null;

  -- F5: the last member is gone -> soft-delete the crew like delete_crew / leave_crew do
  if not exists (select 1 from public.crew_members cm where cm.crew_id = old.crew_id) then
    update public.crews
       set deleted_at = now(), purge_after = now() + make_interval(days => v_grace)
     where id = old.crew_id and deleted_at is null
    returning purge_after into v_purge;
    if found then
      update public.invites set revoked_at = now() where crew_id = old.crew_id and revoked_at is null;
      select coalesce(array_agg(distinct rm.user_id), '{}'::uuid[]) into v_roll_only
        from public.roll_members rm
        join public.rolls r on r.id = rm.roll_id
       where r.crew_id = old.crew_id;
      perform private.emit_activity(v_roll_only, null, old.crew_id, null, null, 'crew_deleted',
                                    jsonb_build_object('purge_after', v_purge), true);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists crew_members_after_delete on public.crew_members;
create trigger crew_members_after_delete after delete on public.crew_members
  for each row execute function private.crew_members_after_delete();

-- demoted admins can no longer have crew-wide links
create or replace function private.crew_members_after_role_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.role = 'member' then
    update public.invites
       set revoked_at = now()
     where crew_id = new.crew_id and created_by = new.user_id and roll_id is null and revoked_at is null;
  end if;
  return null;
end;
$$;
drop trigger if exists crew_members_after_role_change on public.crew_members;
create trigger crew_members_after_role_change after update of role on public.crew_members
  for each row when (old.role is distinct from new.role)
  execute function private.crew_members_after_role_change();

-- creators only see their own links while they are still in the crew (admins see their crew's)
alter policy invites_select on public.invites
  using (
    (roll_id is null
       and ((created_by = (select auth.uid()) and crew_id = any ((select private.my_crew_ids())::uuid[]))
            or crew_id = any ((select private.my_admin_crew_ids())::uuid[])))
    or (roll_id = any ((select private.my_roll_ids())::uuid[])
       and (created_by = (select auth.uid()) or roll_id = any ((select private.my_admin_roll_ids())::uuid[])))
  );

-- F3 (revoked-by-authority) + F12c (re-request cooldown)
create or replace function private.join_core(p_user uuid, p_inv public.invites, p_guest boolean, p_mode text)
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
  if p_inv.revoked_at is not null or not private.invite_creator_valid(p_inv) then
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
    -- F12c: a denial stands for 24 h (no request spam)
    if exists (
      select 1 from public.join_requests jr
      where jr.user_id = p_user and jr.crew_id = p_inv.crew_id and jr.roll_id is not distinct from p_inv.roll_id
        and jr.status = 'denied' and jr.decided_at > now() - interval '24 hours'
    ) then
      raise exception using errcode = 'P0001', message = 'request_cooldown';
    end if;
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

-- F3 (creator authority => 'revoked') + F9 (dead links reveal only the status, kind and host's name)
create or replace function public.invite_preview(p_code text)
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
  v_creator_ok boolean;
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

  v_creator_ok := private.invite_creator_valid(v_inv);
  v_status := case
    when v_inv.revoked_at is not null or not v_creator_ok then 'revoked'
    when v_inv.expires_at <= now() then 'expired'
    when v_inv.max_uses is not null and v_inv.use_count >= v_inv.max_uses then 'full'
    else 'ok' end;

  -- the person who made the link (usually the host); falls back to the crew's oldest host
  select jsonb_build_object('display_name', p.display_name,
                            'avatar_key', case when starts_with(p.avatar_key, 'a/' || p.id::text || '/') then p.avatar_key end)
    into v_host
  from public.profiles p
  where p.id = coalesce(
    case when v_creator_ok then v_inv.created_by end,
    (select cm.user_id from public.crew_members cm where cm.crew_id = v_crew.id and cm.role = 'host' order by cm.joined_at limit 1));

  -- F9: a dead link must not describe the crew. The host's name stays ("Ask <host> for a new link").
  if v_status <> 'ok' then
    return jsonb_build_object(
      'status', v_status,
      'kind', case when v_inv.roll_id is null then 'crew' else 'roll' end,
      'host', jsonb_build_object('display_name', v_host ->> 'display_name'));
  end if;

  select count(*) into v_members from (
    select cm.user_id from public.crew_members cm where cm.crew_id = v_crew.id
    union
    select rm.user_id from public.roll_members rm where rm.roll_id = v_inv.roll_id
  ) m;

  select coalesce(jsonb_agg(jsonb_build_object(
           'display_name', f.display_name, 'avatar_key', f.avatar_key, 'ring_color', f.ring_color)), '[]'::jsonb)
    into v_face
  from (
    select p.display_name,
           case when starts_with(p.avatar_key, 'a/' || p.id::text || '/') then p.avatar_key end as avatar_key,
           p.ring_color
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
-- F10 · who_can_add = 'contacts' is enforced; blocks are not revealed
-- ---------------------------------------------------------------------------------------------
create or replace function public.invite_users(p_crew_id uuid, p_roll_id uuid, p_user_ids uuid[])
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
    -- a block looks exactly like "not accepting invites" (the blocker's choice is not revealed)
    elsif private.is_blocked_between(v_me, v_u) then v_reason := 'not_accepting';
    elsif v_prof.who_can_add = 'nobody' then v_reason := 'not_accepting';
    -- 'contacts' = someone who shares a crew / roll with the inviter
    elsif v_prof.who_can_add = 'contacts' and not private.shares_space(v_u) then v_reason := 'not_accepting';
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

-- ---------------------------------------------------------------------------------------------
-- F4 · authors cannot undo a moderator's removal
-- ---------------------------------------------------------------------------------------------
alter policy messages_update_author on public.messages
  using (author_id = (select auth.uid()) and deleted_at is null)
  with check (author_id = (select auth.uid()) and deleted_at is not null);

-- ---------------------------------------------------------------------------------------------
-- F6 · hourly digest: ids of publicly visible photos only
-- ---------------------------------------------------------------------------------------------
create or replace function private.fanout_upload_batches()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_b      public.upload_batches;
  v_roll   public.rolls;
  v_recips uuid[];
  v_sample uuid[];
  v_n      integer := 0;
begin
  for v_b in
    select * from public.upload_batches ub
    where ub.notified_at is null and ub.bucket_start < date_trunc('hour', now())
    order by ub.bucket_start
    for update skip locked
  loop
    select * into v_roll from public.rolls r where r.id = v_b.roll_id;
    if v_b.photo_count > 0 and v_roll.deleted_at is null
       and exists (select 1 from public.crews c where c.id = v_roll.crew_id and c.deleted_at is null) then
      select coalesce(array_agg(distinct m.u), '{}'::uuid[]) into v_recips
      from (
        select cm.user_id as u from public.crew_members cm where cm.crew_id = v_roll.crew_id and not cm.muted
        union
        select rm.user_id from public.roll_members rm where rm.roll_id = v_roll.id and not rm.muted
      ) m
      join public.profiles pr on pr.id = m.u and not pr.is_guest
      where m.u <> v_b.uploader_id;

      -- the digest reaches the whole crew: never name sealed rolls' photos, only_me / selected / review ones
      if private.roll_is_sealed(v_roll) then
        v_sample := '{}'::uuid[];
      else
        select coalesce(array_agg(s.id order by s.ord), '{}'::uuid[]) into v_sample
        from unnest(v_b.sample_photo_ids) with ordinality as s(id, ord)
        join public.photos p on p.id = s.id and p.status = 'ready' and p.visibility = 'everyone';
      end if;

      v_n := v_n + private.emit_activity(
        v_recips, v_b.uploader_id, v_roll.crew_id, v_roll.id, null, 'upload_batch',
        jsonb_build_object(
          'count', v_b.photo_count,
          'uploader_name', private.display_name_of(v_b.uploader_id),
          'roll_name', v_roll.name,
          'sample_photo_ids', to_jsonb(v_sample)),
        false);
    end if;
    update public.upload_batches
       set notified_at = now()
     where roll_id = v_b.roll_id and uploader_id = v_b.uploader_id and bucket_start = v_b.bucket_start;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- F7 · roll-only members stop reading once the crew's purge window has passed
-- ---------------------------------------------------------------------------------------------
create or replace function private.my_roll_ids()
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
      or (
        r.id in (select rm.roll_id from public.roll_members rm where rm.user_id = v_me)
        and exists (select 1 from public.crews c
                    where c.id = r.crew_id and (c.purge_after is null or c.purge_after > now()))
      )
    )
    and not coalesce(r.surprise_honoree_id = v_me and now() < r.reveal_at, false);
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- F12b · reports about an admin are not theirs to see or decide
-- ---------------------------------------------------------------------------------------------
-- The user a report is about: the reported user, the photo's uploader or the message's author.
create or replace function private.report_target_owner(p_target public.report_target, p_target_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_target
    when 'user'    then p_target_id
    when 'photo'   then (select p.uploader_id from public.photos p where p.id = p_target_id)
    when 'message' then (select m.author_id from public.messages m where m.id = p_target_id)
    else null
  end
$$;

alter policy reports_select on public.reports
  using (
    reporter_id = (select auth.uid())
    or (crew_id = any ((select private.my_admin_crew_ids())::uuid[])
        and private.report_target_owner(target, target_id) is distinct from (select auth.uid()))
  );

create or replace function public.decide_report(p_id uuid, p_action text)
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
  -- a report about you is decided by the other admins
  if private.report_target_owner(v_rep.target, v_rep.target_id) is not distinct from v_me then
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
-- Privileges (pattern of 10_grants_realtime): nothing new is callable by PUBLIC / anon / authenticated
-- unless listed below. create or replace keeps existing grants; they are re-asserted to be explicit.
-- ---------------------------------------------------------------------------------------------
revoke all on function
  private.profiles_after_delete(),
  public.svc_enqueue_user_media(uuid),
  public.svc_upload_context(uuid, uuid),
  private.invite_creator_valid(public.invites),
  private.crew_members_after_delete(),
  private.crew_members_after_role_change(),
  private.join_core(uuid, public.invites, boolean, text),
  public.invite_preview(text),
  public.invite_users(uuid, uuid, uuid[]),
  private.fanout_upload_batches(),
  private.my_roll_ids(),
  private.report_target_owner(public.report_target, uuid),
  public.decide_report(uuid, text)
from public, anon, authenticated;

grant execute on function
  private.profiles_after_delete(),
  public.svc_enqueue_user_media(uuid),
  public.svc_upload_context(uuid, uuid),
  private.invite_creator_valid(public.invites),
  private.crew_members_after_delete(),
  private.crew_members_after_role_change(),
  private.join_core(uuid, public.invites, boolean, text),
  public.invite_preview(text),
  public.invite_users(uuid, uuid, uuid[]),
  private.fanout_upload_batches(),
  private.my_roll_ids(),
  private.report_target_owner(public.report_target, uuid),
  public.decide_report(uuid, text)
to service_role;

grant execute on function public.invite_preview(text) to anon, authenticated;
grant execute on function
  public.invite_users(uuid, uuid, uuid[]),
  public.decide_report(uuid, text),
  private.my_roll_ids(),
  private.report_target_owner(public.report_target, uuid)
to authenticated;
