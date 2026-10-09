-- 04 · RLS policies (docs/architecture.md §3 per-table notes + §4).
-- Table privileges (what each role may even attempt) are in 10_grants_realtime; a policy only ever
-- narrows what a grant allows. Policies compare against the private.my_*_ids() arrays ONCE per
-- statement via `(select ...)`, never per-row function calls on big tables.
-- Tables with RLS enabled and NO policy here are closed to clients: upload_batches, media_uploads,
-- media_purge_queue.

-- ---------------------------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or id = any ((select private.my_space_user_ids())::uuid[]));

create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- app_settings (readable by everyone, writable by nobody through the API)
-- ---------------------------------------------------------------------------------------------
create policy app_settings_select on public.app_settings for select to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------------------------
-- crews / crew_members / rolls / roll_members
-- ---------------------------------------------------------------------------------------------
create policy crews_select on public.crews for select to authenticated
  using (id = any ((select private.my_visible_crew_ids())::uuid[]));

create policy crew_members_select on public.crew_members for select to authenticated
  using (crew_id = any ((select private.my_crew_ids())::uuid[]));

create policy crew_members_update_own_muted on public.crew_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy rolls_select on public.rolls for select to authenticated
  using (id = any ((select private.my_roll_ids())::uuid[]));

create policy rolls_update_admin on public.rolls for update to authenticated
  using (id = any ((select private.my_admin_roll_ids())::uuid[]))
  with check (id = any ((select private.my_admin_roll_ids())::uuid[]));

create policy roll_members_select on public.roll_members for select to authenticated
  using (roll_id = any ((select private.my_roll_ids())::uuid[]));

create policy roll_members_update_own_muted on public.roll_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- tags: see them if you can see the roll/crew; roll admins write them directly
-- ---------------------------------------------------------------------------------------------
create policy tags_select on public.tags for select to authenticated
  using (
    roll_id = any ((select private.my_roll_ids())::uuid[])
    or (roll_id is null and crew_id = any ((select private.my_crew_ids())::uuid[]))
  );

create policy tags_insert_admin on public.tags for insert to authenticated
  with check (roll_id = any ((select private.my_admin_roll_ids())::uuid[]));

create policy tags_update_admin on public.tags for update to authenticated
  using (roll_id = any ((select private.my_admin_roll_ids())::uuid[]))
  with check (roll_id = any ((select private.my_admin_roll_ids())::uuid[]));

create policy tags_delete_admin on public.tags for delete to authenticated
  using (roll_id = any ((select private.my_admin_roll_ids())::uuid[]));

-- ---------------------------------------------------------------------------------------------
-- photos: THE PRIVACY CORE
-- ---------------------------------------------------------------------------------------------
create policy photos_select on public.photos for select to authenticated
  using (
    uploader_id = (select auth.uid())
    or (
      status = 'ready'
      and roll_id = any ((select private.my_open_roll_ids())::uuid[])
      and (
        visibility = 'everyone'
        -- audience lookup goes through a definer function: photo_audience's own policy reads photos,
        -- so querying it from here under RLS would recurse
        or (visibility = 'selected' and private.is_in_audience(photos.id))
      )
    )
    or (status = 'review' and roll_id = any ((select private.my_admin_roll_ids())::uuid[]))
    or (kind = 'snap' and status = 'ready' and crew_id = any ((select private.my_crew_ids())::uuid[]))   -- P2
  );

-- Uploader edits caption / chapter_id / visibility (column grants); everything else is RPC / service role.
create policy photos_update_uploader on public.photos for update to authenticated
  using (uploader_id = (select auth.uid()))
  with check (uploader_id = (select auth.uid()));

-- photo_audience: the audience member sees their own row, the uploader sees the whole audience.
create policy photo_audience_select on public.photo_audience for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.photos p where p.id = photo_audience.photo_id and p.uploader_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------------------------
-- reactions: visible wherever the photo is visible; direct write of own row by non-guests
-- ---------------------------------------------------------------------------------------------
create policy reactions_select on public.reactions for select to authenticated
  using (exists (select 1 from public.photos p where p.id = reactions.photo_id));

