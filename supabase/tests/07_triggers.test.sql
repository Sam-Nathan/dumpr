-- Triggers (§6): auth -> profiles, photo status counters / cover / storage / upload_batches, removal,
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

-- guest_review, fanout_upload_batches, mentions, joined, de-dupe index, hard-delete purge queue.

create function tests.roll_count(p_n int) returns int language sql stable security definer as $$
  select photo_count from public.rolls where id = tests.roll(p_n) $$;
create function tests.storage(p_name text) returns bigint language sql stable security definer as $$
  select storage_used_bytes from public.profiles where id = tests.u(p_name) $$;
grant execute on all functions in schema tests to public;

-- auth.users -> profiles
select is((select display_name from public.profiles where id = tests.u('ivan')), 'Ivan', 'display_name from full_name');
select is((select display_name from public.profiles where id = tests.u('jill')), 'Jill', 'display_name from name');
select is((select display_name from public.profiles where id = tests.u('kim')), 'New user', 'no name -> New user');
select is((select is_guest from public.profiles where id = tests.u('gus')), true, 'anonymous -> is_guest');
update public.profiles set display_name = 'Kimmy' where id = tests.u('kim');
update auth.users set raw_user_meta_data = '{"avatar":"x"}' where id = tests.u('kim');
select is((select display_name from public.profiles where id = tests.u('kim')), 'Kimmy', 'unrelated metadata update keeps the app-edited name');

-- seeded counters (inserted ready photos count too)
select is(tests.roll_count(1), 3, 'R1 photo_count = ready photos (P1, P2, P3)');
select is(tests.storage('cara'), 3000::bigint, 'cara storage = her 3 ready photos');
select is((select cover_photo_id from public.rolls where id = tests.roll(1)), tests.photo(1), 'first ready public photo becomes the roll cover');
select is((select cover_photo_id from public.crews where id = tests.crew()), tests.photo(1), 'and the crew cover');
select is((select photo_count from public.upload_batches where roll_id = tests.roll(1) and uploader_id = tests.u('dan')), 2,
  'upload_batches counts dan''s ready photos in this hour');

-- pending -> ready as the service role (upload-complete)
select tests.as_service();
update public.photos set status = 'ready', blurhash = 'LKO2' where id = tests.photo(6);
select tests.as_super();
select is(tests.roll_count(1), 4, 'pending -> ready: photo_count + 1');
select is(tests.storage('cara'), 4000::bigint, 'pending -> ready: storage + bytes');
select is((select photo_count from public.upload_batches where roll_id = tests.roll(1) and uploader_id = tests.u('cara')), 2,
  'pending -> ready: upload_batches bucket upserted (P1 + P6)');
select is((select sample_photo_ids from public.upload_batches where roll_id = tests.roll(1) and uploader_id = tests.u('cara')),
  array[tests.photo(1), tests.photo(6)], 'sample_photo_ids collected');
select ok((select last_activity_at > now() - interval '1 minute' from public.rolls where id = tests.roll(1)), 'roll last_activity_at bumped');

-- sort_at
select tests.add_photo(20, 1, 'cara', 'pending');
update public.photos set taken_at = '2026-01-01T10:00:00Z' where id = tests.photo(20);
select is((select sort_at from public.photos where id = tests.photo(20)), '2026-01-01T10:00:00Z'::timestamptz, 'sort_at = taken_at');

-- removal
select tests.as_user('cara');
select lives_ok($$select public.remove_photo(tests.photo(1), 'blurry')$$, 'uploader removes P1');
select tests.as_super();
select is(tests.roll_count(1), 3, 'ready -> removed: photo_count - 1');
select is(tests.storage('cara'), 3000::bigint, 'ready -> removed: storage - bytes');
select is((select cover_photo_id from public.rolls where id = tests.roll(1)), tests.photo(6), 'cover moves to the newest remaining public photo');
select is((select (status, removed_by, removed_reason)::text from public.photos where id = tests.photo(1)),
  (('removed', tests.u('cara'), 'blurry'))::text, 'removed_* recorded');
