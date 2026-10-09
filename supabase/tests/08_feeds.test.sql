-- Read-model RPCs: home_feed, crew_overview, roll_header, inbox_threads, my_storage, my_profile_stats.
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


create temp table t_feed (who text primary key, j jsonb) on commit drop;
grant all on t_feed to public;

-- alice's seeded messages (crew, R1, R3 threads) are unread for cara; memberships predate them
update public.crew_members set joined_at = now() - interval '1 day';
update public.roll_members set joined_at = now() - interval '1 day';
select tests.as_user('cara');
insert into t_feed select 'cara', public.home_feed();
select is((select jsonb_typeof(j -> 'live_rolls') || jsonb_typeof(j -> 'pending_invites') || jsonb_typeof(j -> 'crews') from t_feed),
  'arrayarrayarray', 'home_feed has live_rolls, pending_invites, crews');
select is((select jsonb_array_length(j -> 'crews') from t_feed), 1, 'one crew');
select is((select j #>> '{crews,0,name}' from t_feed), 'Goa gang', 'crew name');
select is((select j #>> '{crews,0,role}' from t_feed), 'member', 'my role');
select is((select (j #>> '{crews,0,member_count}')::int from t_feed), 5, 'member_count');
select is((select jsonb_array_length(j #> '{crews,0,facepile}') from t_feed), 5, 'facepile <= 5');
select is((select j #>> '{crews,0,facepile,4,id}' from t_feed), tests.u('cara')::text, 'facepile lists others before me');
select is((select (j #>> '{crews,0,unread_count}')::int from t_feed), 3, 'unread = crew + R1 + R3 messages from alice');
select is((select j #> '{crews,0,stack}' from t_feed), jsonb_build_array('t/' || tests.crew() || '/' || tests.roll(1) || '/' || tests.photo(1) || '.jpg'),
  'stack = newest public thumbs of open rolls only (no sealed / locked / only_me / selected)');
select is((select j #>> '{crews,0,live_roll,id}' from t_feed), tests.roll(1)::text, 'live_roll is the dated roll running today');
select ok((select (j -> 'live_rolls') @> jsonb_build_array(jsonb_build_object('id', tests.roll(1))) from t_feed), 'live_rolls includes R1');
select ok((select bool_and(coalesce(e ->> 'cover_thumb_key', '') not like '%' || tests.roll(2) || '%')
           from t_feed, jsonb_array_elements(j -> 'live_rolls') e), 'no sealed covers in live_rolls');

-- reading clears unread
select lives_ok(format('select public.mark_thread_read(%L)', 'c:' || tests.crew()), 'mark crew thread read');
select is((public.home_feed() #>> '{crews,0,unread_count}')::int, 2, 'unread drops after mark_thread_read');
select throws_ok($$select public.mark_thread_read('c:00000000-0000-0000-0000-000000000000')$$, 'P0001', 'not_a_member', 'cannot mark foreign threads');
select throws_ok($$select public.mark_thread_read('x:abc')$$, 'P0001', 'invalid_input', 'thread key validated');

-- crew_overview
select is(jsonb_array_length(public.crew_overview(tests.crew()) -> 'members'), 5, 'crew_overview members');
select is(public.crew_overview(tests.crew()) #>> '{members,0,role}', 'host', 'host listed first');
select is(jsonb_array_length(public.crew_overview(tests.crew()) -> 'rolls'), 4, 'crew_overview rolls');
select is((select e ->> 'cover_thumb_key' from jsonb_array_elements(public.crew_overview(tests.crew()) -> 'rolls') e
           where e ->> 'id' = tests.roll(2)::text), null, 'sealed roll has no cover thumb');
select is((select e ->> 'sealed' from jsonb_array_elements(public.crew_overview(tests.crew()) -> 'rolls') e
           where e ->> 'id' = tests.roll(4)::text), 'true', 'locked roll reported sealed');
select is(public.crew_overview(tests.crew()) #>> '{my,role}', 'member', 'my role');
select tests.as_user('ravi');
select throws_ok($$select public.crew_overview(tests.crew())$$, 'P0001', 'not_a_member', 'roll-only members get no crew overview');

-- roll_header
select tests.as_user('cara');
select is(public.roll_header(tests.roll(1)) #>> '{my,role}', 'member', 'roll_header my.role');
select is(public.roll_header(tests.roll(1)) #>> '{my,is_admin}', 'false', 'member is not admin');
select is(public.roll_header(tests.roll(1)) #>> '{my,can_upload}', 'true', 'member can upload');
select is((public.roll_header(tests.roll(1)) ->> 'photo_count')::int, 3, 'photo_count');
select is((public.roll_header(tests.roll(1)) ->> 'my_pending')::int, 1, 'my_pending counts my pending photo');
select is(jsonb_path_query_array(public.roll_header(tests.roll(1)) -> 'chapters', '$[*].name'), '["Beach", "Night"]'::jsonb, 'chapters in order');
select is(jsonb_array_length(public.roll_header(tests.roll(1)) -> 'contributors'), 1, 'contributors = uploaders of public ready photos');
select is(public.roll_header(tests.roll(2)) ->> 'sealed', 'true', 'sealed flag');
select is(public.roll_header(tests.roll(2)) -> 'contributors', '[]'::jsonb, 'sealed roll hides contributors');
select tests.as_user('alice');
select is(public.roll_header(tests.roll(1)) #>> '{my,is_admin}', 'true', 'host is admin');
select is((public.roll_header(tests.roll(1)) ->> 'review_count')::int, 1, 'admins see the review count');
select tests.as_user('gus');
select is(public.roll_header(tests.roll(1)) #>> '{my,role}', 'guest', 'guest role');
select is(public.roll_header(tests.roll(1)) #>> '{my,via}', 'roll', 'guest has roll-level access');

-- inbox_threads
select tests.as_user('cara');
select is((select count(*) from public.inbox_threads()), 5::bigint, 'crew thread + 4 roll threads');
select is((select last_message_body from public.inbox_threads() where thread_key = 'r:' || tests.roll(1)), 'roll hello', 'last message preview');
select is((select last_author_name from public.inbox_threads() where thread_key = 'r:' || tests.roll(1)), 'Alice', 'last author name');
select is((select unread_count from public.inbox_threads() where thread_key = 'r:' || tests.roll(1)), 1, 'unread per thread');
select is((select unread_count from public.inbox_threads() where thread_key = 'c:' || tests.crew()), 0, 'read thread has 0 unread');
select is((select tint::text from public.inbox_threads() where thread_key = 'c:' || tests.crew()), 'lime', 'tint');
select tests.as_user('hana');
select is((select count(*) from public.inbox_threads()), 4::bigint, 'honoree does not get the surprise thread');
select tests.as_user('ravi');
select is((select count(*) from public.inbox_threads()), 1::bigint, 'roll-only member gets only the roll thread');

-- storage + stats
select tests.as_user('cara');
select is(public.my_storage() ->> 'used_bytes', '3000', 'used_bytes');
select is(public.my_storage() -> 'limit_bytes', 'null'::jsonb, 'no plan limit yet');
select is(public.my_storage() #>> '{by_crew,0,bytes}', '3000', 'by_crew bytes');
select is(public.my_storage() #>> '{by_crew,0,name}', 'Goa gang', 'by_crew name');
select tests.as_super();
update public.profiles set storage_quota_bytes = 5000000 where id = tests.u('cara');
select tests.as_user('cara');
select is(public.my_storage() ->> 'limit_bytes', '5000000', 'per-user quota wins');
select is(public.my_profile_stats(), '{"rolls": 4, "crews": 1, "photos": 3}'::jsonb, 'my_profile_stats');

-- outsider
select tests.as_user('eve');
select is(public.home_feed(), '{"crews": [], "live_rolls": [], "pending_invites": []}'::jsonb, 'empty home_feed for a new user');
select is(public.my_storage() ->> 'used_bytes', '0', 'empty storage');

select tests.as_super();
select * from finish();
rollback;
