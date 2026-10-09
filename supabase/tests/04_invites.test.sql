-- Invites: create/reuse, preview, expiry, revoke, max_uses, approval flow, permissions, in-app invites.
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

select tests.as_user('alice');
select matches(public.create_invite(tests.crew()) ->> 'code', '^[abcdefghjkmnpqrstuvwxyz23456789]{10}$', 'invite code: 10 chars from the safe alphabet');
insert into t_codes values ('crew', public.create_invite(tests.crew()) ->> 'code');
select is((select count(*) from public.invites where crew_id = tests.crew() and roll_id is null), 1::bigint,
  'identical settings reuse the creator''s live invite');
select matches(public.create_invite(tests.crew(), tests.roll(1)) ->> 'url', '^https://dumpr\.app/r/[a-z2-9]{10}$', 'roll invite url uses /r/');
select matches(public.create_invite(tests.crew()) ->> 'url', '^https://dumpr\.app/c/', 'crew invite url uses /c/');
select ok((public.create_invite(tests.crew(), null, 3) ->> 'expires_at')::timestamptz < now() + interval '4 days', 'p_ttl_days sets expiry');
select throws_ok($$select public.create_invite(tests.crew(), null, 0)$$, 'P0001', 'invalid_input', 'ttl must be >= 1 day');
insert into t_codes values ('one', public.create_invite(tests.crew(), null, null, false, true, 1) ->> 'code');
insert into t_codes values ('approval', public.create_invite(tests.crew(), tests.roll(1), null, true) ->> 'code');

