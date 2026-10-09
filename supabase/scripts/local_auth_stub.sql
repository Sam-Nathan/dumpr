-- Minimal stand-in for the parts of a Supabase database the Dumpr migrations rely on.
-- ONLY for running migrations + pgTAP tests on a bare PostgreSQL (CI without Docker).
-- Never apply this to a Supabase project: the real auth schema already exists there.
-- Storage is not stubbed: photos live in Cloudflare R2, not Supabase Storage.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists extensions;
create schema if not exists auth;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgtap with schema extensions;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  phone               text,
  is_anonymous        boolean not null default false,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Same semantics as Supabase's auth.jwt(): the full claims object of the current request.
create or replace function auth.jwt()
returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- Same semantics as Supabase's auth.uid(): the JWT "sub" claim.
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

-- Supabase Realtime's publication (empty on a fresh project); migrations add tables to it.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    set local client_min_messages = error;   -- plain PG warns about wal_level; irrelevant for tests
    create publication supabase_realtime;
  end if;
end;
$$;
