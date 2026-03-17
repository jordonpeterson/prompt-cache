create extension if not exists vector;

create table documents (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  metadata jsonb,
  embedding vector(1536),
  created_at timestamptz default now()
);

alter table documents enable row level security;

-- Service role (used by the edge function) can read all documents
create policy "service role can read documents"
  on documents for select
  using (auth.role() = 'service_role');

-- Service role can insert documents
create policy "service role can insert documents"
  on documents for insert
  with check (auth.role() = 'service_role');

create index on documents using hnsw (embedding vector_cosine_ops);

create or replace function match_documents(
  query_embedding vector(1536),
  match_count int default 10,
  match_threshold float default 0.7
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable security invoker as $$
  select id, content, metadata,
         1 - (embedding <=> query_embedding) as similarity
  from documents
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
