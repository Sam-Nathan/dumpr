-- Migration 15 · PostgREST upserts
--
-- PostgREST's `upsert` (Prefer: resolution=merge-duplicates) is `INSERT ... ON CONFLICT (pk) DO UPDATE SET
-- <every column in the payload> = excluded.<col>`. Postgres checks UPDATE privilege on every column in that SET
-- list, key columns included, so with the column-level UPDATE grants from migration 10 (kind / prefs only) every
-- client upsert failed with 42501. The direct-write tables need the key columns grantable for UPDATE:
--
--   reactions            (photo_id, user_id)   + kind (already)
--   message_reactions    (message_id, user_id) + kind (already)
--   notification_prefs   (user_id)             + the five pref columns (already)
--
-- This is safe because the UPDATE policies' WITH CHECK is evaluated on the NEW row, i.e. exactly like an insert:
--   * user_id must stay auth.uid() (a row can never be handed to someone else; USING pins the old row to me too),
--   * re-pointing photo_id / message_id is allowed only to a photo / message the caller can see, so it is
--     equivalent to deleting the row and inserting a fresh one (the insert policies demand the same).
-- reactions_update_own already enforces that; message_reactions_update_own did not check visibility or the guest
-- flag (the insert policy does), so it is tightened here. push_tokens keeps its narrow grants: clients register
-- through register_push_token(), which also handles a device moving between accounts.
-- ---------------------------------------------------------------------------------------------

grant update (photo_id, user_id) on public.reactions to authenticated;
grant update (message_id, user_id) on public.message_reactions to authenticated;
grant update (user_id) on public.notification_prefs to authenticated;

alter policy message_reactions_update_own on public.message_reactions
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and not (select private.is_guest())
    and exists (select 1 from public.messages m where m.id = message_reactions.message_id)
  );
