-- Security review fixes (migration 13): every exploit from the review is reproduced and asserted blocked.
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

create temp table t_codes (name text primary key, code text) on commit drop;
grant all on t_codes to public;
create temp table t_ids (name text primary key, id uuid) on commit drop;
grant all on t_ids to public;

-- ---------------------------------------------------------------------------------------------
-- F1 · avatar_key is confined to a/<own id>/<uuid>.jpg; nobody can aim a purge or a signature at other keys
-- ---------------------------------------------------------------------------------------------
select tests.as_user('cara');
select throws_ok(
  format('update public.profiles set avatar_key = %L where id = %L', 'o/' || tests.crew() || '/' || tests.roll(2) || '/' || tests.photo(7), tests.u('cara')),
  '23514', null, 'F1: avatar_key cannot point at a sealed photo original');
select throws_ok(
  format('update public.profiles set avatar_key = %L where id = %L', 'a/' || tests.u('dan') || '/11111111-1111-1111-1111-111111111111.jpg', tests.u('cara')),
  '23514', null, 'F1: avatar_key cannot point under another user''s prefix');
select throws_ok(
  format('update public.profiles set avatar_key = %L where id = %L', 'a/' || tests.u('cara') || '/../' || tests.u('dan') || '/x.jpg', tests.u('cara')),
  '23514', null, 'F1: no path tricks');
select lives_ok(
  format('update public.profiles set avatar_key = %L where id = %L', 'a/' || tests.u('cara') || '/11111111-1111-1111-1111-111111111111.jpg', tests.u('cara')),
  'F1: the own avatar prefix is fine');
select tests.as_user('gus');
select throws_ok(
  format('update public.profiles set avatar_key = %L where id = %L', 'o/' || tests.crew() || '/' || tests.roll(1) || '/' || tests.photo(1), tests.u('gus')),
  '23514', null, 'F1: a guest cannot aim avatar_key at a visible original either');

-- defence in depth: even if a bad key were stored (constraint dropped inside this rolled-back test), the purge paths ignore it
select tests.as_super();
alter table public.profiles drop constraint profiles_avatar_key_own;
update public.profiles set avatar_key = 'o/' || tests.crew() || '/' || tests.roll(1) || '/' || tests.photo(1) where id = tests.u('gus');
update public.profiles set avatar_key = 'a/' || tests.u('eve') || '/11111111-1111-1111-1111-111111111111.jpg' where id = tests.u('ivan');
update public.profiles set avatar_key = 'a/' || tests.u('kim') || '/22222222-2222-2222-2222-222222222222.jpg' where id = tests.u('kim');
select tests.as_service();
select public.svc_enqueue_user_media(tests.u('gus'));
select public.svc_enqueue_user_media(tests.u('ivan'));
select public.svc_enqueue_user_media(tests.u('kim'));
select tests.as_super();
select is((select count(*) from public.media_purge_queue where key = 'o/' || tests.crew() || '/' || tests.roll(1) || '/' || tests.photo(1)), 0::bigint,
  'F1: svc_enqueue_user_media never queues a foreign key held in avatar_key');
select is((select count(*) from public.media_purge_queue where key like 'a/' || tests.u('eve') || '/%'), 0::bigint,
  'F1: nor another user''s avatar');
select is((select count(*) from public.media_purge_queue where key = 'a/' || tests.u('kim') || '/22222222-2222-2222-2222-222222222222.jpg'), 1::bigint,
  'F1: the user''s own avatar is queued');
-- the public preview never carries a foreign key either (host = link creator alice, facepile = crew members)
update public.profiles set avatar_key = 'o/' || tests.crew() || '/' || tests.roll(2) || '/' || tests.photo(7) where id = tests.u('alice');
update public.profiles set avatar_key = 'a/' || tests.u('dan') || '/44444444-4444-4444-4444-444444444444.jpg' where id = tests.u('cara');
update public.profiles set avatar_key = 'a/' || tests.u('bob') || '/55555555-5555-5555-5555-555555555555.jpg' where id = tests.u('bob');
select tests.as_user('alice');
insert into t_codes values ('f1_prev', public.create_invite(tests.crew()) ->> 'code');
select tests.as_anon();
select is(public.invite_preview((select code from t_codes where name = 'f1_prev')) #>> '{host,avatar_key}', null,
  'F1: invite_preview drops a host avatar_key that is not under the host''s own prefix');
