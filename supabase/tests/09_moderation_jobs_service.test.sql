-- Moderation RPCs, visibility RPC, jobs (reveal, purge), push/purge leases, service-role wrappers, check_handle.
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


-- set_photo_visibility (Ghost Mode)
select tests.as_user('cara');
select throws_ok(format('select public.set_photo_visibility(%L, ''selected'', array[%L]::uuid[])', tests.photo(1), tests.u('eve')),
  'P0001', 'invalid_input', 'audience must belong to the roll');
select throws_ok(format('select public.set_photo_visibility(%L, ''selected'', ''{}'')', tests.photo(1)), 'P0001', 'invalid_input', 'selected needs an audience');
select lives_ok(format('select public.set_photo_visibility(%L, ''selected'', array[%L]::uuid[])', tests.photo(1), tests.u('dan')), 'ghost P1 to dan');
select tests.as_user('dan');
select ok(tests.photo(1) = any (select id from public.photos), 'audience member sees it');
select tests.as_user('alice');
select ok(not (tests.photo(1) = any (select id from public.photos)), 'others do not');
select throws_ok(format('select public.set_photo_visibility(%L, ''everyone'')', tests.photo(1)), 'P0001', 'not_admin', 'only the uploader sets visibility');
select tests.as_user('cara');
select lives_ok(format('select public.set_photo_visibility(%L, ''everyone'')', tests.photo(1)), 'back to everyone');
select tests.as_super();
select is((select count(*) from public.photo_audience where photo_id = tests.photo(1)), 0::bigint, 'audience cleared');

-- request_photo_removal / decide_removal_request
select tests.as_user('eve');
select throws_ok(format('select public.request_photo_removal(%L, ''me'')', tests.photo(1)), 'P0001', 'not_a_member', 'cannot request removal of an invisible photo');
select tests.as_user('dan');
select throws_ok(format('select public.request_photo_removal(%L, ''me'')', tests.photo(7)), 'P0001', 'not_a_member', 'sealed photos are invisible, so no request');
select is((public.request_photo_removal(tests.photo(1), 'that''s me')).status::text, 'pending', 'dan requests removal of P1');
select is((public.request_photo_removal(tests.photo(1), 'again')).reason, 'that''s me', 'repeat request returns the pending one');
select tests.as_super();
select is((select array_agg(recipient_id order by recipient_id) from public.activity_events where kind = 'removal_request'),
  array[tests.u('alice'), tests.u('bob'), tests.u('cara'), tests.u('hana')], 'removal_request activity to uploader + admins');
create temp table t_rr as select id from public.removal_requests;
grant all on t_rr to public;
select tests.as_user('dan');
select is((select count(*) from public.removal_requests), 1::bigint, 'requester sees own request');
select throws_ok(format('select public.decide_removal_request(%L, true)', (select id from t_rr)), 'P0001', 'not_admin', 'requester cannot decide');
select tests.as_user('cara');
select is((select count(*) from public.removal_requests), 1::bigint, 'uploader sees the request');
select lives_ok(format('select public.decide_removal_request(%L, true)', (select id from t_rr)), 'uploader approves');
select is((select status::text from public.photos where id = tests.photo(1)), 'removed', 'photo removed');
select throws_ok(format('select public.decide_removal_request(%L, false)', (select id from t_rr)), 'P0001', 'invalid_input', 'already decided');
select tests.as_user('dan');
select is((select payload ->> 'status' from public.activity_events where kind = 'removal_request'), 'approved', 'requester told it was approved');

-- report / decide_report
select tests.as_user('eve');
select throws_ok(format('select public.report(''photo'', %L, ''spam'')', tests.photo(3)), 'P0001', 'not_a_member', 'cannot report an invisible photo');
select tests.as_user('cara');
select is((public.report('photo', tests.photo(3), 'not ok')).crew_id, tests.crew(), 'report a visible photo (crew scoped)');
select is((public.report('user', tests.u('dan'), 'rude')).crew_id, tests.crew(), 'report a crewmate');
select throws_ok(format('select public.report(''user'', %L, ''x'')', tests.u('eve')), 'P0001', 'not_a_member', 'cannot report strangers');
select throws_ok(format('select public.report(''photo'', %L, ''x'')', tests.photo(10)), 'P0001', 'invalid_input', 'cannot report own photo');
select throws_ok(format('select public.report(''photo'', %L, %L)', tests.photo(3), repeat('x', 501)), 'P0001', 'invalid_input', 'reason <= 500');
select tests.as_user('dan');
select is((select count(*) from public.reports), 0::bigint, 'members do not see others'' reports');
select tests.as_user('bob');
select is((select count(*) from public.reports), 2::bigint, 'cohost sees the moderation queue');
select lives_ok(format('select public.decide_report(%L, ''remove'')', (select id from public.reports where target = 'photo')), 'cohost removes the reported photo');
select tests.as_super();
select is((select status::text from public.photos where id = tests.photo(3)), 'removed', 'reported photo removed');
select is((select status::text from public.reports where target = 'photo'), 'approved', 'report closed');
select tests.as_user('bob');
select lives_ok(format('select public.decide_report(%L, ''dismiss'')', (select id from public.reports where target = 'user')), 'dismiss');
select throws_ok(format('select public.decide_report(%L, ''dismiss'')', (select id from public.reports where target = 'user')), 'P0001', 'invalid_input', 'decided once');
select tests.as_user('cara');
select throws_ok(format('select public.decide_report(%L, ''remove'')', (select id from public.reports where target = 'user')), 'P0001', 'not_admin', 'members cannot decide reports');

