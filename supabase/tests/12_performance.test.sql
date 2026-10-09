-- Performance fixes (migration 14): keyset grid RPC parity with RLS, photos_by_ids, chat thread keys, digest row shape,
-- realtime broadcast, indexes and grants. Same scenario as the other files (generated, rolled back).
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

-- helpers: photo numbers (P<n>) seen through roll_photos() / through RLS, as the current role
create function tests.pn(p_ids uuid[]) returns int[] language sql immutable as $$
  select coalesce(array_agg(right(i::text, 2)::int order by o), '{}'::int[]) from unnest(p_ids) with ordinality t(i, o) $$;
-- null = not_a_member
create function tests.rp(p_roll int) returns int[] language plpgsql stable as $$
declare v uuid[];
begin
  select array_agg(id order by sort_at desc, id desc) into v from public.roll_photos(tests.roll(p_roll));
  return tests.pn(coalesce(v, '{}'::uuid[]));
exception when others then
  if sqlerrm = 'not_a_member' then return null; end if;
  raise;
end $$;
create function tests.rls(p_roll int) returns int[] language sql stable as $$
  select tests.pn(coalesce((select array_agg(id order by sort_at desc, id desc) from public.photos
                            where roll_id = tests.roll(p_roll) and status in ('ready', 'review')), '{}'::uuid[])) $$;
grant execute on all functions in schema tests to public;

-- ---------------------------------------------------------------------------------------------
-- roll_photos: same rows as the photos policy (ready + review), for every role in the scenario
-- ---------------------------------------------------------------------------------------------
select tests.as_user('alice');
select is(tests.rp(1), array[5, 1], 'host: roll_photos = open photos + the guest review row (P5, P1)');
select is(tests.rp(1), tests.rls(1), 'host: parity with RLS');
select is(tests.rp(2), tests.rls(2), 'host: sealed roll R2 parity (nothing of other people while sealed)');
select is(tests.rp(3), array[9], 'host: Surprise roll R3 shows own photo');
select is(tests.rp(3), tests.rls(3), 'host: R3 parity');
select is(tests.rp(4), tests.rls(4), 'host: locked roll parity');
select tests.as_user('bob');
select is(tests.rp(1), array[5, 1], 'cohost sees the review row too');
select is(tests.rp(1), tests.rls(1), 'cohost: parity');
select tests.as_user('cara');
select is(tests.rp(1), array[3, 1], 'member: everyone + selected-for-me (P3, P1); pending / removed never in the grid');
select is(tests.rp(1), tests.rls(1), 'member: parity');
select is(tests.rp(2), array[7], 'sealed roll: only my own photo');
select is(tests.rp(2), tests.rls(2), 'member: sealed parity');
select is(tests.rp(4), array[10], 'locked roll: only my own photo');
select tests.as_user('dan');
select is(tests.rp(1), array[3, 2, 1], 'uploader sees own only_me and selected photos');
select is(tests.rp(1), tests.rls(1), 'uploader: parity');
select is(tests.rp(2), array[8], 'dan: sealed roll own photo');
select tests.as_user('hana');
select is(tests.rp(3), null, 'Surprise honoree: not_a_member for the hidden roll');
select is(tests.rls(3), '{}'::int[], 'honoree: and RLS agrees');
select is(tests.rp(1), tests.rls(1), 'honoree: R1 parity');
select tests.as_user('ravi');
select is(tests.rp(1), array[1], 'roll-only member sees the open photos');
select is(tests.rp(1), tests.rls(1), 'roll-only member: parity');
select is(tests.rp(2), null, 'roll-only member: other rolls are not_a_member');
select tests.as_user('gus');
select is(tests.rp(1), array[5, 1], 'guest: open photos + their own review row');
select is(tests.rp(1), tests.rls(1), 'guest: parity');
select is(tests.rp(2), null, 'guest: other rolls are not_a_member');
select tests.as_user('eve');
select is(tests.rp(1), null, 'outsider: not_a_member');
select is(tests.rp(2), null, 'outsider: not_a_member (sealed)');
select tests.as_anon();
select throws_ok(format('select * from public.roll_photos(%L)', tests.roll(1)), '42501', null, 'anon cannot call roll_photos');
select tests.as_user('alice');
select throws_ok(format('select * from public.roll_photos(%L)', gen_random_uuid()), 'P0001', 'not_a_member', 'unknown roll: not_a_member');

