-- ScoutLog database schema

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  subscription_tier text default 'free' check (subscription_tier in ('free', 'pro')),
  subscription_expires_at timestamptz,
  temperature_unit text default 'F' check (temperature_unit in ('F', 'C')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Sightings
create table public.sightings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Location
  latitude double precision not null,
  longitude double precision not null,
  altitude double precision,
  compass_heading double precision,

  -- Time
  sighted_at timestamptz not null,
  time_period text check (time_period in ('Dawn','Morning','Midday','Afternoon','Dusk','Night')),

  -- Animal
  species text not null,
  count integer default 1,
  activity text default 'Unknown' check (activity in ('Feeding','Bedded','Traveling','Rutting','Watering','Unknown')),
  sighting_type text default 'LiveAnimal' check (sighting_type in ('LiveAnimal','Tracks','Scrape','Rub','Scat','Wallow','Bed','Other')),

  -- Weather (auto-filled from Open-Meteo)
  weather_condition text,
  temperature double precision,
  wind_speed double precision,
  wind_direction text,
  humidity double precision,
  barometric_pressure double precision,
  moon_phase text,
  sunrise time,
  sunset time,

  -- AI
  ai_species_guess text,
  ai_confidence integer check (ai_confidence between 0 and 100),
  ai_alternatives jsonb,
  was_overridden boolean default false,

  -- Media
  photos jsonb default '[]',

  -- User input
  notes text,
  source text default 'Photo' check (source in ('Photo','Manual','TrailCam')),
  is_public boolean default false,

  -- Sync
  device_id text,
  client_updated_at timestamptz not null default now(),

  -- Meta
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index idx_sightings_user on public.sightings(user_id);
create index idx_sightings_species on public.sightings(species);
create index idx_sightings_sighted_at on public.sightings(sighted_at);

-- Updated_at trigger
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger sightings_updated_at
  before update on public.sightings
  for each row execute function public.update_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();

-- Profile auto-creation trigger
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS
alter table public.sightings enable row level security;
alter table public.profiles enable row level security;

-- Sighting policies
create policy "Users read own sightings"
  on public.sightings for select
  using (auth.uid() = user_id);

create policy "Anyone reads public sightings"
  on public.sightings for select
  using (is_public = true);

create policy "Users insert own sightings"
  on public.sightings for insert
  with check (auth.uid() = user_id);

create policy "Users update own sightings"
  on public.sightings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own sightings"
  on public.sightings for delete
  using (auth.uid() = user_id);

-- Profile policies
create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Storage bucket for photos
insert into storage.buckets (id, name, public) values ('sighting-photos', 'sighting-photos', false);

-- Storage policies
create policy "Users upload own photos"
  on storage.objects for insert
  with check (
    bucket_id = 'sighting-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users read own photos"
  on storage.objects for select
  using (
    bucket_id = 'sighting-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users delete own photos"
  on storage.objects for delete
  using (
    bucket_id = 'sighting-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );
