-- Column-level update grants + update policies.
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


select tests.as_user('cara');
select throws_ok($$update public.profiles set storage_used_bytes = 0 where id = tests.u('cara')$$, '42501', null, 'cannot update own storage_used_bytes');
select throws_ok($$update public.profiles set storage_quota_bytes = 1 where id = tests.u('cara')$$, '42501', null, 'cannot update own quota');
select throws_ok($$update public.profiles set is_guest = true where id = tests.u('cara')$$, '42501', null, 'cannot update own is_guest');
select lives_ok($$update public.profiles set display_name = 'Cara K', ring_color = 'sky', birthday_day = 3, birthday_month = 4,
                  consent_stickers = true where id = tests.u('cara')$$, 'can update own allowed columns');
select is((select display_name from public.profiles where id = tests.u('cara')), 'Cara K', 'display_name updated');
select lives_ok($$update public.profiles set display_name = 'Hacked' where id = tests.u('alice')$$, 'updating another profile is a silent no-op');
select is((select display_name from public.profiles where id = tests.u('alice')), 'Alice', 'other profile unchanged');
select throws_ok($$update public.profiles set handle = 'ALICE' where id = tests.u('cara')$$, 'P0001', 'handle_taken', 'handle_taken (case-insensitive)');
select lives_ok($$update public.profiles set handle = 'Cara.K' where id = tests.u('cara')$$, 'new handle accepted');
select is((select handle from public.profiles where id = tests.u('cara')), 'cara.k', 'handle stored lower-case');
select throws_ok($$update public.profiles set birthday_day = 40 where id = tests.u('cara')$$, '23514', null, 'birthday checked');
select throws_ok($$insert into public.profiles (id, display_name) values (gen_random_uuid(), 'x')$$, '42501', null, 'no profile inserts');
select throws_ok($$delete from public.profiles where id = tests.u('cara')$$, '42501', null, 'no profile deletes');

-- rolls: admin-only, column grants
select lives_ok($$update public.rolls set allow_uploads = false, name = 'Mine now' where id = tests.roll(1)$$, 'member update on a roll is a no-op');
select is((select name from public.rolls where id = tests.roll(1)), 'Goa ''26', 'member cannot change roll settings');
select throws_ok($$update public.rolls set photo_count = 0 where id = tests.roll(1)$$, '42501', null, 'photo_count not updatable');
select tests.as_user('alice');
select lives_ok($$update public.rolls set allow_downloads = false, location_name = 'Goa' where id = tests.roll(1)$$, 'admin updates roll settings');
select is((select allow_downloads from public.rolls where id = tests.roll(1)), false, 'roll setting changed');
select throws_ok($$update public.rolls set surprise_honoree_id = null where id = tests.roll(3)$$, '42501', null, 'honoree not client-updatable');
select throws_ok($$update public.rolls set cover_photo_id = tests.photo(7) where id = tests.roll(1)$$, 'P0001', 'invalid_input',
  'roll cover must be a ready photo of that roll');
select tests.as_user('bob');
select lives_ok($$update public.rolls set name = 'Bob''s roll' where id = tests.roll(2)$$, 'roll creator (bob) updates their roll');

-- photos: uploader edits caption / chapter / visibility only
select tests.as_user('cara');
select lives_ok($$update public.photos set caption = 'sunset' where id = tests.photo(1)$$, 'uploader edits caption');
select is((select caption from public.photos where id = tests.photo(1)), 'sunset', 'caption saved');
select lives_ok($$update public.photos set chapter_id = (select id from public.tags where name = 'Beach') where id = tests.photo(1)$$,
  'uploader sets the chapter');
select throws_ok($$update public.photos set status = 'ready' where id = tests.photo(6)$$, '42501', null, 'uploader cannot change status');
select throws_ok($$update public.photos set bytes = 1 where id = tests.photo(1)$$, '42501', null, 'uploader cannot change bytes');
select throws_ok($$insert into public.photos (crew_id, roll_id, uploader_id, content_hash, mime, bytes, original_key, display_key, thumb_key)
                  values (tests.crew(), tests.roll(1), tests.u('cara'), 'md5:x', 'image/jpeg', 1, 'o', 'd', 't')$$, '42501', null, 'no client photo insert');
