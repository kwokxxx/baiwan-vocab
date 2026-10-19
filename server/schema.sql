CREATE TABLE IF NOT EXISTS shared_entries (
  id text PRIMARY KEY,
  entry jsonb NOT NULL,
  position integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS study_states (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_receipts (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  mutation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mutation_id)
);
CREATE INDEX IF NOT EXISTS sync_receipts_created ON sync_receipts(created_at);

CREATE TABLE IF NOT EXISTS guest_backups (
  key_hash text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS backup_rate_limits (
  bucket text PRIMARY KEY,
  attempts integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_archives (
  catalog_version text PRIMARY KEY,
  entries jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS study_state_archives (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  catalog_version text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, catalog_version)
);