-- selected audience changes are picked up, and a photo made only_me disappears
select tests.as_user('dan');
select lives_ok(format('select public.set_photo_visibility(%L, ''only_me'', null)', tests.photo(3)), 'dan hides P3');
select tests.as_user('cara');
select is(tests.rp(1), array[1], 'cara: P3 is gone from the grid');
select is(tests.rp(1), tests.rls(1), 'cara: parity after the change');

-- removal: removed photos leave everyone's grid, the uploader's too (status filter)
select tests.as_super();
select tests.add_photo(11, 1, 'cara', 'ready');
update public.photos set status = 'removed', removed_at = now() where id = tests.photo(11);
select tests.as_user('cara');
select is(tests.rp(1), array[1], 'removed photo is not in the grid');
select tests.as_user('ravi');
select is(tests.rp(1), array[1], 'removed photo is not in the roll-only grid either');

-- keyset paging + chapters
select tests.as_super();
insert into public.photos (id, crew_id, roll_id, uploader_id, status, visibility, content_hash, mime, bytes,
                           original_key, display_key, thumb_key, taken_at, chapter_id)
select ('d1000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, tests.crew(), tests.roll(1), tests.u('alice'),
       'ready', 'everyone', 'md5:k' || g, 'image/jpeg', 10, 'o/k' || g, 'd/k' || g, 't/k' || g,
       now() - make_interval(mins => g / 2),   -- pairs share a sort_at: ties are broken by id
       case when g % 2 = 0 then (select id from public.tags where roll_id = tests.roll(1) and name = 'Beach') end
from generate_series(1, 12) g;
select tests.as_user('ravi');
create temp table t_pages as
  with p1 as (select * from public.roll_photos(tests.roll(1), null, null, null, 5)),
       p2 as (select * from public.roll_photos(tests.roll(1), (select sort_at from p1 order by sort_at, id limit 1),
                                               (select id from p1 order by sort_at, id limit 1), null, 5)),
       p3 as (select * from public.roll_photos(tests.roll(1), (select sort_at from p2 order by sort_at, id limit 1),
                                               (select id from p2 order by sort_at, id limit 1), null, 5)),
       p4 as (select * from public.roll_photos(tests.roll(1), (select sort_at from p3 order by sort_at, id limit 1),
                                               (select id from p3 order by sort_at, id limit 1), null, 5))
  select 1 as pg, * from p1 union all select 2, * from p2 union all select 3, * from p3 union all select 4, * from p4;
select is((select count(*) from t_pages where pg = 1), 5::bigint, 'page 1 has the limit');
select is((select count(distinct id) from t_pages), (select count(*) from t_pages), 'keyset pages never overlap (ties on sort_at included)');
select is((select count(*) from t_pages), 13::bigint, 'pages together cover all 13 visible photos (12 + P1)');
select is((select array_agg(id order by pg, sort_at desc, id desc) from t_pages), (select array_agg(id order by sort_at desc, id desc) from t_pages),
  'pages come in global (sort_at desc, id desc) order');
select is((select count(*) from public.roll_photos(tests.roll(1), null, null, (select id from public.tags where roll_id = tests.roll(1) and name = 'Beach'), 50)),
  6::bigint, 'chapter filter');
select is((select count(*) from public.roll_photos(tests.roll(1), null, null, null, 0)), 1::bigint, 'limit is clamped to >= 1');
select is((select count(*) from public.roll_photos(tests.roll(1), null, null, null, 100000)), 13::bigint, 'limit is clamped to 200');
select is((select count(*) from public.roll_photos(tests.roll(1), null, null, null, null)), 13::bigint, 'null limit = default 60');

-- crew past its purge window: a roll-only member loses the grid like every other read (F7)
select tests.as_super();
update public.crews set purge_after = now() - interval '1 hour' where id = tests.crew();
select tests.as_user('ravi');
select is(tests.rp(1), null, 'F7: roll-only member: not_a_member once the crew is past purge_after');
select tests.as_user('alice');
select is(tests.rp(1), null, 'F7: crew members too');
select tests.as_super();
update public.crews set purge_after = null where id = tests.crew();

-- ---------------------------------------------------------------------------------------------
-- photos_by_ids: security invoker, same rows as the photos policy
-- ---------------------------------------------------------------------------------------------
create temp table t_all as select array_agg(tests.photo(g)) as ids from generate_series(1, 11) g;
grant select on t_all to public;
select tests.as_user('cara');
select is((select array_agg(id order by id) from public.photos_by_ids((select ids from t_all))),
          (select array_agg(id order by id) from public.photos where id = any ((select ids from t_all)::uuid[])),
  'photos_by_ids = RLS photos (cara)');
select is((select is_uploader from public.photos_by_ids(array[tests.photo(1)])), true, 'cara uploaded P1');
select is((select is_uploader from public.photos_by_ids(array[tests.photo(2)])), null, 'dan''s only_me P2 is simply absent');
select is((select is_admin from public.photos_by_ids(array[tests.photo(1)])), false, 'cara is no admin');
select is((select roll_name from public.photos_by_ids(array[tests.photo(1)])), 'Goa ''26', 'roll name');
select is((select allow_downloads from public.photos_by_ids(array[tests.photo(1)])), true, 'allow_downloads');
select is((select roll_visible from public.photos_by_ids(array[tests.photo(1)])), true, 'roll_visible');
select is((select status::text from public.photos_by_ids(array[tests.photo(6)])), 'pending', 'own pending photo comes back (media-sign decides)');
select is((select count(*) from public.photos_by_ids(array[tests.photo(8)])), 0::bigint, 'sealed roll photo of someone else: absent');
select tests.as_user('alice');
select is((select is_admin from public.photos_by_ids(array[tests.photo(1)])), true, 'host is admin');
select is((select array_agg(id order by id) from public.photos_by_ids((select ids from t_all))),
          (select array_agg(id order by id) from public.photos where id = any ((select ids from t_all)::uuid[])),
  'photos_by_ids = RLS photos (host incl. review rows)');
select tests.as_user('bob');
select is((select is_admin from public.photos_by_ids(array[tests.photo(1)])), true, 'cohost is admin');
select tests.as_user('gus');
select is((select array_agg(id order by id) from public.photos_by_ids((select ids from t_all))),
          (select array_agg(id order by id) from public.photos where id = any ((select ids from t_all)::uuid[])),
  'photos_by_ids = RLS photos (guest)');
select tests.as_user('eve');
select is((select count(*) from public.photos_by_ids((select ids from t_all))), 0::bigint, 'outsider gets nothing');
select throws_ok('select * from public.photos_by_ids((select array_agg(gen_random_uuid()) from generate_series(1, 501)))', 'P0001', 'invalid_input', 'more than 500 ids rejected');
select is((select count(*) from public.photos_by_ids('{}'::uuid[])), 0::bigint, 'empty list');
select tests.as_anon();
select throws_ok(format('select * from public.photos_by_ids(array[%L]::uuid[])', tests.photo(1)), '42501', null, 'anon cannot call photos_by_ids');

-- ---------------------------------------------------------------------------------------------
-- my_thread_keys / chat policy
-- ---------------------------------------------------------------------------------------------
select tests.as_user('alice');
select is((select array_agg(k order by k) from unnest(private.my_thread_keys()) k),
          array['c:' || tests.crew(), 'r:' || tests.roll(1), 'r:' || tests.roll(2), 'r:' || tests.roll(3), 'r:' || tests.roll(4)]
          ::text[] , 'alice: crew + every roll thread');
select is((select count(*) from public.messages), 3::bigint, 'alice reads all three messages');
select tests.as_user('hana');
select is((select array_agg(k order by k) from unnest(private.my_thread_keys()) k),
          array['c:' || tests.crew(), 'r:' || tests.roll(1), 'r:' || tests.roll(2), 'r:' || tests.roll(4)]::text[],
  'honoree: no thread of the hidden Surprise roll');
select is((select count(*) from public.messages), 2::bigint, 'honoree reads crew + R1 chat only');
select tests.as_user('ravi');
select is(private.my_thread_keys(), array['r:' || tests.roll(1)]::text[], 'roll-only member: just the roll thread');
select is((select count(*) from public.messages), 1::bigint, 'roll-only member reads the roll chat only');
select tests.as_user('gus');
select is(private.my_thread_keys(), '{}'::text[], 'guest: no threads');
select is((select count(*) from public.messages), 0::bigint, 'guest reads no chat');
select tests.as_user('eve');
select is(private.my_thread_keys(), '{}'::text[], 'outsider: no threads');
select is((select count(*) from public.messages), 0::bigint, 'outsider reads no chat');
select tests.as_anon();
select throws_ok('select private.my_thread_keys()', '42501', null, 'anon cannot call my_thread_keys');
select tests.as_super();
update public.crews set purge_after = now() - interval '1 hour' where id = tests.crew();
select tests.as_user('ravi');
select is(private.my_thread_keys(), '{}'::text[], 'F7: roll-only member loses the thread after the purge window');
select tests.as_super();
update public.crews set purge_after = null where id = tests.crew();

-- ---------------------------------------------------------------------------------------------
-- photo_audience.uploader_id
-- ---------------------------------------------------------------------------------------------
insert into public.photo_audience (photo_id, user_id) values (tests.photo(1), tests.u('ravi'));
select is((select uploader_id from public.photo_audience where photo_id = tests.photo(1)), tests.u('cara'), 'photo_audience.uploader_id mirrors the photo uploader (filled by the trigger)');
delete from public.photo_audience where photo_id = tests.photo(1);
select tests.as_user('dan');
select lives_ok(format('select public.set_photo_visibility(%L, ''selected'', array[%L]::uuid[])', tests.photo(2), tests.u('cara')), 'dan picks an audience');
select is((select uploader_id from public.photo_audience where photo_id = tests.photo(2)), tests.u('dan'), 'RPC-inserted audience rows carry the uploader');
select is((select count(*) from public.photo_audience), 1::bigint, 'uploader sees the audience of their photo');
select tests.as_user('cara');
select is((select count(*) from public.photo_audience), 1::bigint, 'audience member sees their own row');
select is(tests.rp(1), tests.rls(1), 'selected audience: roll_photos agrees with RLS');
select tests.as_user('alice');
select is((select count(*) from public.photo_audience), 0::bigint, 'a third party sees no audience rows');
select throws_ok(format('insert into public.photo_audience (photo_id, user_id) values (%L, %L)', tests.photo(1), tests.u('alice')), '42501', null, 'clients cannot write photo_audience');

-- ---------------------------------------------------------------------------------------------
-- Digest: one row per (recipient, roll, closed hour)
-- ---------------------------------------------------------------------------------------------
select tests.as_super();
delete from public.activity_events;
delete from public.upload_batches;
update public.crew_members set muted = false;
insert into public.blocks (blocker_id, blocked_id) values (tests.u('bob'), tests.u('dan'));
update public.photos set visibility = 'everyone' where id in (tests.photo(2), tests.photo(3));
insert into public.upload_batches (roll_id, uploader_id, bucket_start, photo_count, sample_photo_ids) values
  (tests.roll(1), tests.u('cara'), date_trunc('hour', now()) - interval '1 hour', 3, array[tests.photo(1)]),
  (tests.roll(1), tests.u('dan'),  date_trunc('hour', now()) - interval '1 hour', 5, array[tests.photo(2), tests.photo(5)]),
  (tests.roll(1), tests.u('dan'),  date_trunc('hour', now()) - interval '3 hours', 2, array[tests.photo(3)]),
  (tests.roll(3), tests.u('alice'), date_trunc('hour', now()) - interval '1 hour', 4, array[tests.photo(9)]),
  (tests.roll(1), tests.u('cara'), date_trunc('hour', now()), 9, array[tests.photo(1)]);   -- still open
select is(private.fanout_upload_batches(), 13, 'rows: R1 last hour (alice, bob, cara, dan, hana, ravi) + R1 three hours ago (alice, cara, hana, ravi) + R3 (bob, cara, dan)');
select is((select count(*) from public.activity_events where kind = 'upload_batch' and roll_id = tests.roll(1)), 10::bigint, 'R1: one row per recipient and closed hour');
select is((select count(*) from public.activity_events where kind = 'upload_batch' and roll_id = tests.roll(3)), 3::bigint, 'R3: bob, cara, dan (not the uploader alice, not the honoree hana)');
select is((select count(*) from public.upload_batches where notified_at is null), 1::bigint, 'only the open hour stays un-notified');
select is((select array_agg((payload ->> 'count')::int order by (payload ->> 'count')::int desc) from public.activity_events
            where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1)), array[8, 2], 'alice: one row per closed hour (cara 3 + dan 5, then dan 2)');
