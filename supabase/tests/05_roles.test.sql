-- Roles: set_member_role / remove_member / leave / transfer_host / delete_crew and last_host protections.
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


create function tests.role_of(p_name text) returns text language sql stable security definer as $$
  select role::text from public.crew_members where crew_id = tests.crew() and user_id = tests.u(p_name)
$$;
grant execute on function tests.role_of(text) to public;

-- create_crew / create_roll
select tests.as_user('eve');
select is((public.create_crew('  Eve''s crew  ', 'sky')).name, 'Eve''s crew', 'create_crew trims the name');
select is((select role::text from public.crew_members cm join public.crews c on c.id = cm.crew_id
            where c.name = 'Eve''s crew' and cm.user_id = tests.u('eve')), 'host', 'creator becomes host');
select throws_ok($$select public.create_crew('')$$, 'P0001', 'invalid_input', 'empty crew name');
select throws_ok($$select public.create_roll(tests.crew(), 'Nope')$$, 'P0001', 'not_a_member', 'create_roll needs crew membership');

select tests.as_user('cara');
select is((public.create_roll(tests.crew(), 'Wedding', 'wedding', '2026-12-01', '2026-12-04', 'live',
                               array['Haldi', 'Mehendi', ' ', 'haldi', 'Sangeet'])).name, 'Wedding', 'member creates a roll');
select is((select array_agg(t.name order by t.sort) from public.tags t join public.rolls r on r.id = t.roll_id where r.name = 'Wedding'),
  array['Haldi', 'Mehendi', 'Sangeet'], 'chapters inserted in order, blanks and duplicates dropped');
select ok((select private.is_roll_admin(r.id) from public.rolls r where r.name = 'Wedding'), 'roll creator is roll admin');
select throws_ok($$select public.create_roll(tests.crew(), 'Bad', 'trip', '2026-12-04', '2026-12-01')$$, 'P0001', 'invalid_input', 'ends_on before starts_on');
select ok((public.create_roll(tests.crew(), 'Later', 'fest', '2026-12-01', '2026-12-02', 'next_morning')).reveal_at is not null,
  'non-live reveal mode sets reveal_at');
select throws_ok($$select public.update_crew(tests.crew(), 'Renamed')$$, 'P0001', 'not_admin', 'members cannot update the crew');

select tests.as_user('bob');
select is((public.update_crew(tests.crew(), 'Goa gang!', null, tests.photo(1))).name, 'Goa gang!', 'cohost updates the crew');
select throws_ok($$select public.update_crew(tests.crew(), null, null, tests.photo(2))$$, 'P0001', 'invalid_input',
  'cover must be a ready photo of the crew');

-- set_member_role: host only
select throws_ok($$select public.set_member_role(tests.crew(), tests.u('cara'), 'cohost')$$, 'P0001', 'not_admin', 'cohost cannot change roles');
select tests.as_user('alice');
select lives_ok($$select public.set_member_role(tests.crew(), tests.u('cara'), 'cohost')$$, 'host promotes cara to cohost');
select is(tests.role_of('cara'), 'cohost', 'cara is cohost');
select throws_ok($$select public.set_member_role(tests.crew(), tests.u('alice'), 'member')$$, 'P0001', 'last_host', 'cannot demote the last host');
select throws_ok($$select public.set_member_role(tests.crew(), tests.u('eve'), 'member')$$, 'P0001', 'not_a_member', 'target must be a member');

-- remove_member: cohost can't remove host; members can't remove
select tests.as_user('bob');
select throws_ok($$select public.remove_member(tests.crew(), tests.u('alice'))$$, 'P0001', 'not_admin', 'cohost cannot remove the host');
select tests.as_user('dan');
select throws_ok($$select public.remove_member(tests.crew(), tests.u('cara'))$$, 'P0001', 'not_admin', 'members cannot remove');
select tests.as_user('bob');
select lives_ok($$select public.remove_member(tests.crew(), tests.u('dan'))$$, 'cohost removes a member');
select is(tests.role_of('dan'), null, 'dan is gone');
select tests.as_user('dan');
select is((select kind::text from public.activity_events where kind = 'removed_from_crew'), 'removed_from_crew', 'removed member gets removed_from_crew');
select is((select count(*) from public.rolls), 0::bigint, 'removed member loses roll access');
select is((select count(*) from public.photos where uploader_id <> tests.u('dan')), 0::bigint, 'removed member keeps nothing of others');
select throws_ok($$select public.leave_crew(tests.crew())$$, 'P0001', 'not_a_member', 'cannot leave a crew you are not in');

