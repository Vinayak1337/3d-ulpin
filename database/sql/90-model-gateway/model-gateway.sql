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