select is((select count(*) from public.activity_events where kind = 'photo_removed'), 0::bigint, 'no photo_removed activity when the uploader removes');
select tests.as_user('alice');
select lives_ok($$select public.remove_photo(tests.photo(2))$$, 'host removes dan''s photo');
select tests.as_super();
select is((select count(*) from public.activity_events where kind = 'photo_removed' and recipient_id = tests.u('dan')), 1::bigint,
  'photo_removed activity to the uploader when an admin removes');
select tests.as_user('dan');
select throws_ok($$select public.remove_photo(tests.photo(6))$$, 'P0001', 'not_admin', 'members cannot remove others'' photos');

-- de-dupe
select tests.as_super();
select throws_ok($$insert into public.photos (crew_id, roll_id, uploader_id, content_hash, mime, bytes, original_key, display_key, thumb_key)
                  values (tests.crew(), tests.roll(1), tests.u('dan'), 'md5:' || md5('3'), 'image/jpeg', 1, 'o', 'd', 't')$$,
  '23505', null, 'same content_hash twice in a roll is rejected');
select lives_ok($$insert into public.photos (crew_id, roll_id, uploader_id, content_hash, mime, bytes, original_key, display_key, thumb_key)
                  values (tests.crew(), tests.roll(1), tests.u('dan'), 'md5:' || md5('1'), 'image/jpeg', 1, 'o1', 'd1', 't1')$$,
  'a removed photo''s hash can be uploaded again');
select lives_ok($$insert into public.photos (crew_id, roll_id, uploader_id, content_hash, mime, bytes, original_key, display_key, thumb_key)
                  values (tests.crew(), tests.roll(2), tests.u('dan'), 'md5:' || md5('3'), 'image/jpeg', 1, 'o2', 'd2', 't2')$$,
  'same hash in another roll is fine');
select throws_ok($$insert into public.photos (crew_id, roll_id, uploader_id, content_hash, mime, bytes, original_key, display_key, thumb_key)
                  values (gen_random_uuid(), tests.roll(1), tests.u('dan'), 'md5:zz', 'image/jpeg', 1, 'o', 'd', 't')$$,
  'P0001', 'invalid_input', 'photo crew_id must match the roll');
select lives_ok($$insert into public.photos (id, crew_id, roll_id, uploader_id, content_hash, mime, bytes, original_key, display_key, thumb_key)
                  values ('d0000000-0000-0000-0000-0000000000ff', tests.crew(), tests.roll(1), tests.u('dan'), 'md5:cid', 'image/jpeg', 1, 'o', 'd', 't')$$,
  'photos.id accepts a client-generated id');

-- guest_review activity
select is((select count(*) from public.activity_events where kind = 'guest_review'), 3::bigint, 'seeded review photo -> guest_review to 3 admins');
select ok((select bool_and(instant) from public.activity_events where kind = 'guest_review'), 'guest_review is instant');
select tests.add_photo(21, 1, 'gus', 'pending');
update public.photos set status = 'review' where id = tests.photo(21);
select is((select count(*) from public.activity_events where kind = 'guest_review'), 3::bigint, 'burst of guest uploads is throttled');
select is((select max((payload ->> 'count')::int) from public.activity_events where kind = 'guest_review'), 2, 'throttled row counts the burst');
select tests.as_user('alice');
select lives_ok(format('select public.review_guest_photos(array[%L, %L]::uuid[], true)', tests.photo(5), tests.photo(21)), 'host approves guest photos');
select tests.as_super();
select is((select count(*) from public.photos where id in (tests.photo(5), tests.photo(21)) and status = 'ready'), 2::bigint, 'review -> ready');
select is(tests.roll_count(1), 4, 'approved guest photos counted (2 left after removals + 2 approved)');
select tests.as_user('cara');
select throws_ok(format('select public.review_guest_photos(array[%L]::uuid[], false)', tests.photo(5)), 'P0001', 'not_admin', 'members cannot review');