-- activity read markers
select tests.as_user('dan');
select lives_ok('select public.mark_activity_read(null)', 'mark all read');
select is((select count(*) from public.activity_events where read_at is null), 0::bigint, 'all read');

-- check_handle
select is((public.check_handle('alice') ->> 'available')::boolean, false, 'taken handle unavailable');
select is(jsonb_array_length(public.check_handle('alice') -> 'suggestions'), 3, 'three suggestions');
select ok((select bool_and(s ~ '^[a-z0-9._]{3,24}$') from jsonb_array_elements_text(public.check_handle('alice') -> 'suggestions') s), 'suggestions are valid handles');
select is((public.check_handle('dan') ->> 'available')::boolean, true, 'your own handle counts as available');
select is((public.check_handle('Brand.New') ->> 'available')::boolean, true, 'free handle (case-folded)');
select is((public.check_handle('a!') ->> 'available')::boolean, false, 'invalid handle unavailable');

-- push dispatch lease (service role)
select tests.as_super();
delete from public.activity_events;
insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[dan]', tests.u('dan'), 'android');
insert into public.notification_prefs (user_id, uploads) values (tests.u('dan'), false);
update public.crew_members set muted = true where user_id = tests.u('dan');
select private.emit_activity(array[tests.u('dan'), tests.u('cara')], tests.u('alice'), tests.crew(), tests.roll(1), null, 'mention', '{}', true);
select private.emit_activity(array[tests.u('dan')], tests.u('alice'), tests.crew(), null, null, 'joined', '{}', false);
select private.emit_activity(array[tests.u('dan')], tests.u('alice'), tests.crew(), tests.roll(1), null, 'upload_batch', '{"count":3}', false);
select tests.as_service();
create temp table t_claim as select * from public.svc_claim_push_batch(100);
select is((select count(*) from t_claim), 3::bigint, 'claims instant rows + upload digests, not plain non-instant rows');
select is((select tokens from t_claim where recipient_id = tests.u('dan') and kind = 'mention'), array['ExponentPushToken[dan]'], 'recipient tokens attached');
select is((select prefs ->> 'uploads' from t_claim where recipient_id = tests.u('dan') limit 1), 'false', 'recipient prefs attached');
select is((select prefs ->> 'games' from t_claim where recipient_id = tests.u('cara') limit 1), 'true', 'default prefs when no row');
select is((select muted from t_claim where recipient_id = tests.u('dan') and kind = 'mention'), true, 'mute flag attached');
select is((select payload ->> 'actor_name' from t_claim limit 1), 'Alice', 'payload has actor_name');
select is((select count(*) from public.svc_claim_push_batch(100)), 0::bigint, 'leased rows are not handed out twice');
select lives_ok(format('select public.svc_mark_pushed(array[%s]::bigint[])', (select string_agg(id::text, ',') from t_claim where kind = 'mention')), 'mark mentions pushed');
select tests.as_super();
update public.activity_events set push_claimed_at = now() - interval '3 minutes';
select tests.as_service();
select is((select array_agg(kind::text) from public.svc_claim_push_batch(100)), array['upload_batch'], 'unmarked rows come back after the 2-minute lease');

-- media purge queue (service role)
select tests.as_super();
delete from public.media_purge_queue;
select tests.as_service();
select lives_ok($$insert into public.media_purge_queue (key) values ('a/x.jpg') on conflict (key) do nothing$$, 'service role upserts purge keys');
select is(public.svc_enqueue_user_media(tests.u('cara')), 3 * (select count(*)::int from public.photos where uploader_id = tests.u('cara')),
  'svc_enqueue_user_media queues 3 keys per photo');
select is((select count(*) from public.svc_media_purge_claim(2)), 2::bigint, 'claim respects the limit');
select is((select count(*) from public.svc_media_purge_claim(1000)), (select count(*) - 2 from public.media_purge_queue), 'claimed keys are leased');
select lives_ok($$select public.svc_media_purge_done(array['a/x.jpg'])$$, 'done deletes keys');
select is((select count(*) from public.media_purge_queue where key = 'a/x.jpg'), 0::bigint, 'key gone');