select throws_ok($$delete from public.photos where id = tests.photo(1)$$, '42501', null, 'no client photo delete');
select tests.as_user('dan');
select lives_ok($$update public.photos set caption = 'mine' where id = tests.photo(1)$$, 'non-uploader caption update is a no-op');
select tests.as_super();
select is((select caption from public.photos where id = tests.photo(1)), 'sunset', 'caption unchanged by non-uploader');

-- membership rows: own mute only
select tests.as_user('cara');
select lives_ok($$update public.crew_members set muted = true where crew_id = tests.crew() and user_id = tests.u('cara')$$, 'mute own crew');
select throws_ok($$update public.crew_members set role = 'host' where crew_id = tests.crew() and user_id = tests.u('cara')$$, '42501', null, 'cannot self-promote');
select lives_ok($$update public.crew_members set muted = true where crew_id = tests.crew() and user_id = tests.u('dan')$$, 'muting others is a no-op');
select tests.as_super();
select is((select array_agg(user_id order by user_id) from public.crew_members where muted), array[tests.u('cara')], 'only cara is muted');

-- tags: admin direct writes
select tests.as_user('cara');
select throws_ok($$insert into public.tags (crew_id, roll_id, name) values (tests.crew(), tests.roll(1), 'Party')$$, '42501', null, 'members cannot add chapters');
select tests.as_user('alice');
select lives_ok($$insert into public.tags (crew_id, roll_id, name, sort) values (tests.crew(), tests.roll(1), 'Party', 2)$$, 'admins add chapters');
select throws_ok($$insert into public.tags (crew_id, roll_id, name) values (tests.crew(), tests.roll(1), 'party')$$, '23505', null, 'chapter names unique per roll (case-insensitive)');

-- reactions / messages / blocks direct writes
select tests.as_user('dan');
select lives_ok($$insert into public.reactions (photo_id, user_id, kind) values (tests.photo(1), tests.u('dan'), 'ICONIC')$$, 'member reacts');
select lives_ok($$update public.reactions set kind = 'LMAO' where photo_id = tests.photo(1) and user_id = tests.u('dan')$$, 're-react replaces');
select is((select n from public.photo_reaction_counts where photo_id = tests.photo(1) and kind = 'LMAO'), 1, 'reaction counts view');
select throws_ok($$insert into public.reactions (photo_id, user_id, kind) values (tests.photo(7), tests.u('dan'), 'HEART')$$, '42501', null,
  'cannot react to a photo you cannot see');
select throws_ok($$insert into public.reactions (photo_id, user_id, kind) values (tests.photo(1), tests.u('cara'), 'HEART')$$, '42501', null,
  'cannot react as someone else');
select lives_ok($$insert into public.messages (crew_id, roll_id, author_id, client_id, body, photo_id)
                 values (tests.crew(), tests.roll(1), tests.u('dan'), gen_random_uuid(), 'look', tests.photo(1))$$, 'member posts a photo reply');
select throws_ok($$insert into public.messages (crew_id, roll_id, author_id, client_id, body, photo_id)
                 values (tests.crew(), tests.roll(1), tests.u('dan'), gen_random_uuid(), 'peek', tests.photo(7))$$, '42501', null,
  'cannot attach a photo you cannot see');
select throws_ok($$insert into public.messages (crew_id, author_id, client_id, body) values (tests.crew(), tests.u('cara'), gen_random_uuid(), 'x')$$,
  '42501', null, 'cannot post as someone else');
select throws_ok($$insert into public.messages (crew_id, author_id, client_id, body, kind) values (tests.crew(), tests.u('dan'), gen_random_uuid(), 'x', 'system')$$,
  '42501', null, 'clients cannot post system messages');
select lives_ok($$update public.messages set deleted_at = now() where body = 'look'$$, 'author soft-deletes own message');
select throws_ok($$update public.messages set body = 'edited' where body = 'look'$$, '42501', null, 'message body is immutable');
select lives_ok($$insert into public.blocks (blocker_id, blocked_id) values (tests.u('dan'), tests.u('cara'))$$, 'block someone');
select throws_ok($$insert into public.blocks (blocker_id, blocked_id) values (tests.u('cara'), tests.u('dan'))$$, '42501', null, 'cannot block on behalf of others');
select lives_ok($$insert into public.notification_prefs (user_id, uploads) values (tests.u('dan'), false)
                 on conflict (user_id) do update set uploads = excluded.uploads$$, 'upsert own notification prefs');

select tests.as_super();
select * from finish();
rollback;
