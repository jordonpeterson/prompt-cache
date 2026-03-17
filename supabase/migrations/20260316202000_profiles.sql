-- Profiles table: one row per auth.users entry, auto-created via trigger
create table public.profiles (
  id         uuid        not null references auth.users (id) on delete cascade,
  first_name text,
  last_name  text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id)
);

alter table public.profiles enable row level security;

-- Auto-update updated_at on edit (reuse the existing helper function)
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function update_updated_at();

-- Trigger function: fires on new auth.users inserts
-- security definer + empty search_path = executes as owner (postgres)
-- with a fixed, unpoisonable search path
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name'
  );
  return new;
end;
$$;

-- Drop first to avoid duplicate-trigger errors on re-run
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RLS policies (subquery form caches auth.uid() once per statement)
create policy "Users can view own profile"
  on public.profiles for select to authenticated
  using ( (select auth.uid()) = id );

create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );
