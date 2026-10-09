-- Guests (anonymous sign-ins, §2): roll invites with allow_guests only; no crews, no chat, no reactions.
begin;
select * from no_plan();

-- ---------------------------------------------------------------------------------------------
-- Shared scenario (identical in every test file; generated, rolled back at the end of the file)
--   Crew "Goa gang": alice host, bob cohost, hana cohost, cara + dan members
--   R1 "Goa '26"  live, open           | roll-only: ravi (member), gus (guest)
--   R2 "Sealed"   reveal_at = +1 day   | R3 "Surprise" honoree hana, reveal_at = +2 days
--   R4 "Capsule"  locked_until = +1 day
--   eve: outsider. Photos P1..P10 as listed below.
-- ---------------------------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to public;

create function tests.u(p_name text) returns uuid language sql immutable as $$
  select ('11111111-0000-0000-0000-0000000000' || lpad(v.n::text, 2, '0'))::uuid
  from (values ('alice', 1), ('bob', 2), ('cara', 3), ('dan', 4), ('eve', 5), ('gus', 6), ('hana', 7),
               ('ravi', 8), ('gina', 9), ('gabe', 10), ('ivan', 11), ('jill', 12), ('kim', 13)) v(name, n)
  where v.name = p_name
$$;
create function tests.crew() returns uuid language sql immutable as $$ select 'c0000000-0000-0000-0000-000000000001'::uuid $$;
create function tests.roll(p_n int) returns uuid language sql immutable as $$
  select ('b0000000-0000-0000-0000-00000000000' || p_n)::uuid $$;
