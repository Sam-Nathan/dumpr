-- Storage accounting is private to its owner: crewmates must not read each other's usage or quota.
-- Column-level SELECT replaces the table-level grant; owners read their own numbers via my_storage().
revoke select on public.profiles from authenticated;
grant select (
  id, display_name, handle, avatar_key, ring_color, birthday_day, birthday_month, is_guest,
  phone_visible, who_can_add, consent_stickers, consent_discovery, consent_then_now, created_at, updated_at
) on public.profiles to authenticated;
