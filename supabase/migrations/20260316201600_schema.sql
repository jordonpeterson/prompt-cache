-- API Keys table
create table api_keys (
  user_id uuid primary key default gen_random_uuid(),
  permissions text not null check (permissions in ('READ', 'WRITE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  number_of_contributions int not null default 0,
  name text not null
);

-- Results table
create table results (
  id uuid primary key default gen_random_uuid(),
  embedding vector(1536),
  contributor_id uuid not null references api_keys(user_id),
  title text not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  number_of_queries int not null default 0
);

-- RLS
alter table api_keys enable row level security;
alter table results enable row level security;

create policy "service role full access on api_keys"
  on api_keys for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role full access on results"
  on results for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Indexes
create index on results (contributor_id);
create index on results using hnsw (embedding vector_cosine_ops);

-- Auto-update updated_at on edit
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger api_keys_updated_at
  before update on api_keys
  for each row execute function update_updated_at();

create trigger results_updated_at
  before update on results
  for each row execute function update_updated_at();

-- Input Jobs table
create table input_jobs (
  job_id uuid primary key default gen_random_uuid(),
  research_content text not null,
  contributor_id uuid not null references api_keys(user_id),
  status text not null default 'NEW' check (status in ('NEW', 'IN_PROCESS', 'REJECTED', 'ACCEPTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  result_id uuid references results(id)
);

alter table input_jobs enable row level security;

create policy "service role full access on input_jobs"
  on input_jobs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index on input_jobs (contributor_id);
create index on input_jobs (result_id);
create index on input_jobs (status);

create trigger input_jobs_updated_at
  before update on input_jobs
  for each row execute function update_updated_at();
