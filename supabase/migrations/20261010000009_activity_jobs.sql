-- 09 · Jobs (docs/architecture.md §7) + service-role-only RPCs used by the Edge Functions.
--
-- Scheduled jobs (pg_cron; skipped gracefully where pg_cron / pg_net / vault are missing, e.g. local tests):
--   dumpr-upload-digest   5 * * * *     select private.fanout_upload_batches()
--   dumpr-push-dispatch   * * * * *     select private.call_push_dispatch()          (POST .../push-dispatch)
--   dumpr-media-purge     */15 * * * *  select private.call_push_dispatch('?job=purge')
--   dumpr-purge-deleted   17 3 * * *    select private.purge_deleted()
--   dumpr-fire-reveals    */5 * * * *   select private.fire_reveals()                 (P2; no-op while every roll is live)
-- The x-cron-secret header is read from vault.decrypted_secrets (name 'cron_secret') at RUN time inside
-- private.call_push_dispatch(), so the secret never appears in cron.job.command.
--
-- Service-role-only wrappers (public schema so supabase-js .rpc() can reach them; EXECUTE revoked from
-- public/anon/authenticated in 10_grants_realtime):
--   svc_claim_push_batch(p_limit int)   -> setof (id bigint, recipient_id uuid, actor_id uuid, kind activity_kind,
--                                          crew_id uuid, roll_id uuid, photo_id uuid, payload jsonb, created_at timestamptz,
--                                          tokens text[], prefs jsonb, muted boolean)
--        LEASE: claims rows with pushed_at null, (instant OR kind = 'upload_batch'), created in the last 6 h, not
--        claimed in the last 2 minutes; sets push_claimed_at = now(). Rows the dispatcher does not mark come back
--        on a later run. prefs = notification_prefs row minus user_id/updated_at, or all-true defaults.
--        muted = recipient muted the crew (crew_members.muted) or the roll (roll_members.muted).
--   svc_mark_pushed(p_ids bigint[])     -> void   (call for EVERY processed id, including ones suppressed by prefs/mute)
--   svc_media_purge_claim(p_limit int)  -> setof text   (10-minute lease on media_purge_queue rows)
--   svc_media_purge_done(p_keys text[]) -> void   (deletes the queue rows)
--   svc_enqueue_user_media(p_user uuid) -> integer (queues original/display/thumb keys of all the user's photos +
--                                          avatar_key; returns rows newly queued)
--   svc_account_summary(p_user uuid)    -> {exists, sole_host_crews:[{id,name,member_count}], photo_keys_count,
--                                          photos_count, crews_count, storage_used_bytes}
--        sole_host_crews = live crews where the user is the only host AND other members exist.
--   svc_upload_context(p_user uuid, p_roll uuid)
--        -> {found, can_upload, crew_id|null, roll_id|null (null when the roll is missing or it / its crew is
--            deleted), is_member, is_admin, is_guest, crew_deleted, sealed, allow_uploads, guests_allowed,
--            guest_uploads_review, guest_photo_count (the guest's pending+ready+review photos in the roll),
--            guest_max_photos_per_roll (alias guest_max_photos), guest_limit_reached, storage_used_bytes,
--            storage_limit_bytes|null (null = unlimited), max_photo_bytes, max_upload_parts}
--        can_upload = private.can_upload_as() (access, not deleted, allow_uploads unless admin, guests_allowed for
--        guests); the guest photo cap and storage quota are left to the caller via the returned numbers.
--
-- activity_events.payload keys for push copy: actor_name / crew_name / roll_name are filled centrally by
-- private.emit_activity(); kind-specific keys: upload_batch {count, uploader_name, sample_photo_ids},
-- invite {code, direct_invite_id, kind}, reveal {count, contributors, mine}, mention {message_id, thread_key, snippet},
-- join_request {request_id, requester_name}, guest_review {count, uploader_name}, removal_request {request_id, status},
-- photo_removed {reason}, crew_deleted {purge_after}.

-- ---------------------------------------------------------------------------------------------
-- Hourly upload digest
-- ---------------------------------------------------------------------------------------------
create function private.fanout_upload_batches()
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

      v_n := v_n + private.emit_activity(
        v_recips, v_b.uploader_id, v_roll.crew_id, v_roll.id, null, 'upload_batch',
        jsonb_build_object(
          'count', v_b.photo_count,
          'uploader_name', private.display_name_of(v_b.uploader_id),
          'roll_name', v_roll.name,
          'sample_photo_ids', to_jsonb(v_b.sample_photo_ids)),
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
-- Reveal (P2): rolls whose reveal_at / locked_until passed in the last 2 days -> one `reveal` activity per
-- participant (deduplicated), including the Surprise honoree once the roll is theirs to see.
-- ---------------------------------------------------------------------------------------------
create function private.fire_reveals()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_roll    public.rolls;
  v_u       uuid;
  v_contrib integer;
  v_n       integer := 0;
begin
  for v_roll in
    select * from public.rolls r
    where r.deleted_at is null
      and (r.reveal_at is not null or r.locked_until is not null)
      and greatest(coalesce(r.reveal_at, '-infinity'::timestamptz), coalesce(r.locked_until, '-infinity'::timestamptz))
          between now() - interval '2 days' and now()
  loop
    select count(distinct p.uploader_id) into v_contrib
    from public.photos p where p.roll_id = v_roll.id and p.status = 'ready';

    for v_u in
      select m.u from (
        select cm.user_id as u from public.crew_members cm where cm.crew_id = v_roll.crew_id
        union
        select rm.user_id from public.roll_members rm where rm.roll_id = v_roll.id
      ) m
      where not exists (
        select 1 from public.activity_events ae
        where ae.kind = 'reveal' and ae.roll_id = v_roll.id and ae.recipient_id = m.u)
    loop
      v_n := v_n + private.emit_activity(
        array[v_u], null, v_roll.crew_id, v_roll.id, null, 'reveal',
        jsonb_build_object(
          'count', v_roll.photo_count,
          'contributors', v_contrib,
          'mine', (select count(*) from public.photos p
                   where p.roll_id = v_roll.id and p.uploader_id = v_u and p.status = 'ready')),
        true);
    end loop;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Daily purge: crews past purge_after (cascade; R2 keys are queued by the photo delete trigger),
-- removed photos after the 7-day undo grace, abandoned pending uploads, stale push rows, old activity.
-- ---------------------------------------------------------------------------------------------
create function private.purge_deleted()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_crews    integer;
  v_removed  integer;
  v_pending  integer;
  v_activity integer;
begin
  delete from public.crews c where c.purge_after is not null and c.purge_after <= now();
  get diagnostics v_crews = row_count;

  delete from public.photos p where p.status = 'removed' and p.removed_at < now() - interval '7 days';
  get diagnostics v_removed = row_count;

  delete from public.photos p where p.status = 'pending' and p.created_at < now() - interval '3 days';
  get diagnostics v_pending = row_count;

  update public.activity_events set pushed_at = now()
   where pushed_at is null and created_at < now() - interval '1 day';
  delete from public.activity_events where created_at < now() - interval '180 days';
  get diagnostics v_activity = row_count;

  delete from public.invites i
   where i.expires_at < now() - interval '90 days' or i.revoked_at < now() - interval '90 days';

  return jsonb_build_object('crews', v_crews, 'removed_photos', v_removed,
                            'abandoned_uploads', v_pending, 'activity', v_activity);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Push dispatch claim / mark
-- ---------------------------------------------------------------------------------------------
create function private.claim_push_batch(p_limit integer default 500)
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
       order by a.created_at, a.id
       limit greatest(1, least(coalesce(p_limit, 500), 1000))
       for update skip locked)
    returning ae.id, ae.recipient_id, ae.actor_id, ae.kind, ae.crew_id, ae.roll_id, ae.photo_id, ae.payload, ae.created_at
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
  order by c.created_at, c.id;
end;
$$;

create function private.mark_pushed(ids bigint[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.activity_events set pushed_at = now() where id = any (ids) and pushed_at is null
$$;

-- POST to the push-dispatch Edge Function (pg_net). The secret is read from Vault at call time.
create function private.call_push_dispatch(p_query text default '')
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
-- Service-role wrappers (documented at the top of this file)
-- ---------------------------------------------------------------------------------------------
create function public.svc_claim_push_batch(p_limit integer default 500)
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
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.claim_push_batch(p_limit)
$$;

create function public.svc_mark_pushed(p_ids bigint[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.mark_pushed(p_ids)
$$;

create function public.svc_media_purge_claim(p_limit integer default 500)
returns setof text
language sql
volatile
security definer
set search_path = ''
as $$
  update public.media_purge_queue q
     set claimed_at = now()
   where q.key in (
     select x.key from public.media_purge_queue x
     where x.claimed_at is null or x.claimed_at < now() - interval '10 minutes'
     order by x.enqueued_at, x.key
     limit greatest(1, least(coalesce(p_limit, 500), 1000))
     for update skip locked)
  returning q.key
$$;

create function public.svc_media_purge_done(p_keys text[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.media_purge_queue where key = any (p_keys)
$$;

create function public.svc_enqueue_user_media(p_user uuid)
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
    select pr.avatar_key from public.profiles pr where pr.id = p_user
  ) x
  where k is not null
  on conflict (key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create function public.svc_account_summary(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exists', exists (select 1 from public.profiles pr where pr.id = p_user),
    'sole_host_crews', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
                                          'member_count', (select count(*) from public.crew_members m where m.crew_id = c.id))
                       order by c.name, c.id)
      from public.crews c
      join public.crew_members me on me.crew_id = c.id and me.user_id = p_user and me.role = 'host'
      where c.deleted_at is null
        and not exists (select 1 from public.crew_members h
                        where h.crew_id = c.id and h.role = 'host' and h.user_id <> p_user)
        and exists (select 1 from public.crew_members o where o.crew_id = c.id and o.user_id <> p_user)
    ), '[]'::jsonb),
    'photo_keys_count', (select 3 * count(*) from public.photos p where p.uploader_id = p_user),
    'photos_count', (select count(*) from public.photos p where p.uploader_id = p_user and p.status = 'ready'),
    'crews_count', (select count(*) from public.crew_members m where m.user_id = p_user),
    'storage_used_bytes', coalesce((select pr.storage_used_bytes from public.profiles pr where pr.id = p_user), 0)
  )
$$;

create function public.svc_upload_context(p_user uuid, p_roll uuid)
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
    'max_upload_parts', coalesce(private.setting_int('limits', 'max_upload_parts'), 100)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Cron schedule (guarded: plain PostgreSQL without pg_cron / pg_net just skips this)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      create extension if not exists pg_net with schema extensions;
    exception when others then
      raise notice 'pg_net not installed: %', sqlerrm;
    end;
  end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron with schema pg_catalog;
    exception when others then
      raise notice 'pg_cron not installed: %', sqlerrm;
    end;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- cron.schedule(name, ...) upserts by job name, so re-running is safe
    execute format('select cron.schedule(%L, %L, %L)', 'dumpr-upload-digest', '5 * * * *',
                   'select private.fanout_upload_batches()');
    execute format('select cron.schedule(%L, %L, %L)', 'dumpr-push-dispatch', '* * * * *',
                   'select private.call_push_dispatch()');
    execute format('select cron.schedule(%L, %L, %L)', 'dumpr-media-purge', '*/15 * * * *',
                   'select private.call_push_dispatch(''?job=purge'')');
    execute format('select cron.schedule(%L, %L, %L)', 'dumpr-purge-deleted', '17 3 * * *',
                   'select private.purge_deleted()');
    execute format('select cron.schedule(%L, %L, %L)', 'dumpr-fire-reveals', '*/5 * * * *',
                   'select private.fire_reveals()');
  else
    raise notice 'pg_cron not available: Dumpr jobs not scheduled';
  end if;
end;
$$;