-- leave / transfer
select tests.as_user('alice');
select throws_ok($$select public.leave_crew(tests.crew())$$, 'P0001', 'last_host', 'sole host with other members cannot leave');
select throws_ok($$select public.transfer_host(tests.crew(), tests.u('eve'))$$, 'P0001', 'not_a_member', 'transfer target must be a member');
select lives_ok($$select public.transfer_host(tests.crew(), tests.u('bob'))$$, 'host transfers to bob');
select is(tests.role_of('bob'), 'host', 'bob is host');
select is(tests.role_of('alice'), 'cohost', 'alice stays as cohost');
select lives_ok($$select public.leave_crew(tests.crew())$$, 'alice can leave now');
select is(tests.role_of('alice'), null, 'alice left');

-- leave_roll
select tests.as_user('ravi');
select lives_ok($$select public.leave_roll(tests.roll(1))$$, 'roll-only member leaves the roll');
select throws_ok($$select public.leave_roll(tests.roll(1))$$, 'P0001', 'not_a_member', 'leaving twice');
select tests.as_user('cara');
select throws_ok($$select public.leave_roll(tests.roll(1))$$, 'P0001', 'invalid_input', 'crew members leave the crew, not a roll');

-- host removes host only when another host remains
select tests.as_user('bob');
select lives_ok($$select public.set_member_role(tests.crew(), tests.u('cara'), 'host')$$, 'second host');
select lives_ok($$select public.remove_member(tests.crew(), tests.u('cara'))$$, 'host removes another host');
select throws_ok($$select public.remove_member(tests.crew(), tests.u('bob'))$$, 'P0001', 'last_host', 'cannot remove the last host');

-- delete_crew
select tests.as_user('hana');
select throws_ok($$select public.delete_crew(tests.crew())$$, 'P0001', 'not_admin', 'cohost cannot delete the crew');
select tests.as_user('bob');
select lives_ok($$select public.delete_crew(tests.crew())$$, 'host deletes the crew');
select tests.as_super();
select ok((select deleted_at is not null and purge_after > now() + interval '29 days' from public.crews where id = tests.crew()),
  'soft delete with a 30-day grace');
select is((select count(*) from public.activity_events where kind = 'crew_deleted'), 1::bigint, 'crew_deleted activity to the remaining member');
select tests.as_user('hana');
select is((select count(*) from public.crews), 1::bigint, 'members still see a deleted crew during the grace window');
select throws_ok($$select public.create_roll(tests.crew(), 'x')$$, 'P0001', 'crew_deleted', 'no new rolls in a deleted crew');
select throws_ok($$insert into public.messages (crew_id, author_id, client_id, body) values (tests.crew(), tests.u('hana'), gen_random_uuid(), 'hi')$$,
  'P0001', 'crew_deleted', 'no chat in a deleted crew');
select ok(not private.can_upload(tests.roll(1)), 'no uploads into a deleted crew');
select tests.as_user('bob');
select throws_ok($$select public.delete_crew(tests.crew())$$, 'P0001', 'crew_deleted', 'deleting twice');

-- last person out deletes the crew
select tests.as_user('eve');
select lives_ok($$select public.leave_crew((select id from public.crews where name = 'Eve''s crew'))$$, 'sole member leaves');
select tests.as_super();
select ok((select deleted_at is not null from public.crews where name = 'Eve''s crew'), 'empty crew is soft-deleted');

select tests.as_super();
select * from finish();
rollback;