select is((select count(*) from jsonb_array_elements(public.invite_preview((select code from t_codes where name = 'f1_prev')) -> 'facepile') f
           where f ->> 'avatar_key' is not null), 1::bigint,
  'F1: and facepile keys likewise (only bob''s own avatar survives)');
select tests.as_super();
delete from auth.users where id in (tests.u('gus'), tests.u('ivan'));
select is((select count(*) from public.media_purge_queue where key = 'o/' || tests.crew() || '/' || tests.roll(1) || '/' || tests.photo(1)), 0::bigint,
  'F1: deleting the account does not queue the foreign original (trigger)');
select is((select count(*) from public.media_purge_queue where key like 'a/' || tests.u('eve') || '/%'), 0::bigint,
  'F1: nor the other user''s avatar (trigger)');
select is((select status::text from public.photos where id = tests.photo(1)), 'ready', 'F1: the original photo is untouched');

-- ---------------------------------------------------------------------------------------------
-- F2 (DB side) · pending uploads are visible to upload-init (quota / rate limit)
-- ---------------------------------------------------------------------------------------------
select tests.as_service();
select is(public.svc_upload_context(tests.u('cara'), tests.roll(1)) ->> 'pending_count', '1', 'F2: pending_count counts the unfinished upload (P6)');
select is(public.svc_upload_context(tests.u('cara'), tests.roll(1)) ->> 'pending_bytes', '1000', 'F2: pending_bytes sums them');
select is(public.svc_upload_context(tests.u('dan'), tests.roll(1)) ->> 'pending_count', '0', 'F2: nothing pending for dan');

-- ---------------------------------------------------------------------------------------------
-- F3 · a removed / demoted / departed inviter's links stop working
-- ---------------------------------------------------------------------------------------------
select tests.as_user('bob');
insert into t_codes values ('bob_crew', public.create_invite(tests.crew(), null, 30) ->> 'code');
select tests.as_user('hana');
insert into t_codes values ('hana_crew', public.create_invite(tests.crew(), null, 30) ->> 'code');
select tests.as_user('cara');
insert into t_codes values ('cara_roll', public.create_invite(tests.crew(), tests.roll(1)) ->> 'code');
select tests.as_user('ravi');
insert into t_codes values ('ravi_roll', public.create_invite(tests.crew(), tests.roll(1)) ->> 'code');

select tests.as_user('alice');
select public.remove_member(tests.crew(), tests.u('bob'));
select public.set_member_role(tests.crew(), tests.u('hana'), 'member');
select tests.as_super();
select isnt((select revoked_at from public.invites where code = (select code from t_codes where name = 'bob_crew')), null,
  'F3: removing a member revokes the invites they made');
select isnt((select revoked_at from public.invites where code = (select code from t_codes where name = 'hana_crew')), null,
  'F3: demoting an admin revokes their crew-wide invites');
select is((select revoked_at from public.invites where code = (select code from t_codes where name = 'cara_roll')), null,
  'F3: a member who is still a member keeps their roll invite');

select tests.as_user('bob');
select is((select count(*) from public.invites where created_by = tests.u('bob')), 0::bigint, 'F3: the removed cohost no longer lists their old invite codes');
select throws_ok(format('select public.join_via_invite(%L)', (select code from t_codes where name = 'bob_crew')), 'P0001', 'invite_revoked',
  'F3: the removed cohost cannot rejoin with their own link');
select is((select count(*) from public.crew_members where crew_id = tests.crew() and user_id = tests.u('bob')), 0::bigint, 'F3: and is still out');
select tests.as_user('eve');
select throws_ok(format('select public.join_via_invite(%L)', (select code from t_codes where name = 'bob_crew')), 'P0001', 'invite_revoked',
  'F3: nobody else can use the removed cohost''s link either');
