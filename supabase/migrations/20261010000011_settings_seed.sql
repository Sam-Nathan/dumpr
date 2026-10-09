-- 11 · app_settings defaults (docs/architecture.md §3 app_settings). Kept in a migration (not seed.sql)
-- so the hosted project gets them too. Existing values are never overwritten: the owner tunes them in SQL.
insert into public.app_settings (key, value)
values (
  'limits',
  '{"storage_bytes_per_user": null, "max_photo_bytes": 52428800, "invite_ttl_days": 7,
    "deleted_crew_grace_days": 30, "guest_max_photos_per_roll": 300, "max_upload_parts": 100}'::jsonb
)
on conflict (key) do nothing;