select is((select payload ->> 'uploaders' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1)
            and (payload ->> 'count')::int = 8), '2', 'uploaders = 2');
select is((select payload ->> 'uploader_name' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1)
            and (payload ->> 'count')::int = 8), 'Dan', 'top uploader named');
select is((select actor_id from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1)
            and (payload ->> 'count')::int = 8), tests.u('dan'), 'actor_id = top uploader');
select is((select payload ->> 'actor_name' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1)
            and (payload ->> 'count')::int = 8), 'Dan', 'actor_name');
select is((select payload ->> 'crew_name' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1) limit 1), 'Goa gang', 'crew_name');
select is((select payload ->> 'roll_name' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1) limit 1), 'Goa ''26', 'roll_name');
select is((select payload -> 'sample_photo_ids' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1)
            and (payload ->> 'count')::int = 8), jsonb_build_array(tests.photo(2), tests.photo(1)),
  'F6: samples are ready + everyone photos only (P5 is a review row), biggest uploader first');
select is((select array_agg((payload ->> 'count')::int order by (payload ->> 'count')::int desc) from public.activity_events
            where kind = 'upload_batch' and recipient_id = tests.u('cara') and roll_id = tests.roll(1)), array[5, 2], 'cara: her own 3 uploads are not counted, only dan''s');