select tests.as_anon();
select is(public.invite_preview((select code from t_codes where name = 'bob_crew')) ->> 'status', 'revoked', 'F3: preview says revoked');

-- the join-time check also catches links whose creator never had / no longer has the authority (no trigger involved)
select tests.as_super();
insert into public.invites (code, crew_id, roll_id, created_by) values ('memb2rknk2', tests.crew(), null, tests.u('cara'));   -- plain member, crew-wide
select tests.as_user('eve');
select throws_ok($$select public.join_via_invite('memb2rknk2')$$, 'P0001', 'invite_revoked', 'F3: a crew link made by a plain member is not honoured');
select tests.as_super();
update public.invites set created_by = null where code = 'memb2rknk2';
select tests.as_user('eve');
select throws_ok($$select public.join_via_invite('memb2rknk2')$$, 'P0001', 'invite_revoked', 'F3: a link whose creator is gone is dead');

-- roll-only member leaves the roll: their roll link dies at join time
select tests.as_user('ravi');
select public.leave_roll(tests.roll(1));
select tests.as_user('eve');
select throws_ok(format('select public.join_via_invite(%L)', (select code from t_codes where name = 'ravi_roll')), 'P0001', 'invite_revoked',
  'F3: a roll link of someone who left the roll is dead');
select is(public.join_via_invite((select code from t_codes where name = 'cara_roll')) ->> 'status', 'joined', 'F3: a roll link of a current member still works');

-- leaving the crew revokes too
select tests.as_user('dan');
insert into t_codes values ('dan_roll', public.create_invite(tests.crew(), tests.roll(1)) ->> 'code');
select public.leave_crew(tests.crew());
select tests.as_super();
select isnt((select revoked_at from public.invites where code = (select code from t_codes where name = 'dan_roll')), null, 'F3: leaving the crew revokes the invites');

-- ---------------------------------------------------------------------------------------------
-- F4 · an author cannot undo a moderator's removal of their message
-- ---------------------------------------------------------------------------------------------
select tests.as_user('cara');
with m as (insert into public.messages (crew_id, author_id, client_id, body)
  values (tests.crew(), tests.u('cara'), gen_random_uuid(), 'abusive') returning id) insert into t_ids select 'm_mod', id from m;
with m as (insert into public.messages (crew_id, author_id, client_id, body)
  values (tests.crew(), tests.u('cara'), gen_random_uuid(), 'mine') returning id) insert into t_ids select 'm_own', id from m;
select tests.as_super();
update public.messages set deleted_at = now() where id = (select id from t_ids where name = 'm_mod');   -- what decide_report('remove') does
select tests.as_user('cara');
update public.messages set deleted_at = null where id = (select id from t_ids where name = 'm_mod');
select tests.as_super();
select isnt((select deleted_at from public.messages where id = (select id from t_ids where name = 'm_mod')), null,
  'F4: the author cannot un-delete a removed message');
select tests.as_user('cara');
update public.messages set deleted_at = now() where id = (select id from t_ids where name = 'm_own');
select tests.as_super();
select isnt((select deleted_at from public.messages where id = (select id from t_ids where name = 'm_own')), null, 'F4: authors can still delete their own message');
select tests.as_user('cara');
update public.messages set deleted_at = null where id = (select id from t_ids where name = 'm_own');
select tests.as_super();
select isnt((select deleted_at from public.messages where id = (select id from t_ids where name = 'm_own')), null, 'F4: ... but not undo that either');

