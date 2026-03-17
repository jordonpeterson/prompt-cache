# prompt-cache

A Supabase-backed service for storing and semantically searching cached prompt results using OpenAI embeddings.

## Stack

- **Database**: Supabase (Postgres + pgvector)
- **Edge Functions**: Deno (Supabase Edge Functions)
- **Embeddings**: OpenAI `text-embedding-3-small` (1536 dimensions)

## Local Development

```bash
# Start local Supabase stack
npx supabase start

# Reset DB and reapply all migrations
npx supabase db reset

# Run via Docker if psql not installed locally
docker exec supabase_db_prompt-cache psql -U postgres -d postgres -c "<SQL>"
```

Local URLs after `supabase start`:
- API: `http://127.0.0.1:54321`
- Studio: `http://127.0.0.1:54323`
- DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

## Database Schema

### `api_keys`
Represents API consumers with access credentials.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK | Auto-generated |
| `name` | text | Display name |
| `permissions` | text | `READ` or `WRITE` |
| `number_of_contributions` | int | Defaults to 0 |
| `created_at` | timestamptz | Set on insert |
| `updated_at` | timestamptz | Auto-updated via trigger |

### `results`
Cached prompt results with semantic embeddings.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `title` | text | |
| `description` | text | |
| `embedding` | vector(1536) | OpenAI embedding |
| `contributor_id` | uuid FK | → `api_keys.user_id` |
| `number_of_queries` | int | Defaults to 0 |
| `created_at` | timestamptz | Set on insert |
| `updated_at` | timestamptz | Auto-updated via trigger |

### `input_jobs`
Tracks incoming research submissions through their processing lifecycle.

| Column | Type | Notes |
|---|---|---|
| `job_id` | uuid PK | Auto-generated |
| `research_content` | text | Raw input content |
| `contributor_id` | uuid FK | → `api_keys.user_id` |
| `status` | text | `NEW` \| `IN_PROCESS` \| `REJECTED` \| `ACCEPTED` |
| `result_id` | uuid FK (nullable) | → `results.id`, set when accepted |
| `created_at` | timestamptz | Set on insert |
| `updated_at` | timestamptz | Auto-updated via trigger |

### `profiles`
One row per `auth.users` entry, auto-created by the `on_auth_user_created` trigger.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | FK → `auth.users(id)` ON DELETE CASCADE |
| `first_name` | text | From `raw_user_meta_data` at signup |
| `last_name` | text | From `raw_user_meta_data` at signup |
| `avatar_url` | text | Nullable |
| `created_at` | timestamptz | Set on insert |
| `updated_at` | timestamptz | Auto-updated via trigger |

RLS: authenticated users can view/update their own row only.

### `documents` (legacy/search index)
Stores documents for vector similarity search.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `content` | text | |
| `metadata` | jsonb | |
| `embedding` | vector(1536) | HNSW indexed |
| `created_at` | timestamptz | |

## Migrations

All migrations live in `supabase/migrations/`. Apply with `npx supabase db reset`.

| File | Description |
|---|---|
| `20260316201548_vector_search.sql` | pgvector extension, `documents` table, `match_documents` RPC, RLS |
| `20260316201600_schema.sql` | `api_keys`, `results`, `input_jobs` tables, RLS, HNSW indexes, triggers |
| `20260316202000_profiles.sql` | `profiles` table, `handle_new_user` trigger, RLS |

## Edge Functions

### `search`
Performs semantic similarity search over the `documents` table.

- **Auth**: `x-api-key` header validated against `SEARCH_API_KEY` env var
- **Method**: `POST`
- **Body**: `{ query: string, match_count?: number, match_threshold?: number }`
- **Response**: `{ results: [{ id, content, metadata, similarity }] }`

Required secrets:
```bash
npx supabase secrets set SEARCH_API_KEY=<key>
npx supabase secrets set OPENAI_API_KEY=<key>
```

## Tests

pgTAP tests live in `supabase/tests/database/`. Run with:
```bash
npx supabase test db
```

| File | Coverage |
|---|---|
| `01_profiles_trigger.sql` | profiles table shape, trigger insert, cascade delete, RLS anon block |

## RLS

All tables use RLS with `service_role`-only access policies. The edge functions use the `SUPABASE_SERVICE_ROLE_KEY` env var and therefore bypass RLS as intended.
