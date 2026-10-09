begin;
select plan(3);
select ok(not has_column_privilege('authenticated', 'public.profiles', 'storage_used_bytes', 'select'), 'storage_used_bytes not readable by clients');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'storage_quota_bytes', 'select'), 'storage_quota_bytes not readable by clients');
select ok(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'select'), 'display_name readable');
select * from finish();
rollback;
