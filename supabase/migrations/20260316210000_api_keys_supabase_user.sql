alter table api_keys
  add column supabase_user_id uuid unique references auth.users(id) on delete set null;
create index on api_keys (supabase_user_id);