-- ---------------------------------------------------------------------------------------------
-- F5 + F7 · the last crew member's account is deleted: the crew is soft-deleted, roll-only members are told,
--           and their access ends with the purge window
-- ---------------------------------------------------------------------------------------------
select tests.as_user('kim');
insert into t_ids select 'solo', (public.create_crew('Solo')).id;
insert into t_ids select 'party', (public.create_roll((select id from t_ids where name = 'solo'), 'Party')).id;
insert into t_codes values ('solo_roll', public.create_invite((select id from t_ids where name = 'solo'), (select id from t_ids where name = 'party')) ->> 'code');
insert into t_codes values ('solo_crew', public.create_invite((select id from t_ids where name = 'solo')) ->> 'code');
select tests.as_user('gina');
select is(public.join_via_invite((select code from t_codes where name = 'solo_roll')) ->> 'status', 'joined', 'F5 setup: guest joins the roll');
select tests.as_super();
delete from auth.users where id = tests.u('kim');
select isnt((select deleted_at from public.crews where id = (select id from t_ids where name = 'solo')), null, 'F5: crew without members is soft-deleted');
select ok((select purge_after from public.crews where id = (select id from t_ids where name = 'solo')) between now() + interval '29 days' and now() + interval '31 days',
  'F5: with the normal 30-day grace window');
select is((select count(*) from public.invites where crew_id = (select id from t_ids where name = 'solo') and revoked_at is null), 0::bigint, 'F5: its invites are revoked');
select is((select count(*) from public.activity_events where kind = 'crew_deleted' and recipient_id = tests.u('gina')), 1::bigint,
  'F5: the roll-only member is told');
select tests.as_anon();
select is(public.invite_preview((select code from t_codes where name = 'solo_roll')) ->> 'status', 'not_found', 'F5: the dead crew''s link previews as not_found');
select tests.as_user('gina');
select ok((select id from t_ids where name = 'party') = any (private.my_roll_ids()), 'F7: inside the grace window the roll-only member still reads');
select tests.as_super();
update public.crews set purge_after = now() - interval '1 hour' where id = (select id from t_ids where name = 'solo');
select tests.as_user('gina');
select ok(not ((select id from t_ids where name = 'party') = any (private.my_roll_ids())), 'F7: past purge_after the roll-only member no longer reads the roll');
select tests.as_super();
insert into public.roll_members (roll_id, user_id, role) values (tests.roll(1), tests.u('gabe'), 'guest');
select tests.as_user('gabe');
select ok(tests.roll(1) = any (private.my_roll_ids()), 'F7: unrelated roll-only membership is unaffected');

-- ---------------------------------------------------------------------------------------------
-- F6 · the hourly digest never names sealed / only_me / selected photos
-- ---------------------------------------------------------------------------------------------
select tests.as_super();
delete from public.upload_batches;
insert into public.upload_batches (roll_id, uploader_id, bucket_start, photo_count, sample_photo_ids) values
  (tests.roll(1), tests.u('cara'), now() - interval '3 hours', 3, array[tests.photo(1), tests.photo(2), tests.photo(3)]),
  (tests.roll(2), tests.u('cara'), now() - interval '3 hours', 2, array[tests.photo(7), tests.photo(8)]);
select private.fanout_upload_batches();
select is((select payload -> 'sample_photo_ids' from public.activity_events where kind = 'upload_batch' and roll_id = tests.roll(1) limit 1),
  jsonb_build_array(tests.photo(1)), 'F6: only the ready + everyone photo id is in the open roll''s digest');
select is((select count(*) from public.activity_events where kind = 'upload_batch' and roll_id = tests.roll(1)), (select count(*) from public.activity_events where kind = 'upload_batch' and roll_id = tests.roll(1) and payload -> 'sample_photo_ids' = jsonb_build_array(tests.photo(1))),
  'F6: for every recipient');
select ok((select count(*) from public.activity_events where kind = 'upload_batch' and roll_id = tests.roll(2)) > 0, 'F6: the sealed roll still produces its digest');
select is((select count(*) from public.activity_events where kind = 'upload_batch' and roll_id = tests.roll(2) and payload -> 'sample_photo_ids' = '[]'::jsonb),
  (select count(*) from public.activity_events where kind = 'upload_batch' and roll_id = tests.roll(2)), 'F6: but carries no photo ids');

