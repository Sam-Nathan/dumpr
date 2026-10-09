-- RLS privacy core (§4): membership, sealed / locked rolls, only_me, selected, removed, review, Surprise honoree.
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


create function tests.visible_photos() returns int[] language sql stable as $$
  select coalesce(array_agg(right(p.id::text, 2)::int order by p.id), '{}') from public.photos p
$$;
grant execute on function tests.visible_photos() to public;

-- outsider
select tests.as_user('eve');
select is(tests.visible_photos(), '{}'::int[], 'non-member sees no photos');
select is((select count(*) from public.rolls), 0::bigint, 'non-member sees no rolls');
select is((select count(*) from public.crews), 0::bigint, 'non-member sees no crews');
select is((select count(*) from public.crew_members), 0::bigint, 'non-member sees no crew members');
select is((select count(*) from public.messages), 0::bigint, 'non-member sees no messages');
select is((select count(*) from public.tags), 0::bigint, 'non-member sees no chapters');
select is((select count(*) from public.photo_reaction_counts), 0::bigint, 'non-member sees no reaction counts');
select is((select array_agg(id) from public.profiles), array[tests.u('eve')], 'non-member sees only their own profile');
select throws_ok('select public.roll_header(tests.roll(1))', 'P0001', 'not_a_member', 'roll_header refuses non-members');
select throws_ok('select public.crew_overview(tests.crew())', 'P0001', 'not_a_member', 'crew_overview refuses non-members');

-- member cara
select tests.as_user('cara');
select is(tests.visible_photos(), array[1, 3, 4, 6, 7, 10],
  'cara: ready+everyone, selected(audience), own removed/pending/sealed/locked; not only_me, review, others in sealed/surprise');
select is((select status::text from public.photos where id = tests.photo(4)), 'removed', 'uploader sees own removed row (F6)');
select is((select count(*) from public.rolls), 4::bigint, 'member sees all 4 rolls of the crew');
select is((select count(*) from public.messages), 3::bigint, 'member reads crew chat and roll chats');
select is((select count(*) from public.profiles), 7::bigint, 'member sees profiles of everyone sharing a crew or roll');
select is((select count(*) from public.photo_audience), 1::bigint, 'audience member sees their own audience row');

-- member dan
select tests.as_user('dan');
select is(tests.visible_photos(), array[1, 2, 3, 8], 'dan: P1 + own only_me/selected + own sealed photo; not cara''s sealed/locked ones');
select is((select count(*) from public.photo_audience), 1::bigint, 'uploader sees the audience of their photo');

-- host alice: review visible to admins; still not only_me / selected-not-audience / removed
select tests.as_user('alice');
select is(tests.visible_photos(), array[1, 5, 9], 'alice (host): P1, guest review P5, own surprise photo; not P2/P3/P4/P6/P7/P8/P10');

select tests.as_user('bob');
select ok(tests.photo(5) = any (select id from public.photos), 'cohost sees review photos');
select ok(not (tests.photo(3) = any (select id from public.photos)), 'selected photo hidden from non-audience admin');

-- sealed: opening the roll reveals others' photos
select tests.as_super();
update public.rolls set reveal_at = now() - interval '1 minute' where id = tests.roll(2);
select tests.as_user('dan');
select ok(tests.photo(7) = any (select id from public.photos), 'after reveal_at passes, others'' photos appear');
select tests.as_super();
update public.rolls set locked_until = now() - interval '1 minute' where id = tests.roll(4);
select tests.as_user('dan');
select ok(tests.photo(10) = any (select id from public.photos), 'after locked_until passes, time capsule opens');

-- roll-only member ravi
select tests.as_user('ravi');
select is((select array_agg(id) from public.rolls), array[tests.roll(1)], 'roll-only member sees only their roll');
select is((select array_agg(id) from public.crews), array[tests.crew()], 'roll-only member sees the crew row');
select is((select count(*) from public.crew_members), 0::bigint, 'roll-only member does not see the crew member list');
select is(tests.visible_photos(), array[1], 'roll-only member sees ready public photos of their roll');
select is((select count(*) from public.messages), 1::bigint, 'roll-only member reads only their roll chat');