select is((select count(*) from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('cara') and actor_id = tests.u('cara')), 0::bigint, 'nobody gets a digest about their own uploads');
select is((select array_agg((payload ->> 'count')::int) from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('bob') and roll_id = tests.roll(1)), array[3],
  'bob blocked dan: only cara''s 3 in the last hour, nothing for dan''s hours');
select is((select count(*) from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('bob') and actor_id = tests.u('dan')), 0::bigint, 'and no digest about dan at all');
select is((select count(*) from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('hana') and roll_id = tests.roll(3)), 0::bigint, 'the Surprise honoree gets no digest of the hidden roll');
select is((select payload -> 'sample_photo_ids' from public.activity_events where kind = 'upload_batch' and roll_id = tests.roll(3) limit 1), '[]'::jsonb, 'F6: sealed / hidden roll: no photo ids');
select ok((select bool_and(not instant) from public.activity_events where kind = 'upload_batch'), 'digests are instant = false');
select is((select count(*) from public.activity_events where kind = 'upload_batch' and recipient_id in (tests.u('gus'), tests.u('eve'))), 0::bigint, 'guests and outsiders get no digest');
select is(private.fanout_upload_batches(), 0, 'second run emits nothing');

-- muted members are skipped
delete from public.activity_events;
update public.crew_members set muted = true where user_id = tests.u('cara');
insert into public.upload_batches (roll_id, uploader_id, bucket_start, photo_count) values
  (tests.roll(1), tests.u('dan'), date_trunc('hour', now()) - interval '5 hours', 1);