-- preview (anon)
select tests.as_anon();
select is(public.invite_preview((select code from t_codes where name = 'crew')) ->> 'status', 'ok', 'preview status ok');
select is(public.invite_preview((select code from t_codes where name = 'crew')) ->> 'kind', 'crew', 'preview kind crew');
select is((public.invite_preview((select code from t_codes where name = 'crew')) ->> 'member_count')::int, 5, 'preview member_count');
select is(jsonb_array_length(public.invite_preview((select code from t_codes where name = 'crew')) -> 'facepile'), 5, 'facepile <= 5');
select is(public.invite_preview((select code from t_codes where name = 'crew')) #>> '{host,display_name}', 'Alice', 'preview host is the link creator');
select is(public.invite_preview((select code from t_codes where name = 'crew')) #>> '{crew,name}', 'Goa gang', 'preview crew name');
select ok(public.invite_preview((select code from t_codes where name = 'crew')) ? 'cover_thumb_key', 'preview has cover_thumb_key');
select is(public.invite_preview((select code from t_codes where name = 'crew')) #>> '{viewer,is_member}', 'false', 'anon viewer is not a member');
select is(public.invite_preview((select code from t_codes where name = 'approval')) #>> '{roll,name}', 'Goa ''26', 'roll preview carries the roll');
select is(public.invite_preview((select code from t_codes where name = 'approval')) ->> 'requires_approval', 'true', 'preview shows requires_approval');
select is(public.invite_preview('zzzzzzzzzz') ->> 'status', 'not_found', 'unknown code -> not_found');
select ok(position('phone' in public.invite_preview((select code from t_codes where name = 'crew'))::text) = 0, 'preview never mentions phones');

-- sealed roll preview: no photo keys
select tests.as_super();
insert into public.invites (code, crew_id, roll_id, created_by) values ('sea2edrr22', tests.crew(), tests.roll(2), tests.u('bob'));
select tests.as_anon();
select is(public.invite_preview('sea2edrr22') ->> 'cover_thumb_key', null, 'sealed roll preview has no cover thumb');
select is(public.invite_preview('sea2edrr22') #>> '{roll,sealed}', 'true', 'sealed roll preview says sealed');
select is(public.invite_preview((select code from t_codes where name = 'approval')) ->> 'cover_thumb_key',
  't/' || tests.crew() || '/' || tests.roll(1) || '/' || tests.photo(1) || '.jpg', 'open roll preview has the cover thumb');

-- join
select tests.as_user('eve');
select is(public.join_via_invite((select code from t_codes where name = 'crew')) ->> 'status', 'joined', 'eve joins via crew link');
select is((select role::text from public.crew_members where crew_id = tests.crew() and user_id = tests.u('eve')), 'member', 'eve is a crew member');
select is(public.join_via_invite((select code from t_codes where name = 'crew')) ->> 'status', 'already_member', 'already_member on repeat');
select is(public.invite_preview((select code from t_codes where name = 'crew')) #>> '{viewer,is_member}', 'true', 'preview knows eve is a member');
select tests.as_super();
select is((select use_count from public.invites where code = (select code from t_codes where name = 'crew')), 1, 'use_count incremented once');
select is((select count(*) from public.activity_events where kind = 'joined' and actor_id = tests.u('eve') and not instant), 3::bigint,
  'joined activity (instant=false) to the three admins');

-- max_uses
select tests.as_user('jill');
select is(public.join_via_invite((select code from t_codes where name = 'one')) ->> 'status', 'joined', 'first use of a max_uses=1 link');
select tests.as_user('kim');
select throws_ok(format('select public.join_via_invite(%L)', (select code from t_codes where name = 'one')), 'P0001', 'invite_full', 'max_uses reached');
select is(public.invite_preview((select code from t_codes where name = 'one')) ->> 'status', 'full', 'preview says full');

-- expired / revoked
select tests.as_super();
update public.invites set expires_at = now() - interval '1 minute' where code = (select code from t_codes where name = 'crew');
select tests.as_user('kim');
select throws_ok(format('select public.join_via_invite(%L)', (select code from t_codes where name = 'crew')), 'P0001', 'invite_expired', 'expired link');
select is(public.invite_preview((select code from t_codes where name = 'crew')) ->> 'status', 'expired', 'preview says expired');
select tests.as_user('eve');
select is(public.join_via_invite((select code from t_codes where name = 'crew')) ->> 'status', 'already_member', 'members still get already_member on an expired link');
select tests.as_super();
update public.invites set expires_at = now() + interval '1 day' where code = (select code from t_codes where name = 'crew');
select tests.as_user('dan');
select throws_ok(format('select public.revoke_invite(%L)', (select code from t_codes where name = 'crew')), 'P0001', 'not_admin', 'members cannot revoke others'' links');
select tests.as_user('bob');
select lives_ok(format('select public.revoke_invite(%L)', (select code from t_codes where name = 'crew')), 'cohost revokes a crew link');
select tests.as_user('kim');
select throws_ok(format('select public.join_via_invite(%L)', (select code from t_codes where name = 'crew')), 'P0001', 'invite_revoked', 'revoked link');
select is(public.invite_preview((select code from t_codes where name = 'crew')) ->> 'status', 'revoked', 'preview says revoked');
select throws_ok($$select public.join_via_invite('zzzzzzzzzz')$$, 'P0001', 'invite_not_found', 'unknown code');
select throws_ok($$select public.revoke_invite('zzzzzzzzzz')$$, 'P0001', 'invite_not_found', 'revoke unknown code');

-- requires_approval -> join_request -> decide
select tests.as_user('ivan');
select is(public.join_via_invite((select code from t_codes where name = 'approval')) ->> 'status', 'requested', 'approval link -> requested');
select is(public.join_via_invite((select code from t_codes where name = 'approval')) ->> 'status', 'requested', 'requesting twice is idempotent');
select is((select count(*) from public.join_requests where user_id = tests.u('ivan') and status = 'pending'), 1::bigint, 'one pending join_request');
select is(public.invite_preview((select code from t_codes where name = 'approval')) #>> '{viewer,request_pending}', 'true', 'preview shows request_pending');
select ok(not (tests.roll(1) = any (select id from public.rolls)), 'requester has no access yet');
select tests.as_super();
select is((select count(*) from public.activity_events where kind = 'join_request' and actor_id = tests.u('ivan') and instant), 3::bigint,
  'join_request activity to admins (alice, bob, hana)');
select tests.as_user('alice');
select is((select count(*) from public.join_requests where status = 'pending'), 1::bigint, 'admin sees the pending request');
select ok(tests.u('ivan') = any (select id from public.profiles), 'admin can see the requester''s profile');
select tests.as_super();
create temp table t_req as select id from public.join_requests where user_id = tests.u('ivan');
grant all on t_req to public;
select tests.as_user('dan');
select is((select count(*) from public.join_requests), 0::bigint, 'members do not see join requests');
select throws_ok(format('select public.decide_join_request(%L, true)', (select id from t_req)),
  'P0001', 'not_admin', 'members cannot decide');
select tests.as_user('alice');
select lives_ok(format('select public.decide_join_request(%L, true)', (select id from t_req)), 'host approves');
select is((select role::text from public.roll_members where roll_id = tests.roll(1) and user_id = tests.u('ivan')), 'member', 'approved user is a roll member');
select throws_ok(format('select public.decide_join_request(%L, false)', (select id from t_req)), 'P0001', 'invalid_input', 'cannot decide twice');
select tests.as_user('ivan');
select ok(tests.roll(1) = any (select id from public.rolls), 'approved user sees the roll');
select is((select count(*) from public.activity_events where kind = 'joined' and recipient_id = tests.u('ivan')), 1::bigint, 'requester told they are in');
select is(public.join_via_invite((select code from t_codes where name = 'approval')) ->> 'status', 'already_member', 'approved user is already_member');

-- invite permissions
select tests.as_user('cara');
select throws_ok($$select public.create_invite(tests.crew())$$, 'P0001', 'not_admin', 'members cannot create crew invites');
select ok(public.create_invite(tests.crew(), tests.roll(1)) ? 'code', 'members can invite to a roll when allow_member_invites');
select tests.as_super();
update public.rolls set allow_member_invites = false where id = tests.roll(1);
select tests.as_user('cara');
select throws_ok($$select public.create_invite(tests.crew(), tests.roll(1))$$, 'P0001', 'not_admin', 'allow_member_invites = false');
select tests.as_user('kim');
select throws_ok($$select public.create_invite(tests.crew(), tests.roll(1))$$, 'P0001', 'not_a_member', 'outsiders cannot invite');

-- in-app invites
select tests.as_super();
update public.profiles set who_can_add = 'nobody' where id = tests.u('jill');
-- kim shares no crew with alice: only an 'everyone' setting makes kim invitable (F10)
update public.profiles set who_can_add = 'everyone' where id = tests.u('kim');
delete from public.crew_members where user_id = tests.u('jill');
insert into public.blocks (blocker_id, blocked_id) values (tests.u('ivan'), tests.u('alice'));
select tests.as_user('alice');
create temp table t_res as select public.invite_users(tests.crew(), null, array[tests.u('kim'), tests.u('jill'), tests.u('cara'), tests.u('gus'), tests.u('ivan')]) as r;
select is((select r -> 'invited' from t_res), jsonb_build_array(tests.u('kim')), 'only kim is invited');
select is((select jsonb_object_agg(e ->> 'user_id', e ->> 'reason') from t_res, jsonb_array_elements(r -> 'skipped') e),
  jsonb_build_object(tests.u('jill'), 'not_accepting', tests.u('cara'), 'already_member', tests.u('gus'), 'guest', tests.u('ivan'), 'not_accepting'),
  'skipped with reasons: who_can_add nobody, member, guest, blocked (a block reads as not_accepting)');
select tests.as_user('kim');
select is((select payload ->> 'code' from public.activity_events where kind = 'invite'), (select r #>> '{invite,code}' from t_res),
  'invite activity carries the code');
select is((select payload ->> 'actor_name' from public.activity_events where kind = 'invite'), 'Alice', 'payload carries actor_name');
select is((select payload ->> 'crew_name' from public.activity_events where kind = 'invite'), 'Goa gang', 'payload carries crew_name');
select is(jsonb_array_length(public.home_feed() -> 'pending_invites'), 1, 'home_feed lists the pending in-app invite');
select is(public.respond_direct_invite((select id from public.direct_invites), false) ->> 'status', 'declined', 'decline');
select is(jsonb_array_length(public.home_feed() -> 'pending_invites'), 0, 'declined invite leaves the feed');
select is(public.respond_direct_invite((select id from public.direct_invites), true) ->> 'status', 'joined', 'accept after declining (until expiry)');
select ok(tests.crew() = any (private.my_crew_ids()), 'kim is now in the crew');

select tests.as_super();
select * from finish();
rollback;