-- service role table access the edge functions rely on
select ok(has_table_privilege('service_role', 'public.photos', 'select,insert,update,delete'), 'service_role: photos CRUD');
select ok(has_table_privilege('service_role', 'public.media_uploads', 'select,insert,update,delete'), 'service_role: media_uploads CRUD');
select ok(has_table_privilege('service_role', 'public.tags', 'select') and has_table_privilege('service_role', 'public.app_settings', 'select'),
  'service_role reads tags + app_settings');
select lives_ok(format($$insert into public.media_uploads (photo_id, multipart_upload_id, part_size, parts, display_bytes, thumb_bytes, expires_at)
                         values (%L, 'up-1', 8388608, 3, 1000, 100, now() + interval '1 day')$$, tests.photo(6)), 'service role writes media_uploads');

-- svc_upload_context
select is(public.svc_upload_context(tests.u('gus'), tests.roll(1)) ->> 'can_upload', 'true', 'guest can upload');
select is(public.svc_upload_context(tests.u('gus'), tests.roll(1)) ->> 'is_guest', 'true', 'is_guest');
select is(public.svc_upload_context(tests.u('gus'), tests.roll(1)) ->> 'guest_photo_count', '1', 'guest photo count');
select is(public.svc_upload_context(tests.u('gus'), tests.roll(1)) ->> 'guest_max_photos_per_roll', '300', 'guest cap');
select is(public.svc_upload_context(tests.u('eve'), tests.roll(1)) ->> 'can_upload', 'false', 'outsider cannot upload');
select is(public.svc_upload_context(tests.u('alice'), tests.roll(1)) ->> 'is_admin', 'true', 'admin flag');
select is(public.svc_upload_context(tests.u('cara'), tests.roll(1)) ->> 'crew_id', tests.crew()::text, 'crew_id');
select is(public.svc_upload_context(tests.u('cara'), tests.roll(1)) ->> 'max_photo_bytes', '52428800', 'max_photo_bytes from settings');
select is(public.svc_upload_context(tests.u('cara'), tests.roll(1)) -> 'storage_limit_bytes', 'null'::jsonb, 'no storage limit');
select is(public.svc_upload_context(tests.u('hana'), tests.roll(3)) ->> 'can_upload', 'false', 'honoree cannot upload to their surprise roll');
select is(public.svc_upload_context(tests.u('cara'), gen_random_uuid()) ->> 'crew_id', null, 'missing roll -> crew_id null');

-- svc_account_summary
select is(public.svc_account_summary(tests.u('alice')) -> 'sole_host_crews', jsonb_build_array(jsonb_build_object('id', tests.crew(), 'name', 'Goa gang', 'member_count', 5)),
  'alice is sole host of a crew with members');
select is(public.svc_account_summary(tests.u('cara')) -> 'sole_host_crews', '[]'::jsonb, 'members have nothing to transfer');
select is((public.svc_account_summary(tests.u('cara')) ->> 'photo_keys_count')::int, 3 * (select count(*)::int from public.photos where uploader_id = tests.u('cara')),
  'photo_keys_count');

-- call_push_dispatch without pg_net / vault is a no-op
select tests.as_super();
select is(private.call_push_dispatch(), null, 'call_push_dispatch skips gracefully without pg_net/vault');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('fanout_upload_batches', 'purge_deleted', 'fire_reveals', 'claim_push_batch', 'mark_pushed')),
  5::bigint, 'job functions exist');

-- fire_reveals
delete from public.activity_events;
update public.rolls set reveal_at = now() - interval '1 minute' where id = tests.roll(3);
select ok(private.fire_reveals() > 0, 'fire_reveals emits for rolls that just opened');
select is((select payload ->> 'mine' from public.activity_events where kind = 'reveal' and recipient_id = tests.u('alice')), '1', 'reveal payload: mine');
select is((select payload ->> 'contributors' from public.activity_events where kind = 'reveal' and recipient_id = tests.u('hana')), '1',
  'the honoree gets the reveal');
select is((select payload ->> 'count' from public.activity_events where kind = 'reveal' limit 1), '1', 'reveal payload: count');
select is(private.fire_reveals(), 0, 'reveals fire once');

-- purge_deleted
select tests.as_super();
update public.photos set removed_at = now() - interval '8 days' where id = tests.photo(4);
delete from public.media_purge_queue;
select lives_ok('select private.purge_deleted()', 'purge runs');
select is((select count(*) from public.photos where id = tests.photo(4)), 0::bigint, 'removed photo hard-deleted after the 7-day grace');
select ok((select count(*) from public.media_purge_queue) >= 3, 'its R2 keys are queued');
update public.crews set deleted_at = now() - interval '31 days', purge_after = now() - interval '1 day' where id = tests.crew();
select lives_ok('select private.purge_deleted()', 'purge deleted crew');
select is((select count(*) from public.photos), 0::bigint, 'crew purge cascades to photos');
select is((select count(*) from public.rolls), 0::bigint, 'and rolls');
select ok((select count(*) from public.media_purge_queue) >= 27, 'every photo''s keys queued for R2 deletion');

select tests.as_super();
select * from finish();
rollback;
