-- 05 · Triggers (docs/architecture.md §6). All trigger functions are security definer with
-- search_path = '' so they can maintain counters and activity regardless of the writing role.
-- (Trigger functions need no EXECUTE grant to fire; 10_grants_realtime strips them from clients anyway.)

-- ---------------------------------------------------------------------------------------------
-- auth.users -> profiles
-- ---------------------------------------------------------------------------------------------
-- display_name from raw_user_meta_data.display_name / full_name / name, else 'Guest' (anonymous) or
-- 'New user'. On UPDATE the name is only re-applied when the metadata name actually changed, so a
-- name edited in the app is not clobbered by unrelated auth updates.
create function private.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_name text;
  v_old_name text;
  v_changed  boolean;
begin
  v_new_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
  );
  if tg_op = 'UPDATE' then
    v_old_name := coalesce(
      nullif(btrim(old.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(old.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(old.raw_user_meta_data ->> 'name'), '')
    );
  end if;
  v_changed := v_new_name is not null and (tg_op = 'INSERT' or v_new_name is distinct from v_old_name);

  insert into public.profiles (id, display_name, is_guest)
  values (
    new.id,
    left(coalesce(v_new_name, case when coalesce(new.is_anonymous, false) then 'Guest' else 'New user' end), 40),
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do update
    set is_guest     = excluded.is_guest,
        display_name = case when v_changed then excluded.display_name else public.profiles.display_name end;
  return new;
end;
$$;

create trigger on_auth_user_upsert_profile
  after insert or update of is_anonymous, raw_user_meta_data on auth.users
  for each row execute function private.handle_auth_user();

-- ---------------------------------------------------------------------------------------------
-- profiles: handle_taken, updated_at, avatar purge
-- ---------------------------------------------------------------------------------------------
create function private.profiles_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.handle is not null then
    new.handle := lower(new.handle);
    if tg_op = 'INSERT' or new.handle is distinct from old.handle then
      if exists (select 1 from public.profiles p where lower(p.handle) = new.handle and p.id <> new.id) then
        raise exception using errcode = 'P0001', message = 'handle_taken';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_before_write before insert or update on public.profiles
  for each row execute function private.profiles_before_write();

create function private.enqueue_media(p_keys text[])
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.media_purge_queue (key)
  select distinct k from unnest(p_keys) k where k is not null
  on conflict (key) do nothing
$$;

create function private.profiles_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.avatar_key is not null then
    perform private.enqueue_media(array[old.avatar_key]);
  end if;
  return null;
end;
$$;
create trigger profiles_after_delete after delete on public.profiles
  for each row execute function private.profiles_after_delete();

create trigger crews_touch before update on public.crews
  for each row execute function private.touch_updated_at();
create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- rolls: validate cover photo, updated_at
-- ---------------------------------------------------------------------------------------------
create function private.rolls_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.cover_photo_id is not null and new.cover_photo_id is distinct from old.cover_photo_id then
    if not exists (
      select 1 from public.photos p
      where p.id = new.cover_photo_id and p.roll_id = new.id and p.status = 'ready'
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
  end if;
  return new;
end;
$$;
create trigger rolls_before_update before update on public.rolls
  for each row execute function private.rolls_before_update();

-- ---------------------------------------------------------------------------------------------
-- tags: crew_id always follows the roll
-- ---------------------------------------------------------------------------------------------
create function private.tags_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crew uuid;
begin
  if new.roll_id is not null then
    select r.crew_id into v_crew from public.rolls r where r.id = new.roll_id;
    if v_crew is null then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
    new.crew_id := v_crew;
  end if;
  return new;
end;
$$;
create trigger tags_before_write before insert on public.tags
  for each row execute function private.tags_before_write();

-- ---------------------------------------------------------------------------------------------
-- photos: before write
-- ---------------------------------------------------------------------------------------------
create function private.photos_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crew uuid;
begin
  if tg_op = 'INSERT' and new.roll_id is not null then
    select r.crew_id into v_crew from public.rolls r where r.id = new.roll_id;
    if v_crew is null or v_crew <> new.crew_id then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
  end if;
  if new.chapter_id is not null and (tg_op = 'INSERT' or new.chapter_id is distinct from old.chapter_id) then
    if not exists (
      select 1 from public.tags t where t.id = new.chapter_id and t.roll_id is not distinct from new.roll_id
    ) then
      raise exception using errcode = 'P0001', message = 'invalid_input';
    end if;
  end if;
  new.sort_at    := coalesce(new.taken_at, new.created_at);
  new.updated_at := now();
  return new;
end;
$$;
create trigger photos_before_write before insert or update on public.photos
  for each row execute function private.photos_before_write();

-- ---------------------------------------------------------------------------------------------
-- photos: status transitions (ready / removed counters, upload_batches, guest_review)
-- ---------------------------------------------------------------------------------------------
create function private.photos_after_status()
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
  return null;
end;
$$;
create trigger photos_after_status after insert or update of status on public.photos
  for each row execute function private.photos_after_status();

-- hard delete (purge job, crew purge cascade, account deletion): free counters and queue the R2 objects
create function private.photos_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'ready' then
    update public.rolls set photo_count = greatest(photo_count - 1, 0) where id = old.roll_id;
    update public.profiles set storage_used_bytes = greatest(storage_used_bytes - old.bytes, 0) where id = old.uploader_id;
  end if;
  perform private.enqueue_media(array[old.original_key, old.display_key, old.thumb_key]);
  return null;
end;
$$;
create trigger photos_after_delete after delete on public.photos
  for each row execute function private.photos_after_delete();

-- ---------------------------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------------------------
create function private.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.crews c where c.id = new.crew_id and c.deleted_at is not null) then
    raise exception using errcode = 'P0001', message = 'crew_deleted';
  end if;
  if new.roll_id is not null and not exists (
    select 1 from public.rolls r where r.id = new.roll_id and r.crew_id = new.crew_id and r.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to_id and m.crew_id = new.crew_id and m.roll_id is not distinct from new.roll_id
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  return new;
end;
$$;
create trigger messages_before_insert before insert on public.messages
  for each row execute function private.messages_before_insert();

-- last_activity_at + @handle mentions (instant activity for mentioned members of the thread)
create function private.messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handles    text[];
  v_recipients uuid[];
begin
  update public.crews set last_activity_at = now() where id = new.crew_id;
  if new.roll_id is not null then
    update public.rolls set last_activity_at = now() where id = new.roll_id;
  end if;

  if new.body is not null and position('@' in new.body) > 0 then
    select coalesce(array_agg(distinct h), '{}'::text[]) into v_handles
    from (
      select rtrim(lower(m[1]), '.') as h
      from regexp_matches(new.body, '(?<![a-z0-9._])@([a-z0-9._]{3,24})', 'gi') as m
    ) x
    where char_length(h) >= 3;

    if cardinality(v_handles) > 0 then
      select coalesce(array_agg(pr.id), '{}'::uuid[]) into v_recipients
      from public.profiles pr
      where lower(pr.handle) = any (v_handles)
        and pr.id <> new.author_id
        and not pr.is_guest
        and (
          exists (select 1 from public.crew_members cm where cm.crew_id = new.crew_id and cm.user_id = pr.id)
          or (new.roll_id is not null and exists (
                select 1 from public.roll_members rm where rm.roll_id = new.roll_id and rm.user_id = pr.id))
        );
      perform private.emit_activity(
        v_recipients, new.author_id, new.crew_id, new.roll_id, new.photo_id, 'mention',
        jsonb_build_object('message_id', new.id, 'thread_key', new.thread_key,
                           'snippet', left(new.body, 80)),
        true);
    end if;
  end if;
  return null;
end;
$$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function private.messages_after_insert();

-- ---------------------------------------------------------------------------------------------
-- crew_members / roll_members -> `joined` (instant = false: shown in Activity, never pushed)
-- ---------------------------------------------------------------------------------------------
create function private.crew_members_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.emit_activity(
    private.admin_ids_for(new.crew_id), new.user_id, new.crew_id, null, null, 'joined',
    jsonb_build_object('user_id', new.user_id), false);
  return null;
end;
$$;
create trigger crew_members_after_insert after insert on public.crew_members
  for each row execute function private.crew_members_after_insert();

create function private.roll_members_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crew uuid;
begin
  select r.crew_id into v_crew from public.rolls r where r.id = new.roll_id;
  perform private.emit_activity(
    private.admin_ids_for(v_crew, new.roll_id), new.user_id, v_crew, new.roll_id, null, 'joined',
    jsonb_build_object('user_id', new.user_id, 'guest', new.role = 'guest'), false);
  return null;
end;
$$;
create trigger roll_members_after_insert after insert on public.roll_members
  for each row execute function private.roll_members_after_insert();