select private.fanout_upload_batches();
select is((select count(*) from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('cara')), 0::bigint, 'muted crew members get no digest');
update public.crew_members set muted = false;

-- the claim hands out instant rows first, then the digest rows
delete from public.activity_events;
insert into public.activity_events (recipient_id, actor_id, crew_id, roll_id, kind, payload, instant, created_at) values
  (tests.u('alice'), tests.u('dan'), tests.crew(), tests.roll(1), 'upload_batch', '{"count":2}', false, now() - interval '30 minutes'),
  (tests.u('alice'), tests.u('dan'), tests.crew(), tests.roll(1), 'upload_batch', '{"count":3}', false, now() - interval '20 minutes'),
  (tests.u('alice'), tests.u('cara'), tests.crew(), null, 'mention', '{}', true, now() - interval '10 minutes');
create temp table t_claim as select * from private.claim_push_batch(2);
select is((select array_agg(kind::text order by ctid) from t_claim), array['mention', 'upload_batch'], 'claim: the instant row comes first, even though it is the newest');
select is((select count(*) from t_claim where kind = 'upload_batch'), 1::bigint, 'and the oldest digest row fills the batch');
select is((select muted from t_claim where kind = 'mention'), false, 'claim still returns the muted flag');
select is(private.call_push_dispatch(), null, 'call_push_dispatch: no pg_net here -> null (and no error)');
select is(private.call_push_dispatch('?job=purge'), null, 'call_push_dispatch purge: nothing queued / no pg_net -> null');

-- ---------------------------------------------------------------------------------------------
-- Realtime: broadcast on grid-relevant changes (a fake realtime.send records the calls)
-- ---------------------------------------------------------------------------------------------
create schema realtime;
create table realtime.sent (payload jsonb, event text, topic text, is_private boolean);
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language plpgsql as $$
begin
  if payload ->> 'roll_id' = '00000000-0000-0000-0000-000000000000' then raise exception 'boom'; end if;
  insert into realtime.sent values (payload, event, topic, private);
