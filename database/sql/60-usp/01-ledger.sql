CREATE TABLE IF NOT EXISTS usp_migration_ledger (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )