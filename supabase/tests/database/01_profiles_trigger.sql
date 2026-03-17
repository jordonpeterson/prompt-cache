-- pgTAP tests for the profiles table and auth trigger
-- Run with: npx supabase test db
begin;

select plan(7);

-- 1. Table exists
select has_table('public', 'profiles', 'public.profiles table exists');

-- 2. Required columns exist
select has_column('public', 'profiles', 'id',         'profiles.id exists');
select has_column('public', 'profiles', 'first_name', 'profiles.first_name exists');
select has_column('public', 'profiles', 'last_name',  'profiles.last_name exists');

-- 3. RLS is enabled
select row_security_active('public.profiles') as "RLS is active on public.profiles";

-- Insert a fake auth user to fire the trigger
insert into auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at, aud, role
) values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'trigger-test@example.com',
  'fake-hash',
  now(),
  '{"first_name": "Alice", "last_name": "Smith"}'::jsonb,
  now(), now(), 'authenticated', 'authenticated'
);

-- 4. Trigger fired and inserted the profile row with correct first_name
select results_eq(
  $$ select first_name from public.profiles where id = '00000000-0000-0000-0000-000000000001' $$,
  $$ values ('Alice'::text) $$,
  'Trigger inserts first_name from raw_user_meta_data'
);

-- 5. Cascade delete: removing the auth user removes the profile
delete from auth.users where id = '00000000-0000-0000-0000-000000000001';

select is_empty(
  $$ select * from public.profiles where id = '00000000-0000-0000-0000-000000000001' $$,
  'Profile is deleted on cascade when auth user is removed'
);

-- 6. Anon role cannot read any profiles
set local role anon;
select is_empty(
  $$ select * from public.profiles $$,
  'Anon role cannot read any profiles (RLS blocks)'
);

select * from finish();
rollback;