end $$;
grant usage on schema realtime to public;
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'photos'), 0::bigint, 'photos is not in the realtime publication');
select tests.add_photo(12, 1, 'cara', 'pending');
select is((select count(*) from realtime.sent), 0::bigint, 'a new pending upload broadcasts nothing');
update public.photos set status = 'ready' where id = tests.photo(12);
select is((select count(*) from realtime.sent where topic = 'roll:' || tests.roll(1) and event = 'photos_changed' and is_private = false
            and payload = jsonb_build_object('roll_id', tests.roll(1))), 1::bigint, 'pending -> ready broadcasts photos_changed on roll:<id> (public channel)');
update public.photos set caption = 'x' where id = tests.photo(12);
select is((select count(*) from realtime.sent), 1::bigint, 'a caption edit does not broadcast');
update public.photos set visibility = 'only_me' where id = tests.photo(12);
select is((select count(*) from realtime.sent), 2::bigint, 'a visibility change broadcasts');
update public.photos set status = 'removed', removed_at = now() where id = tests.photo(12);
select is((select count(*) from realtime.sent), 3::bigint, 'ready -> removed broadcasts');
select lives_ok($$select private.broadcast_photos_changed('00000000-0000-0000-0000-000000000000')$$, 'a failing realtime.send never breaks the caller');
select lives_ok($$select private.broadcast_photos_changed(null)$$, 'null roll: no-op');
select ok(not has_function_privilege('authenticated', 'private.broadcast_photos_changed(uuid)', 'execute'), 'broadcast helper is not callable by clients');

-- ---------------------------------------------------------------------------------------------
-- Indexes + privileges
-- ---------------------------------------------------------------------------------------------
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'photos_grid_idx'),
  'CREATE INDEX photos_grid_idx ON public.photos USING btree (roll_id, sort_at DESC, id DESC)', 'one full grid index (not partial)');
select is((select count(*) from pg_indexes where schemaname = 'public' and indexname = 'photos_roll_idx'), 0::bigint, 'photos_roll_idx is merged into the grid index');
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'rolls_crew_idx'),
  'CREATE INDEX rolls_crew_idx ON public.rolls USING btree (crew_id)', 'rolls(crew_id) is plain');
select is((select count(*) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
            where i.indrelid in ('public.rolls'::regclass, 'public.crews'::regclass) and a.attname = 'last_activity_at'), 0::bigint,
  'last_activity_at is not indexed (HOT updates)');
select is((select count(*) from pg_indexes where schemaname = 'public' and indexname = 'activity_events_created_brin' and indexdef like '%USING brin (created_at)%'), 1::bigint, 'BRIN on activity_events(created_at)');
select ok(has_function_privilege('authenticated', 'public.roll_photos(uuid,timestamptz,uuid,uuid,integer)', 'execute'), 'authenticated (guests too) can call roll_photos');
select ok(not has_function_privilege('anon', 'public.roll_photos(uuid,timestamptz,uuid,uuid,integer)', 'execute'), 'anon cannot call roll_photos');
select ok(has_function_privilege('authenticated', 'public.photos_by_ids(uuid[])', 'execute'), 'authenticated can call photos_by_ids');
select ok(not has_function_privilege('anon', 'public.photos_by_ids(uuid[])', 'execute'), 'anon cannot call photos_by_ids');
select ok(has_function_privilege('authenticated', 'private.my_thread_keys()', 'execute'), 'the chat policy can call my_thread_keys as the invoker');
select ok(not has_function_privilege('anon', 'private.my_thread_keys()', 'execute'), 'anon cannot');
select ok(not has_function_privilege('authenticated', 'private.fanout_upload_batches()', 'execute') and not has_function_privilege('authenticated', 'private.claim_push_batch(integer)', 'execute')
          and not has_function_privilege('authenticated', 'private.call_push_dispatch(text)', 'execute'), 'job functions stay service-role only');
select ok(has_function_privilege('authenticated', 'private.my_roll_ids()', 'execute') and has_function_privilege('authenticated', 'private.my_space_user_ids()', 'execute'), 'policy helpers keep their authenticated grant');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname in ('public', 'private') and p.prosecdef and p.proname in ('roll_photos', 'my_thread_keys', 'broadcast_photos_changed')
                         and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=""%', false)), 'new definer functions pin search_path');
select is((select prosecdef from pg_proc where proname = 'photos_by_ids'), false, 'photos_by_ids is security invoker');

select tests.as_super();
select * from finish();
rollback;