create function tests.photo(p_n int) returns uuid language sql immutable as $$
  select ('d0000000-0000-0000-0000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;

-- impersonation (SET LOCAL lasts until the end of the test transaction)
create function tests.as_user(p_name text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', tests.u(p_name), 'role', 'authenticated',
                      'is_anonymous', (select u.is_anonymous from auth.users u where u.id = tests.u(p_name)))::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.as_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;
create function tests.as_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create function tests.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on all functions in schema tests to public;

-- photo factory (inserted as the table owner, like upload-init / upload-complete would)
create function tests.add_photo(p_n int, p_roll int, p_uploader text, p_status public.photo_status,
                                p_vis public.photo_visibility default 'everyone', p_bytes bigint default 1000)
returns uuid language sql as $$
  insert into public.photos (id, crew_id, roll_id, uploader_id, status, visibility, content_hash, mime, bytes,
                             original_key, display_key, thumb_key, width, height)
  values (tests.photo(p_n), tests.crew(), tests.roll(p_roll), tests.u(p_uploader), p_status, p_vis,
          'md5:' || md5(p_n::text), 'image/jpeg', p_bytes,
          'o/' || tests.crew() || '/' || tests.roll(p_roll) || '/' || tests.photo(p_n),
          'd/' || tests.crew() || '/' || tests.roll(p_roll) || '/' || tests.photo(p_n) || '.jpg',
          't/' || tests.crew() || '/' || tests.roll(p_roll) || '/' || tests.photo(p_n) || '.jpg', 4000, 3000)
  returning id
$$;

insert into auth.users (id, is_anonymous, raw_user_meta_data) values
  (tests.u('alice'), false, '{"display_name":"Alice"}'),
  (tests.u('bob'),   false, '{"display_name":"Bob"}'),
  (tests.u('cara'),  false, '{"display_name":"Cara"}'),
  (tests.u('dan'),   false, '{"display_name":"Dan"}'),
  (tests.u('eve'),   false, '{"display_name":"Eve"}'),
  (tests.u('gus'),   true,  '{"display_name":"Gus"}'),
  (tests.u('hana'),  false, '{"display_name":"Hana"}'),
  (tests.u('ravi'),  false, '{"display_name":"Ravi"}'),
  (tests.u('gina'),  true,  '{}'),
  (tests.u('gabe'),  true,  '{}'),
  (tests.u('ivan'),  false, '{"full_name":"Ivan"}'),
  (tests.u('jill'),  false, '{"name":"Jill"}'),
  (tests.u('kim'),   false, '{}');
update public.profiles p set handle = v.h
from (values ('alice'), ('bob'), ('cara'), ('dan'), ('eve'), ('hana'), ('ravi'), ('ivan'), ('jill'), ('kim')) v(h)
where p.id = tests.u(v.h);

insert into public.crews (id, name, tint, created_by) values (tests.crew(), 'Goa gang', 'lime', tests.u('alice'));
insert into public.crew_members (crew_id, user_id, role) values
  (tests.crew(), tests.u('alice'), 'host'),
  (tests.crew(), tests.u('bob'),   'cohost'),
  (tests.crew(), tests.u('hana'),  'cohost'),
  (tests.crew(), tests.u('cara'),  'member'),
  (tests.crew(), tests.u('dan'),   'member');

insert into public.rolls (id, crew_id, name, kind, created_by, starts_on, ends_on, reveal_at, locked_until, surprise_honoree_id) values
  (tests.roll(1), tests.crew(), 'Goa ''26',  'trip',  tests.u('alice'), current_date - 1, current_date + 1, null, null, null),
  (tests.roll(2), tests.crew(), 'Sealed',    'fest',  tests.u('bob'),   null, null, now() + interval '1 day', null, null),
  (tests.roll(3), tests.crew(), 'Surprise',  'other', tests.u('alice'), null, null, now() + interval '2 days', null, tests.u('hana')),
  (tests.roll(4), tests.crew(), 'Capsule',   'other', tests.u('alice'), null, null, null, now() + interval '1 day', null);
insert into public.tags (crew_id, roll_id, kind, name, sort) values
  (tests.crew(), tests.roll(1), 'chapter', 'Beach', 0),
  (tests.crew(), tests.roll(1), 'chapter', 'Night', 1);
insert into public.roll_members (roll_id, user_id, role) values
  (tests.roll(1), tests.u('ravi'), 'member'),
  (tests.roll(1), tests.u('gus'),  'guest');

select tests.add_photo(1,  1, 'cara', 'ready');                 -- P1  everyone, R1
select tests.add_photo(2,  1, 'dan',  'ready', 'only_me');      -- P2  only_me
select tests.add_photo(3,  1, 'dan',  'ready', 'selected');     -- P3  selected: cara
insert into public.photo_audience (photo_id, user_id) values (tests.photo(3), tests.u('cara'));
select tests.add_photo(4,  1, 'cara', 'removed');               -- P4  removed
select tests.add_photo(5,  1, 'gus',  'review');                -- P5  guest upload in review
select tests.add_photo(6,  1, 'cara', 'pending');               -- P6  pending
select tests.add_photo(7,  2, 'cara', 'ready');                 -- P7  sealed roll, cara's
select tests.add_photo(8,  2, 'dan',  'ready');                 -- P8  sealed roll, dan's
select tests.add_photo(9,  3, 'alice','ready');                 -- P9  surprise roll
select tests.add_photo(10, 4, 'cara', 'ready');                 -- P10 locked roll

insert into public.messages (crew_id, roll_id, author_id, client_id, body) values
  (tests.crew(), null,          tests.u('alice'), gen_random_uuid(), 'crew hello'),
  (tests.crew(), tests.roll(1), tests.u('alice'), gen_random_uuid(), 'roll hello'),
  (tests.crew(), tests.roll(3), tests.u('alice'), gen_random_uuid(), 'surprise plans');
-- ---------------------------------------------------------------------------------------------


select tests.as_user('alice');
create temp table t_codes (name text primary key, code text) on commit drop;
grant all on t_codes to public;
insert into t_codes values
  ('roll', public.create_invite(tests.crew(), tests.roll(1)) ->> 'code'),
  ('roll_noguests', public.create_invite(tests.crew(), tests.roll(1), null, false, false) ->> 'code'),
  ('crew', public.create_invite(tests.crew()) ->> 'code');

select is((select count(distinct code) from t_codes), 3::bigint, 'three distinct invites (different settings are not reused)');

select tests.as_user('gina');
select ok(private.is_guest(), 'is_guest() reads the is_anonymous JWT claim');
select is((select is_guest from public.profiles where id = tests.u('gina')), true, 'anonymous auth user -> profiles.is_guest');
select is((select display_name from public.profiles where id = tests.u('gina')), 'Guest', 'anonymous user without a name is "Guest"');
select is(public.invite_preview((select code from t_codes where name = 'roll')) ->> 'allow_guests', 'true', 'preview says guests may join');
select is(public.join_via_invite((select code from t_codes where name = 'roll')) ->> 'status', 'joined', 'guest joins a roll invite that allows guests');
select is((select role::text from public.roll_members where roll_id = tests.roll(1) and user_id = tests.u('gina')), 'guest',
  'guest becomes a roll_members guest');
select is(public.join_via_invite((select code from t_codes where name = 'roll')) ->> 'status', 'already_member', 'second join is already_member');
select ok(private.can_upload(tests.roll(1)), 'guest can upload to the roll');
select ok(tests.roll(1) = any (select id from public.rolls), 'guest can view the roll');
select throws_ok(format('select public.join_via_invite(%L)', (select code from t_codes where name = 'crew')),
  'P0001', 'guest_not_allowed', 'guest cannot join a crew invite');
select throws_ok($$select public.create_crew('Guest crew')$$, 'P0001', 'guest_not_allowed', 'guest cannot create a crew');
select throws_ok($$select public.create_roll(tests.crew(), 'x')$$, 'P0001', 'guest_not_allowed', 'guest cannot create a roll');
select throws_ok($$select public.create_invite(tests.crew(), tests.roll(1))$$, 'P0001', 'guest_not_allowed', 'guest cannot invite');
select throws_ok($$insert into public.messages (crew_id, roll_id, author_id, client_id, body)
                  values (tests.crew(), tests.roll(1), tests.u('gina'), gen_random_uuid(), 'hi')$$,
  '42501', null, 'guest cannot post in roll chat');
select throws_ok($$insert into public.reactions (photo_id, user_id, kind) values (tests.photo(1), tests.u('gina'), 'HEART')$$,
  '42501', null, 'guest cannot react');
select is((select count(*) from public.inbox_threads()), 0::bigint, 'guest has no chat threads');

select tests.as_user('gabe');
select throws_ok(format('select public.join_via_invite(%L)', (select code from t_codes where name = 'roll_noguests')),
  'P0001', 'guests_not_allowed', 'invite with allow_guests = false refuses guests');
select tests.as_super();
update public.rolls set guests_allowed = false where id = tests.roll(1);
select tests.as_user('gabe');
select throws_ok(format('select public.join_via_invite(%L)', (select code from t_codes where name = 'roll')),
  'P0001', 'guests_not_allowed', 'roll with guests_allowed = false refuses guests');
select is(public.invite_preview((select code from t_codes where name = 'roll')) ->> 'allow_guests', 'false', 'preview reflects guests_allowed = false');
select tests.as_user('gina');
select ok(not private.can_upload(tests.roll(1)), 'existing guests lose upload rights when guests are switched off');

-- host disables uploads: members blocked, admins still allowed
select tests.as_super();
update public.rolls set guests_allowed = true, allow_uploads = false where id = tests.roll(1);
select tests.as_user('cara');
select ok(not private.can_upload(tests.roll(1)), 'allow_uploads = false blocks members');
select tests.as_user('alice');
select ok(private.can_upload(tests.roll(1)), 'admins can always upload');

-- upgrade: linking a phone keeps the uid and flips is_guest
select tests.as_super();
update auth.users set is_anonymous = false, raw_user_meta_data = '{"display_name":"Gina"}' where id = tests.u('gina');
select is((select is_guest from public.profiles where id = tests.u('gina')), false, 'upgrading the guest flips profiles.is_guest');
select is((select display_name from public.profiles where id = tests.u('gina')), 'Gina', 'upgrade applies the new metadata name');
select is((select count(*) from public.roll_members where user_id = tests.u('gina')), 1::bigint, 'upgraded guest keeps the roll membership');

select tests.as_super();
select * from finish();
rollback;
