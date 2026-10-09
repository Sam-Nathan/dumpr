-- 01 · Extensions, private schema, enums, shared trigger helpers.
-- Contract: docs/architecture.md §3 (enums). Everything here is schema-only; no data.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Helper schema, never exposed by PostgREST (config.toml api.schemas = public, graphql_public).
-- Usage is granted back to authenticated/service_role in 10_grants_realtime: RLS policies call
-- the private.* helpers as the invoking role.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------------------------
-- Enums (§3)
-- ---------------------------------------------------------------------------------------------
create type public.member_role      as enum ('host', 'cohost', 'member');
create type public.roll_member_role as enum ('member', 'guest');
create type public.photo_status     as enum ('pending', 'ready', 'review', 'removed');
create type public.photo_visibility as enum ('everyone', 'selected', 'only_me');
create type public.photo_kind       as enum ('roll', 'snap');
create type public.reveal_mode      as enum ('live', 'end_of_event', 'next_morning');
create type public.roll_kind        as enum ('wedding', 'trip', 'fest', 'everyday', 'other');
create type public.reaction_kind    as enum ('ICONIC', 'LMAO', 'CRYING', 'HEART', 'SAME');
create type public.tag_kind         as enum ('chapter', 'lore');
create type public.crew_tint        as enum ('lilac', 'lime', 'sky', 'peach', 'pink', 'mint');
create type public.request_status   as enum ('pending', 'approved', 'denied');
create type public.report_target    as enum ('photo', 'message', 'user', 'crew', 'roll');
create type public.activity_kind    as enum (
  'invite', 'join_request', 'joined', 'upload_batch', 'reaction', 'mention', 'reveal',
  'removal_request', 'photo_removed', 'crew_deleted', 'removed_from_crew', 'guest_review'
);

-- ---------------------------------------------------------------------------------------------
-- Generic trigger: keep updated_at fresh.
-- ---------------------------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
