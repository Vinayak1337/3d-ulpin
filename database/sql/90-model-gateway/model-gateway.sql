-- Single R-MODEL-CORE pool. Policy and credential identity are pinned on first admission.
-- No source text, response envelope or secret values belong in this control table.
SELECT pg_advisory_xact_lock(hashtextextended('usp-model-core-schema-v1',0));
CREATE TABLE IF NOT EXISTS usp_model_budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  project_id text NOT NULL,
  config_hash text NOT NULL CHECK (config_hash ~ '^[a-f0-9]{64}$'),
  config jsonb NOT NULL,
  credential_hash text NOT NULL CHECK (credential_hash ~ '^[a-f0-9]{64}$'),
  blocked_reason text CHECK (blocked_reason IN ('quota_exhausted','credential_invalid','capability_denied','deficit')),
  cooldown_until timestamptz,
  next_admission_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS usp_model_calls (
  id uuid PRIMARY KEY,
  project_id text NOT NULL,
  principal_hash text NOT NULL CHECK (principal_hash ~ '^[a-f0-9]{64}$'),
  invocation_key text NOT NULL CHECK (invocation_key ~ '^[a-f0-9]{64}$'),
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 2),
  consumer text NOT NULL CHECK (consumer IN ('INGEST','ASSIST')),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[a-f0-9]{64}$'),
  config_hash text NOT NULL CHECK (config_hash ~ '^[a-f0-9]{64}$'),
  price jsonb NOT NULL,
  source_hashes jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved','dispatched','settled','released','outcome_unknown','usage_unverified')),
  reserve_micro_inr bigint NOT NULL CHECK (reserve_micro_inr >= 0),
  actual_micro_inr bigint CHECK (actual_micro_inr >= 0),
  deadline_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dispatched_at timestamptz,
  settled_at timestamptz,
  error_kind text,
  receipt jsonb,
  output jsonb,
  settlement_hash text,
  UNIQUE(project_id, principal_hash, invocation_key, attempt),
  CHECK ((state = 'settled') = (actual_micro_inr IS NOT NULL)),
  CHECK (state != 'settled' OR (receipt IS NOT NULL AND settlement_hash IS NOT NULL)),
  CHECK (state != 'released' OR dispatched_at IS NULL)
);
CREATE INDEX IF NOT EXISTS usp_model_calls_principal_day ON usp_model_calls(project_id,principal_hash,created_at);
CREATE INDEX IF NOT EXISTS usp_model_calls_exposure ON usp_model_calls(project_id,state);
CREATE INDEX IF NOT EXISTS usp_model_calls_scope ON usp_model_calls(project_id,principal_hash,scope_hash);
-- GK1: the owner's list of keys, one in use at a time. Additive only; every earlier row stays valid.
-- A call row names the key that served it by the credential hash; NULL is a row from before the list.
ALTER TABLE usp_model_calls ADD COLUMN IF NOT EXISTS credential_hash text
  CHECK (credential_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE usp_model_budget ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
ALTER TABLE usp_model_budget ADD COLUMN IF NOT EXISTS reconciled_reason text;
-- One row each time the provider says a key is used up or rejected. Only the owner's script restores one.
CREATE TABLE IF NOT EXISTS usp_model_key_marks (
  id uuid PRIMARY KEY,
  credential_hash text NOT NULL CHECK (credential_hash ~ '^[a-f0-9]{64}$'),
  secret_reference text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('quota_exhausted','credential_invalid')),
  http_status integer NOT NULL CHECK (http_status BETWEEN 400 AND 499),
  call_id uuid NOT NULL REFERENCES usp_model_calls(id),
  marked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  restored_at timestamptz,
  restored_reason text,
  CHECK ((restored_at IS NULL) = (restored_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS usp_model_key_marks_open ON usp_model_key_marks(credential_hash)
  WHERE restored_at IS NULL;
