alter table api_keys add column key uuid not null default gen_random_uuid();