-- fanout_upload_batches
select tests.as_super();
update public.crew_members set muted = true where crew_id = tests.crew() and user_id = tests.u('dan');
update public.upload_batches set bucket_start = bucket_start - interval '1 hour';
delete from public.activity_events;
select ok(private.fanout_upload_batches() > 0, 'fanout emits digests for closed buckets');
-- one digest row per recipient and roll for the closed hour: cara 1 + dan 1 (both walked back by removals) + gus 2
-- (approved guest photos); dan is muted and gus is a guest, so neither gets a digest themselves
select is((select array_agg(recipient_id order by recipient_id) from public.activity_events
            where kind = 'upload_batch' and roll_id = tests.roll(1)),
  array[tests.u('alice'), tests.u('bob'), tests.u('cara'), tests.u('hana'), tests.u('ravi')],
  'one digest per non-muted, non-guest member (the uploaders only get the other one''s)');
select is((select payload ->> 'count' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1)), '4',
  'payload count = cara 1 + dan 1 + gus 2 (buckets walked back by the removals of P1 / P2)');
select is((select payload ->> 'uploaders' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1)), '3',
  'payload uploaders');
select is((select payload ->> 'count' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('cara') and roll_id = tests.roll(1)), '3',
  'cara''s own uploads are not counted for her (dan 1 + gus 2)');
select is((select payload ->> 'uploader_name' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1)), 'Gus',
  'payload uploader_name = the top uploader');
select is((select payload ->> 'roll_name' from public.activity_events where kind = 'upload_batch' and recipient_id = tests.u('alice') and roll_id = tests.roll(1)), 'Goa ''26',
  'payload roll_name');
select ok((select bool_and(not instant) from public.activity_events where kind = 'upload_batch'), 'digests are instant = false');
select is((select count(*) from public.upload_batches where notified_at is null), 0::bigint, 'buckets marked notified');
select is(private.fanout_upload_batches(), 0, 'second run emits nothing');
select tests.add_photo(22, 1, 'cara', 'ready');
select is(private.fanout_upload_batches(), 0, 'the current hour''s bucket stays open');

-- mentions
delete from public.activity_events;
select tests.as_user('cara');
insert into public.messages (crew_id, author_id, client_id, body)
values (tests.crew(), tests.u('cara'), gen_random_uuid(), 'hey @Alice and @dan. also @eve @cara @nobody');
select tests.as_super();
select is((select array_agg(recipient_id order by recipient_id) from public.activity_events where kind = 'mention'),
  array[tests.u('alice'), tests.u('dan')], 'mentions notify thread members only (not outsiders, not self)');
select ok((select bool_and(instant) and bool_and(payload ? 'snippet') from public.activity_events where kind = 'mention'), 'mention is instant with a snippet');
select tests.as_user('cara');
insert into public.messages (crew_id, roll_id, author_id, client_id, body)
values (tests.crew(), tests.roll(1), tests.u('cara'), gen_random_uuid(), '@ravi @gus look');
select tests.as_super();
select is((select count(*) from public.activity_events where kind = 'mention' and recipient_id = tests.u('ravi')), 1::bigint,
  'roll chat mention reaches roll-only members');
select is((select count(*) from public.activity_events where kind = 'mention' and recipient_id = tests.u('gus')), 0::bigint, 'guests are never mentioned');
select ok((select last_activity_at > now() - interval '1 minute' from public.crews where id = tests.crew()), 'messages bump crew activity');

-- joined (instant = false) to admins
delete from public.activity_events;
insert into public.roll_members (roll_id, user_id, role) values (tests.roll(1), tests.u('kim'), 'member');
select is((select count(*) from public.activity_events where kind = 'joined' and not instant), 3::bigint, 'roll join -> joined to crew admins');
insert into public.roll_members (roll_id, user_id, role) values (tests.roll(2), tests.u('kim'), 'member');
select is((select count(*) from public.activity_events where kind = 'joined' and roll_id = tests.roll(2)), 3::bigint,
  'roll creator (bob) is among the admins, deduplicated');

-- hard delete -> purge queue + counters
delete from public.media_purge_queue;
delete from public.photos where id = tests.photo(22);
select is((select count(*) from public.media_purge_queue), 3::bigint, 'hard delete queues original/display/thumb');
select is(tests.storage('cara'), 3000::bigint, 'hard delete of a ready photo releases storage');

select tests.as_super();
select * from finish();
rollback;