create policy reactions_insert_own on public.reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and not (select private.is_guest())
    and exists (select 1 from public.photos p where p.id = reactions.photo_id)
  );

create policy reactions_update_own on public.reactions for update to authenticated
  using (user_id = (select auth.uid()) and not (select private.is_guest()))
  with check (user_id = (select auth.uid()) and not (select private.is_guest())
              and exists (select 1 from public.photos p where p.id = reactions.photo_id));

create policy reactions_delete_own on public.reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- messages: crew chat (roll_id null) or roll chat. Guests neither read nor write chat.
-- (the honoree of a hidden Surprise Roll is not in my_roll_ids(), so its chat is invisible to them)
-- ---------------------------------------------------------------------------------------------
create policy messages_select on public.messages for select to authenticated
  using (
    not (select private.is_guest())
    and (
      (roll_id is null and crew_id = any ((select private.my_crew_ids())::uuid[]))
      or roll_id = any ((select private.my_roll_ids())::uuid[])
    )
  );

create policy messages_insert on public.messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and not (select private.is_guest())
    and kind in ('text', 'photo')
    and (
      (roll_id is null and crew_id = any ((select private.my_crew_ids())::uuid[]))
      or (roll_id = any ((select private.my_roll_ids())::uuid[])
          and exists (select 1 from public.rolls r where r.id = messages.roll_id and r.crew_id = messages.crew_id))
    )
    and (
      photo_id is null
      or exists (select 1 from public.photos p where p.id = messages.photo_id and p.crew_id = messages.crew_id)
    )
  );

-- authors may soft-delete their own messages (deleted_at is the only granted column)
create policy messages_update_author on public.messages for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

create policy message_reactions_select on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_reactions.message_id));

create policy message_reactions_insert_own on public.message_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and not (select private.is_guest())
    and exists (select 1 from public.messages m where m.id = message_reactions.message_id)
  );

create policy message_reactions_update_own on public.message_reactions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy message_reactions_delete_own on public.message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy thread_reads_select_own on public.thread_reads for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- invites / direct_invites / join_requests (all writes through RPCs)
-- ---------------------------------------------------------------------------------------------
-- creators and admins only; the honoree of a hidden Surprise Roll sees none of that roll's invites.
create policy invites_select on public.invites for select to authenticated
  using (
    (roll_id is null
       and (created_by = (select auth.uid()) or crew_id = any ((select private.my_admin_crew_ids())::uuid[])))
    or (roll_id = any ((select private.my_roll_ids())::uuid[])
       and (created_by = (select auth.uid()) or roll_id = any ((select private.my_admin_roll_ids())::uuid[])))
  );

create policy direct_invites_select on public.direct_invites for select to authenticated
  using (
    invitee_id = (select auth.uid())
    or exists (select 1 from public.invites i where i.id = direct_invites.invite_id and i.created_by = (select auth.uid()))
  );

create policy join_requests_select on public.join_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or (roll_id is null and crew_id = any ((select private.my_admin_crew_ids())::uuid[]))
    or roll_id = any ((select private.my_admin_roll_ids())::uuid[])
  );

-- ---------------------------------------------------------------------------------------------
-- moderation
-- ---------------------------------------------------------------------------------------------
create policy reports_select on public.reports for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or crew_id = any ((select private.my_admin_crew_ids())::uuid[])
  );

create policy removal_requests_select on public.removal_requests for select to authenticated
  using (
    requester_id = (select auth.uid())
    or uploader_id = (select auth.uid())
    or roll_id = any ((select private.my_admin_roll_ids())::uuid[])
  );

create policy blocks_select_own on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy blocks_insert_own on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy blocks_delete_own on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------------------------
create policy push_tokens_select_own on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_tokens_insert_own on public.push_tokens for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy push_tokens_update_own on public.push_tokens for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy push_tokens_delete_own on public.push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

create policy notification_prefs_select_own on public.notification_prefs for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_prefs_insert_own on public.notification_prefs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy notification_prefs_update_own on public.notification_prefs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy activity_events_select_own on public.activity_events for select to authenticated
  using (recipient_id = (select auth.uid()));
