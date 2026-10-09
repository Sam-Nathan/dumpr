-- 10 · Privileges (single source of truth) + Realtime publication.
--
-- Supabase gives anon/authenticated ALL on new public tables and EXECUTE on new functions by default,
-- and PostgreSQL gives PUBLIC EXECUTE on every function. Everything is revoked here and granted back
-- explicitly, per docs/architecture.md §3-§5.

-- ---------------------------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
revoke all on schema private from public, anon;
-- RLS policies (and the two security-invoker RPC wrappers) call private.* as the invoking role
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Tables: revoke everything from client roles, then grant per §3
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant select on public.app_settings to anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, handle, avatar_key, ring_color, birthday_day, birthday_month,
              phone_visible, who_can_add, consent_stickers, consent_discovery, consent_then_now)
  on public.profiles to authenticated;

grant select on public.crews to authenticated;
grant select on public.crew_members to authenticated;
grant update (muted) on public.crew_members to authenticated;

grant select on public.rolls to authenticated;
grant update (name, kind, cover_photo_id, starts_on, ends_on, location_name, reveal_mode, reveal_at,
              locked_until, allow_uploads, allow_downloads, allow_member_invites, guests_allowed,
              guest_uploads_review)
  on public.rolls to authenticated;

grant select on public.roll_members to authenticated;
grant update (muted) on public.roll_members to authenticated;

grant select, delete on public.tags to authenticated;
grant insert (crew_id, roll_id, kind, name, sort, day) on public.tags to authenticated;
grant update (name, sort, day) on public.tags to authenticated;

-- photos: no client insert/delete (upload-init / service role only)
grant select on public.photos to authenticated;
grant update (caption, chapter_id, visibility) on public.photos to authenticated;
grant select on public.photo_audience to authenticated;

grant select, delete on public.reactions to authenticated;
grant insert (photo_id, user_id, kind) on public.reactions to authenticated;
grant update (kind) on public.reactions to authenticated;
grant select on public.photo_reaction_counts to authenticated;

grant select on public.messages to authenticated;
grant insert (crew_id, roll_id, author_id, client_id, body, photo_id, reply_to_id, kind) on public.messages to authenticated;
grant update (deleted_at) on public.messages to authenticated;
grant select, delete on public.message_reactions to authenticated;
grant insert (message_id, user_id, kind) on public.message_reactions to authenticated;
grant update (kind) on public.message_reactions to authenticated;
grant select on public.thread_reads to authenticated;

grant select on public.invites to authenticated;
grant select on public.direct_invites to authenticated;
grant select on public.join_requests to authenticated;

grant select on public.reports to authenticated;
grant select on public.removal_requests to authenticated;
grant select, delete on public.blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;

grant select, delete on public.push_tokens to authenticated;
grant insert (token, user_id, platform, last_seen_at) on public.push_tokens to authenticated;
grant update (platform, last_seen_at) on public.push_tokens to authenticated;

grant select on public.notification_prefs to authenticated;
grant insert (user_id, invites, uploads, chats, reveals, games) on public.notification_prefs to authenticated;
grant update (invites, uploads, chats, reveals, games) on public.notification_prefs to authenticated;

grant select on public.activity_events to authenticated;
-- upload_batches, media_uploads, media_purge_queue: no client grants at all

-- ---------------------------------------------------------------------------------------------
-- Functions: strip EXECUTE from PUBLIC / anon / authenticated on everything we own in public + private,
-- then grant back.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;

-- anon + authenticated
grant execute on function public.check_handle(text) to anon, authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- authenticated RPCs (§5)
grant execute on function
  public.create_crew(text, public.crew_tint),
  public.create_roll(uuid, text, public.roll_kind, date, date, public.reveal_mode, text[]),
  public.update_crew(uuid, text, public.crew_tint, uuid),
  public.create_invite(uuid, uuid, integer, boolean, boolean, integer),
  public.revoke_invite(text),
  public.join_via_invite(text),
  public.decide_join_request(uuid, boolean),
  public.invite_users(uuid, uuid, uuid[]),
  public.respond_direct_invite(uuid, boolean),
  public.set_member_role(uuid, uuid, public.member_role),
  public.remove_member(uuid, uuid),
  public.leave_crew(uuid),
  public.leave_roll(uuid),
  public.transfer_host(uuid, uuid),
  public.delete_crew(uuid),
  public.set_photo_visibility(uuid, public.photo_visibility, uuid[]),
  public.remove_photo(uuid, text),
  public.request_photo_removal(uuid, text),
  public.decide_removal_request(uuid, boolean),
  public.review_guest_photos(uuid[], boolean),
  public.report(public.report_target, uuid, text),
  public.decide_report(uuid, text),
  public.mark_thread_read(text),
  public.mark_activity_read(bigint[]),
  public.register_push_token(text, text),
  public.home_feed(),
  public.crew_overview(uuid),
  public.roll_header(uuid),
  public.inbox_threads(),
  public.my_storage(),
  public.my_profile_stats()
to authenticated;

-- private helpers that run as the invoking role: RLS policies + the security-invoker wrappers
grant execute on function
  private.is_guest(),
  private.require_user(),
  private.require_non_guest(),
  private.my_crew_ids(),
  private.my_admin_crew_ids(),
  private.my_roll_ids(),
  private.my_open_roll_ids(),
  private.my_admin_roll_ids(),
  private.my_visible_crew_ids(),
  private.my_space_user_ids(),
  private.is_crew_admin(uuid),
  private.is_roll_admin(uuid),
  private.can_upload(uuid),
  private.shares_space(uuid),
  private.is_in_audience(uuid),
  private.request_photo_removal_impl(uuid, text),
  private.report_impl(public.report_target, uuid, text)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Realtime: postgres_changes on messages, activity_events, photos (RLS-filtered per subscriber)
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'activity_events', 'photos'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  else
    raise notice 'publication supabase_realtime not found: realtime tables not added';
  end if;
end;
$$;
