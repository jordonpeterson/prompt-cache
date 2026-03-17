-- pgTAP tests for the api_keys table
-- Run with: npx supabase test db
begin;

select plan(13);

-- 1. Table exists
select has_table('public', 'api_keys', 'public.api_keys table exists');

-- 2. Required columns exist
select has_column('public', 'api_keys', 'user_id',                 'api_keys.user_id exists');
select has_column('public', 'api_keys', 'name',                    'api_keys.name exists');
select has_column('public', 'api_keys', 'permissions',             'api_keys.permissions exists');
select has_column('public', 'api_keys', 'number_of_contributions', 'api_keys.number_of_contributions exists');
select has_column('public', 'api_keys', 'created_at',              'api_keys.created_at exists');
select has_column('public', 'api_keys', 'updated_at',              'api_keys.updated_at exists');

-- 3. RLS is enabled
select row_security_active('public.api_keys') as "RLS is active on public.api_keys";

-- 4. permissions check constraint rejects invalid values
select throws_ok(
  $$ insert into public.api_keys (name, permissions) values ('bad-key', 'ADMIN') $$,
  '23514',
  null,
  'permissions check constraint rejects invalid value ADMIN'
);

-- Insert a valid row as service_role for the remaining tests
set local role service_role;

insert into public.api_keys (user_id, name, permissions)
values ('00000000-0000-0000-0000-000000000002'::uuid, 'test-key', 'READ');

-- 5. number_of_contributions defaults to 0
select results_eq(
  $$ select number_of_contributions from public.api_keys where user_id = '00000000-0000-0000-0000-000000000002' $$,
  $$ values (0) $$,
  'number_of_contributions defaults to 0 on insert'
);

-- 6. updated_at trigger fires on update
-- Capture the pre-update timestamp in a temp table, sleep briefly so clock
-- advances, update the row, then assert the new updated_at is strictly greater.
create temp table _api_keys_ts_before as
  select updated_at from public.api_keys
  where user_id = '00000000-0000-0000-0000-000000000002';

select pg_sleep(0.05);

update public.api_keys
  set name = 'test-key-updated'
where user_id = '00000000-0000-0000-0000-000000000002';

select ok(
  (
    select a.updated_at > b.updated_at
    from public.api_keys a,
         _api_keys_ts_before b
    where a.user_id = '00000000-0000-0000-0000-000000000002'
  ),
  'updated_at is advanced by the api_keys_updated_at trigger on row update'
);

-- 7. Anon role cannot read any rows (RLS blocks)
reset role;
set local role anon;

select is_empty(
  $$ select * from public.api_keys $$,
  'Anon role cannot read any api_keys rows (RLS blocks)'
);

-- 8. Service role can insert and select rows
reset role;
set local role service_role;

insert into public.api_keys (user_id, name, permissions)
values ('00000000-0000-0000-0000-000000000003'::uuid, 'service-key', 'WRITE');

select results_eq(
  $$ select name from public.api_keys where user_id = '00000000-0000-0000-0000-000000000003' $$,
  $$ values ('service-key'::text) $$,
  'Service role can insert and select api_keys rows'
);

reset role;

select * from finish();
rollback;
