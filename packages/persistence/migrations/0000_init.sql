CREATE TABLE IF NOT EXISTS pr_records (
  id text PRIMARY KEY,
  repo text NOT NULL,
  number integer NOT NULL,
  author text NOT NULL,
  enrollment text NOT NULL,
  matched_by text,
  campaign_key text,
  campaign_label text,
  priority integer,
  end_action jsonb,
  lifecycle_state text NOT NULL,
  remediation jsonb,
  escalation jsonb,
  config_overrides jsonb,
  last_interaction_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL,
  terminal_at timestamptz,
  next_reconcile_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pr_records_due_idx ON pr_records (next_reconcile_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  pr_id text,
  type text NOT NULL,
  payload jsonb NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_pr_idx ON audit_events (pr_id);

CREATE TABLE IF NOT EXISTS config_snapshots (
  pr_id text PRIMARY KEY,
  effective jsonb NOT NULL,
  provenance jsonb NOT NULL,
  computed_at timestamptz NOT NULL
);

-- owned by the delivery package
CREATE TABLE IF NOT EXISTS delivery_buffer (
  key text PRIMARY KEY,
  items jsonb NOT NULL,
  first_at timestamptz NOT NULL,
  quiet_until timestamptz NOT NULL,
  hard_cap_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_sent (
  dedup_key text PRIMARY KEY,
  sent_at timestamptz NOT NULL
);