-- guest gus
select tests.as_user('gus');
select is(tests.visible_photos(), array[1, 5], 'guest sees public photos + own review upload');
select is((select count(*) from public.messages), 0::bigint, 'guests read no chat');

-- Surprise honoree hana (a cohost, to prove admin rights don't leak the surprise)
select tests.as_super();
insert into public.invites (code, crew_id, roll_id, created_by) values ('surpr2se22', tests.crew(), tests.roll(3), tests.u('alice'));
insert into public.invites (code, crew_id, roll_id, created_by) values ('crewcdde22', tests.crew(), null, tests.u('alice'));
select tests.as_user('hana');
select ok(not (tests.roll(3) = any (select id from public.rolls)), 'honoree cannot see the surprise roll row');
select is((select count(*) from public.rolls), 3::bigint, 'honoree sees the other rolls');
select is((select count(*) from public.photos where roll_id = tests.roll(3)), 0::bigint, 'honoree sees none of its photos');
select is((select count(*) from public.messages where roll_id = tests.roll(3)), 0::bigint, 'honoree cannot read its chat');
select is((select count(*) from public.invites where roll_id = tests.roll(3)), 0::bigint, 'honoree (even as cohost) cannot see its invites');
select is((select count(*) from public.invites where roll_id is null), 1::bigint, 'cohost honoree still sees crew invites');
select is((select count(*) from public.tags where roll_id = tests.roll(3)), 0::bigint, 'honoree cannot see its chapters');
select ok(not private.is_roll_admin(tests.roll(3)), 'honoree is not an admin of the surprise roll');
select throws_ok('select public.roll_header(tests.roll(3))', 'P0001', 'not_a_member', 'roll_header hides the surprise roll');
select is(jsonb_array_length(public.crew_overview(tests.crew()) -> 'rolls'), 3, 'crew_overview omits the surprise roll for the honoree');
select is(public.invite_preview('surpr2se22') ->> 'status', 'not_found', 'invite_preview hides the surprise roll from the honoree');
select throws_ok('select public.join_via_invite(''surpr2se22'')', 'P0001', 'invite_not_found', 'honoree cannot join the surprise roll');
select throws_ok($$insert into public.messages (crew_id, roll_id, author_id, client_id, body)
                  values (tests.crew(), tests.roll(3), tests.u('hana'), gen_random_uuid(), 'hi')$$,
  '42501', null, 'honoree cannot post into the surprise roll chat');
select is((select count(*) from public.activity_events where roll_id = tests.roll(3)), 0::bigint, 'honoree has no activity about the surprise roll');

select tests.as_super();
select is(private.emit_activity(array[tests.u('hana'), tests.u('cara')], tests.u('alice'), tests.crew(), tests.roll(3), null, 'upload_batch'),
  1, 'activity for the surprise roll is never emitted to the honoree');
-- after the reveal the honoree gets everything
update public.rolls set reveal_at = now() - interval '1 minute' where id = tests.roll(3);
select tests.as_user('hana');
select ok(tests.roll(3) = any (select id from public.rolls), 'after the reveal the honoree sees the roll');
select ok(tests.photo(9) = any (select id from public.photos), 'after the reveal the honoree sees its photos');

-- push tokens / activity are own-row only
select tests.as_super();
insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[alice]', tests.u('alice'), 'ios');
select tests.as_user('cara');
select is((select count(*) from public.push_tokens), 0::bigint, 'push tokens are private');
select is((select count(*) from public.activity_events where recipient_id <> tests.u('cara')), 0::bigint, 'activity is recipient-only');
select throws_ok($$insert into public.push_tokens (token, user_id, platform) values ('tok-xyz-123', tests.u('alice'), 'ios')$$,
  '42501', null, 'cannot register a token for someone else');
select lives_ok($$insert into public.push_tokens (token, user_id, platform) values ('tok-cara-123', tests.u('cara'), 'android')$$,
  'can register own token directly');
select lives_ok($$select public.register_push_token('ExponentPushToken[alice]', 'android')$$, 'register_push_token re-owns a device token');
select tests.as_super();
select is((select user_id from public.push_tokens where token = 'ExponentPushToken[alice]'), tests.u('cara'), 'token now belongs to cara');

select tests.as_super();
select * from finish();
rollback;
