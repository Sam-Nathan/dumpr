-- Migration 15: the exact SQL shape of a PostgREST upsert (ON CONFLICT DO UPDATE SET every payload column)
-- succeeds for own rows on reactions / message_reactions / notification_prefs and still rejects other users
-- and invisible targets. Same scenario as the other files (generated, rolled back).
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

-- helper: ids of the seeded messages
create function tests.msg(p_body text) returns uuid language sql stable as $$
  select id from public.messages where body = p_body $$;
grant execute on function tests.msg(text) to public;

-- ---------------------------------------------------------------------------------------------
-- reactions: upsert (photo_id, user_id, kind)
-- ---------------------------------------------------------------------------------------------
select tests.as_user('dan');
select lives_ok($$insert into public.reactions (photo_id, user_id, kind) values (tests.photo(1), tests.u('dan'), 'ICONIC')
  on conflict (photo_id, user_id) do update set photo_id = excluded.photo_id, user_id = excluded.user_id, kind = excluded.kind$$,
  'reactions upsert (insert path)');
select lives_ok($$insert into public.reactions (photo_id, user_id, kind) values (tests.photo(1), tests.u('dan'), 'LMAO')
  on conflict (photo_id, user_id) do update set photo_id = excluded.photo_id, user_id = excluded.user_id, kind = excluded.kind$$,
  'reactions upsert (update path)');
select is((select kind::text from public.reactions where photo_id = tests.photo(1) and user_id = tests.u('dan')), 'LMAO', 'reaction replaced');
select is((select count(*) from public.reactions where photo_id = tests.photo(1)), 1::bigint, 'still one reaction row');
select throws_ok($$insert into public.reactions (photo_id, user_id, kind) values (tests.photo(1), tests.u('cara'), 'HEART')
  on conflict (photo_id, user_id) do update set photo_id = excluded.photo_id, user_id = excluded.user_id, kind = excluded.kind$$,
  '42501', null, 'reactions upsert cannot act as someone else');
select throws_ok($$insert into public.reactions (photo_id, user_id, kind) values (tests.photo(7), tests.u('dan'), 'HEART')
  on conflict (photo_id, user_id) do update set photo_id = excluded.photo_id, user_id = excluded.user_id, kind = excluded.kind$$,
  '42501', null, 'reactions upsert cannot target an invisible photo (insert path)');
-- cara reacted to P1; dan's upsert with the same key cannot touch her row (his own row is the conflict row)
select tests.as_user('cara');
select lives_ok($$insert into public.reactions (photo_id, user_id, kind) values (tests.photo(1), tests.u('cara'), 'HEART')
  on conflict (photo_id, user_id) do update set photo_id = excluded.photo_id, user_id = excluded.user_id, kind = excluded.kind$$,
  'cara reacts via upsert');
select tests.as_user('dan');
select is((select kind::text from public.reactions where photo_id = tests.photo(1) and user_id = tests.u('cara')), 'HEART', 'cara row untouched by dan');
-- re-pointing an existing own row at an invisible photo is rejected like a fresh insert; at a visible one it works
select throws_ok($$update public.reactions set photo_id = tests.photo(7) where photo_id = tests.photo(1) and user_id = tests.u('dan')$$,
  '42501', null, 'cannot re-point my reaction at a photo I cannot see');
select lives_ok($$update public.reactions set photo_id = tests.photo(3) where photo_id = tests.photo(1) and user_id = tests.u('dan')$$,
  're-pointing at a visible photo equals a fresh insert');
select throws_ok($$update public.reactions set user_id = tests.u('cara') where photo_id = tests.photo(3) and user_id = tests.u('dan')$$,
  '42501', null, 'cannot hand my reaction to someone else');
-- guests never react
select tests.as_user('gus');
select throws_ok($$insert into public.reactions (photo_id, user_id, kind) values (tests.photo(1), tests.u('gus'), 'HEART')
  on conflict (photo_id, user_id) do update set photo_id = excluded.photo_id, user_id = excluded.user_id, kind = excluded.kind$$,
  '42501', null, 'guests cannot react via upsert');

-- ---------------------------------------------------------------------------------------------
-- message_reactions: upsert (message_id, user_id, kind)
-- ---------------------------------------------------------------------------------------------
select tests.as_user('dan');
select lives_ok(format($$insert into public.message_reactions (message_id, user_id, kind) values (%L, %L, 'ICONIC')
  on conflict (message_id, user_id) do update set message_id = excluded.message_id, user_id = excluded.user_id, kind = excluded.kind$$,
  tests.msg('roll hello'), tests.u('dan')), 'message_reactions upsert (insert path)');
select lives_ok(format($$insert into public.message_reactions (message_id, user_id, kind) values (%L, %L, 'SAME')
  on conflict (message_id, user_id) do update set message_id = excluded.message_id, user_id = excluded.user_id, kind = excluded.kind$$,
  tests.msg('roll hello'), tests.u('dan')), 'message_reactions upsert (update path)');
