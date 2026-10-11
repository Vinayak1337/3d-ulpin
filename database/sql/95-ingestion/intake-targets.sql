-- E1: the officer's one confirmation and the targets a drafted package offers for a card. Additive only.
CREATE TABLE IF NOT EXISTS usp_intake_confirmations (
  confirmation_id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  request_key uuid NOT NULL,
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
  subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 256),
  acknowledgement text NOT NULL CHECK(length(acknowledgement) BETWEEN 1 AND 500),
  packages jsonb NOT NULL CHECK(jsonb_typeof(packages) = 'array' AND jsonb_array_length(packages) BETWEEN 1 AND 100),
  targets uuid[] NOT NULL CHECK(cardinality(targets) <= 100),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 512),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK(expires_at > created_at),
  UNIQUE(case_id, request_key)
);
CREATE TABLE IF NOT EXISTS usp_intake_targets (
  target_id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  anchor_item_id uuid NOT NULL,
  package_id uuid NOT NULL REFERENCES import_packages(id),
  feature_id uuid NOT NULL,
  locator text NOT NULL CHECK(locator ~ '^feature .' AND length(locator) <= 1024),
  kind text NOT NULL CHECK(kind IN ('building')),
  stage smallint NOT NULL CHECK(stage BETWEEN 1 AND 8),
  readiness text NOT NULL
    CHECK(readiness IN ('preparing','ready','needs_answer','held','confirmed','recorded','carded','stopped')),
  blocked_by text[] NOT NULL DEFAULT '{}' CHECK(cardinality(blocked_by) <= 16),
  reason text CHECK(reason IS NULL OR length(reason) BETWEEN 1 AND 2000),
  confirmation_id uuid REFERENCES usp_intake_confirmations(confirmation_id),
  priority_at timestamptz,
  artefacts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(artefacts) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(readiness <> 'stopped' OR cardinality(blocked_by) > 0),
  CHECK(readiness NOT IN ('confirmed','carded') OR confirmation_id IS NOT NULL),
  UNIQUE(package_id, locator),
  FOREIGN KEY(anchor_item_id, case_id) REFERENCES usp_intake_items(item_id, case_id)
);
CREATE INDEX IF NOT EXISTS usp_intake_targets_case_idx ON usp_intake_targets(case_id, readiness, target_id);
CREATE INDEX IF NOT EXISTS usp_intake_targets_confirmation_idx
  ON usp_intake_targets(confirmation_id) WHERE confirmation_id IS NOT NULL;