-- ---------------------------------------------------------------------------------------------
-- F9 · a dead link reveals nothing but its status, kind and the host's name
-- ---------------------------------------------------------------------------------------------
select tests.as_user('alice');
insert into t_codes values ('f9', public.create_invite(tests.crew(), tests.roll(1), 5) ->> 'code');
select tests.as_super();
update public.invites set expires_at = now() - interval '1 minute' where code = (select code from t_codes where name = 'f9');
select tests.as_anon();
select is(public.invite_preview((select code from t_codes where name = 'f9')) ->> 'status', 'expired', 'F9: expired preview still says expired');
select is((select array_agg(k order by k) from jsonb_object_keys(public.invite_preview((select code from t_codes where name = 'f9'))) k), array['host', 'kind', 'status'],
  'F9: and carries only status, kind and host');
select is(public.invite_preview((select code from t_codes where name = 'f9')) -> 'host', jsonb_build_object('display_name', 'Alice'),
  'F9: host is the display name only (no avatar key)');
select tests.as_user('eve');
select is((select array_agg(k order by k) from jsonb_object_keys(public.invite_preview((select code from t_codes where name = 'f9'))) k), array['host', 'kind', 'status'],
  'F9: same for a signed-in stranger');
select tests.as_user('alice');
insert into t_codes values ('f9ok', public.create_invite(tests.crew(), tests.roll(1), 6) ->> 'code');
select tests.as_anon();
select is(public.invite_preview((select code from t_codes where name = 'f9ok')) #>> '{crew,name}', 'Goa gang', 'F9: a live link still previews fully');

-- ---------------------------------------------------------------------------------------------
-- F10 · who_can_add = 'contacts' is enforced, blocks look like 'not accepting'
-- ---------------------------------------------------------------------------------------------
select tests.as_super();
update public.profiles set who_can_add = 'everyone' where id = tests.u('jill');
update public.profiles set who_can_add = 'contacts' where id in (tests.u('dan'), tests.u('eve'));
insert into public.blocks (blocker_id, blocked_id) values (tests.u('jill'), tests.u('alice'));
select tests.as_user('alice');
create temp table t_res on commit drop as
  select public.invite_users(tests.crew(), null, array[tests.u('dan'), tests.u('hana'), tests.u('jill'), tests.u('eve')]) as r;
grant all on t_res to public;
select is((select r -> 'invited' from t_res), jsonb_build_array(tests.u('eve')),
  'F10: only a contact (eve shares Goa ''26 with alice) is invited; dan (left the crew, who_can_add=contacts) is not');
select is((select jsonb_object_agg(e ->> 'user_id', e ->> 'reason') from t_res, jsonb_array_elements(r -> 'skipped') e),
  jsonb_build_object(tests.u('dan'), 'not_accepting', tests.u('hana'), 'already_member', tests.u('jill'), 'not_accepting'),
  'F10: strangers -> not_accepting; a block is reported as not_accepting too');

-- ---------------------------------------------------------------------------------------------
-- F12b · reports about an admin are not visible to, nor decidable by, that admin
-- ---------------------------------------------------------------------------------------------
select tests.as_user('alice');
select public.set_member_role(tests.crew(), tests.u('cara'), 'cohost');
select tests.as_super();
insert into public.crew_members (crew_id, user_id, role) values (tests.crew(), tests.u('dan'), 'member') on conflict do nothing;
select tests.as_user('dan');
insert into t_ids select 'rep_user', (public.report('user', tests.u('cara'), 'rude')).id;
select tests.as_user('cara');
with m as (insert into public.messages (crew_id, author_id, client_id, body)
  values (tests.crew(), tests.u('cara'), gen_random_uuid(), 'cohost message') returning id) insert into t_ids select 'm_cohost', id from m;
select tests.as_user('dan');
insert into t_ids select 'rep_msg', (public.report('message', (select id from t_ids where name = 'm_cohost'), 'rude')).id;
insert into t_ids select 'rep_other', (public.report('user', tests.u('alice'), 'also rude')).id;

select tests.as_user('cara');
select is((select count(*) from public.reports where id in (select id from t_ids where name in ('rep_user', 'rep_msg'))), 0::bigint,
  'F12b: the reported cohost does not see reports about themselves or their message');
select is((select count(*) from public.reports where id = (select id from t_ids where name = 'rep_other')), 1::bigint,
  'F12b: other reports are still theirs to see');
select throws_ok(format('select public.decide_report(%L, %L)', (select id from t_ids where name = 'rep_user'), 'dismiss'), 'P0001', 'not_admin',
  'F12b: the reported cohost cannot dismiss the report about themselves');
select throws_ok(format('select public.decide_report(%L, %L)', (select id from t_ids where name = 'rep_msg'), 'dismiss'), 'P0001', 'not_admin',
  'F12b: nor the report about their message');
select tests.as_user('alice');
select is((select count(*) from public.reports where id in (select id from t_ids where name in ('rep_user', 'rep_msg'))), 2::bigint,
  'F12b: the other admins do see them');
select throws_ok(format('select public.decide_report(%L, %L)', (select id from t_ids where name = 'rep_other'), 'dismiss'), 'P0001', 'not_admin',
  'F12b: alice cannot decide the report about alice');
select lives_ok(format('select public.decide_report(%L, %L)', (select id from t_ids where name = 'rep_user'), 'dismiss'), 'F12b: alice decides the report about the cohost');
select tests.as_super();
select is((select status::text from public.reports where id = (select id from t_ids where name = 'rep_msg')), 'pending', 'F12b: untouched reports stay pending');

-- ---------------------------------------------------------------------------------------------
-- F12c · a denied join request cannot be resubmitted for 24 h
-- ---------------------------------------------------------------------------------------------
select tests.as_user('alice');
insert into t_codes values ('f12c', public.create_invite(tests.crew(), tests.roll(1), null, true) ->> 'code');
select tests.as_user('jill');
select is(public.join_via_invite((select code from t_codes where name = 'f12c')) ->> 'status', 'requested', 'F12c setup: request filed');
select tests.as_user('alice');
select public.decide_join_request((select id from public.join_requests where user_id = tests.u('jill') and status = 'pending'), false);
select tests.as_user('jill');
select throws_ok(format('select public.join_via_invite(%L)', (select code from t_codes where name = 'f12c')), 'P0001', 'request_cooldown',
  'F12c: re-requesting right after a denial is refused');
select tests.as_super();
update public.join_requests set decided_at = now() - interval '25 hours' where user_id = tests.u('jill') and status = 'denied';
select tests.as_user('jill');
select is(public.join_via_invite((select code from t_codes where name = 'f12c')) ->> 'status', 'requested', 'F12c: after 24 h a new request is accepted');

-- ---------------------------------------------------------------------------------------------
-- Privileges of what migration 13 added / replaced
-- ---------------------------------------------------------------------------------------------
select tests.as_super();
select ok(not has_function_privilege('anon', 'private.invite_creator_valid(public.invites)', 'execute')
      and not has_function_privilege('authenticated', 'private.invite_creator_valid(public.invites)', 'execute'),
  'private.invite_creator_valid is not callable by clients');
select ok(not has_function_privilege('anon', 'private.crew_members_after_delete()', 'execute')
      and not has_function_privilege('authenticated', 'private.crew_members_after_delete()', 'execute')
      and not has_function_privilege('authenticated', 'private.crew_members_after_role_change()', 'execute'),
  'the new trigger functions are not callable by clients');
select ok(has_function_privilege('authenticated', 'private.report_target_owner(public.report_target, uuid)', 'execute')
      and not has_function_privilege('anon', 'private.report_target_owner(public.report_target, uuid)', 'execute'),
  'report_target_owner (used by the reports policy) is authenticated-only');
select ok(has_function_privilege('anon', 'public.invite_preview(text)', 'execute')
      and not has_function_privilege('anon', 'public.invite_users(uuid, uuid, uuid[])', 'execute')
      and not has_function_privilege('anon', 'public.decide_report(uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.svc_enqueue_user_media(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.svc_upload_context(uuid, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.fanout_upload_batches()', 'execute'),
  'replaced functions keep their grants');

select tests.as_super();
select * from finish();
rollback;