select is((select kind::text from public.message_reactions where message_id = tests.msg('roll hello') and user_id = tests.u('dan')), 'SAME', 'message reaction replaced');
select throws_ok(format($$insert into public.message_reactions (message_id, user_id, kind) values (%L, %L, 'SAME')
  on conflict (message_id, user_id) do update set message_id = excluded.message_id, user_id = excluded.user_id, kind = excluded.kind$$,
  tests.msg('roll hello'), tests.u('cara')), '42501', null, 'message_reactions upsert cannot act as someone else');
-- hana is the honoree of the hidden Surprise Roll: she cannot see its chat, so she cannot react to it
select tests.as_user('hana');
select lives_ok(format($$insert into public.message_reactions (message_id, user_id, kind) values (%L, %L, 'HEART')
  on conflict (message_id, user_id) do update set message_id = excluded.message_id, user_id = excluded.user_id, kind = excluded.kind$$,
  tests.msg('roll hello'), tests.u('hana')), 'hana reacts to a visible message via upsert');
select throws_ok(format($$insert into public.message_reactions (message_id, user_id, kind) values (%L, %L, 'HEART')
  on conflict (message_id, user_id) do update set message_id = excluded.message_id, user_id = excluded.user_id, kind = excluded.kind$$,
  tests.msg('surprise plans'), tests.u('hana')), '42501', null, 'message_reactions upsert cannot target an invisible message');
select throws_ok(format($$update public.message_reactions set message_id = %L where message_id = %L and user_id = %L$$,
  tests.msg('surprise plans'), tests.msg('roll hello'), tests.u('hana')), '42501', null,
  'cannot re-point my message reaction at a message I cannot see');
select lives_ok(format($$update public.message_reactions set message_id = %L where message_id = %L and user_id = %L$$,
  tests.msg('crew hello'), tests.msg('roll hello'), tests.u('hana')),
  're-pointing at a visible message equals a fresh insert');
select throws_ok(format($$update public.message_reactions set user_id = %L where message_id = %L and user_id = %L$$,
  tests.u('cara'), tests.msg('crew hello'), tests.u('hana')), '42501', null, 'cannot hand my message reaction to someone else');
select tests.as_user('eve');
select throws_ok(format($$insert into public.message_reactions (message_id, user_id, kind) values (%L, %L, 'HEART')
  on conflict (message_id, user_id) do update set message_id = excluded.message_id, user_id = excluded.user_id, kind = excluded.kind$$,
  tests.msg('crew hello'), tests.u('eve')), '42501', null, 'outsiders cannot react via upsert');

-- ---------------------------------------------------------------------------------------------
-- notification_prefs: upsert (user_id + every pref column)
-- ---------------------------------------------------------------------------------------------
select tests.as_user('dan');
select lives_ok($$insert into public.notification_prefs (user_id, invites, uploads, chats, reveals, games)
  values (tests.u('dan'), true, true, true, true, false)
  on conflict (user_id) do update set user_id = excluded.user_id, invites = excluded.invites, uploads = excluded.uploads,
    chats = excluded.chats, reveals = excluded.reveals, games = excluded.games$$, 'notification_prefs upsert (insert path)');
select lives_ok($$insert into public.notification_prefs (user_id, invites, uploads, chats, reveals, games)
  values (tests.u('dan'), true, false, true, false, false)
  on conflict (user_id) do update set user_id = excluded.user_id, invites = excluded.invites, uploads = excluded.uploads,
    chats = excluded.chats, reveals = excluded.reveals, games = excluded.games$$, 'notification_prefs upsert (update path)');
select is((select (uploads, reveals)::text from public.notification_prefs where user_id = tests.u('dan')), '(f,f)', 'prefs replaced');
select throws_ok($$insert into public.notification_prefs (user_id, invites, uploads, chats, reveals, games)
  values (tests.u('cara'), false, false, false, false, false)
  on conflict (user_id) do update set user_id = excluded.user_id, invites = excluded.invites, uploads = excluded.uploads,
    chats = excluded.chats, reveals = excluded.reveals, games = excluded.games$$, '42501', null, 'cannot write someone else''s prefs');
select throws_ok($$update public.notification_prefs set user_id = tests.u('cara') where user_id = tests.u('dan')$$,
  '42501', null, 'cannot hand my prefs to someone else');

-- ---------------------------------------------------------------------------------------------
-- grants stay narrow
-- ---------------------------------------------------------------------------------------------
select ok(not has_column_privilege('authenticated', 'public.reactions', 'created_at', 'update'), 'reactions.created_at is not updatable');
select ok(not has_column_privilege('authenticated', 'public.message_reactions', 'created_at', 'update'), 'message_reactions.created_at is not updatable');
select ok(not has_column_privilege('authenticated', 'public.notification_prefs', 'updated_at', 'update'), 'notification_prefs.updated_at is not updatable');
select ok(not has_column_privilege('authenticated', 'public.push_tokens', 'user_id', 'update'), 'push_tokens.user_id is not updatable (register_push_token RPC)');

select tests.as_super();
select * from finish();
rollback;
