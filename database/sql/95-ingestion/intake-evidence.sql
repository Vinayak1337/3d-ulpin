-- AU4-B1: exact-key evidence of a batch. Stored shapes only: key profiles, candidates, their source coverage and
-- the officer's evidence confirmation. No registry write and no right, ownership or issuance field. Additive only.
CREATE TABLE IF NOT EXISTS usp_intake_key_profiles (
  profile_id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  request_key uuid NOT NULL,
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
  profile_sha256 text NOT NULL CHECK(profile_sha256 ~ '^[a-f0-9]{64}$'),
  version text NOT NULL CHECK(version = 'exact-key/1'),
  namespace text NOT NULL CHECK(length(namespace) BETWEEN 1 AND 150),
  key_kind text NOT NULL CHECK(key_kind IN ('text','integer')),
  anchor_item_id uuid NOT NULL,
  source_path text NOT NULL CHECK(length(source_path) <= 512 AND source_path ~ '^/features/\*/(id|properties/.+)$'),
  profile jsonb NOT NULL CHECK(jsonb_typeof(profile) = 'object'),
  subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id, request_key),
  UNIQUE(profile_id, case_id),
  FOREIGN KEY(anchor_item_id, case_id) REFERENCES usp_intake_items(item_id, case_id)
);
-- One source read under one profile. No row is not read; a NULL count is unknown, never 0.
CREATE TABLE IF NOT EXISTS usp_intake_evidence_coverage (
  profile_id uuid NOT NULL,
  item_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES cases(id),
  family text NOT NULL CHECK(family IN ('table','document')),
  job_id uuid REFERENCES jobs(id),
  result_sha256 text CHECK(result_sha256 IS NULL OR result_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK(state IN ('reading','partial','closed')),
  read_count bigint CHECK(read_count >= 0),
  eligible_count bigint CHECK(eligible_count >= 0),
  keyless_count bigint CHECK(keyless_count >= 0),
  unread_count bigint CHECK(unread_count >= 0),
  failed_count bigint CHECK(failed_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(profile_id, item_id),
  CHECK(state <> 'closed' OR (job_id IS NOT NULL AND result_sha256 IS NOT NULL AND read_count IS NOT NULL
    AND eligible_count IS NOT NULL AND keyless_count IS NOT NULL AND failed_count IS NOT NULL AND unread_count = 0)),
  FOREIGN KEY(profile_id, case_id) REFERENCES usp_intake_key_profiles(profile_id, case_id),
  FOREIGN KEY(item_id, case_id) REFERENCES usp_intake_items(item_id, case_id)
);
CREATE TABLE IF NOT EXISTS usp_intake_evidence_candidates (
  candidate_id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  profile_id uuid NOT NULL,
  item_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  evidence_kind text NOT NULL CHECK(evidence_kind IN ('table_row','document_part')),
  key_literal text NOT NULL CHECK(length(key_literal) BETWEEN 1 AND 1024),
  outcome text NOT NULL CHECK(outcome IN ('matched','no_match','several','conflicting')),
  target_ids uuid[] NOT NULL DEFAULT '{}' CHECK(cardinality(target_ids) <= 16),
  conflict_group uuid,
  candidate jsonb NOT NULL CHECK(jsonb_typeof(candidate) = 'object'),
  candidate_sha256 text NOT NULL CHECK(candidate_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(CASE outcome WHEN 'matched' THEN cardinality(target_ids) = 1 WHEN 'no_match' THEN cardinality(target_ids) = 0
    WHEN 'several' THEN cardinality(target_ids) > 1 ELSE cardinality(target_ids) > 0 END),
  CHECK((outcome = 'conflicting') = (conflict_group IS NOT NULL)),
  UNIQUE(case_id, operation_key),
  FOREIGN KEY(profile_id, case_id) REFERENCES usp_intake_key_profiles(profile_id, case_id),
  FOREIGN KEY(item_id, case_id) REFERENCES usp_intake_items(item_id, case_id)
);
-- The exact-key index: one lookup per literal as read, whichever side arrives first.
CREATE INDEX IF NOT EXISTS usp_intake_evidence_key_idx ON usp_intake_evidence_candidates(profile_id, key_literal);
CREATE INDEX IF NOT EXISTS usp_intake_evidence_case_idx
  ON usp_intake_evidence_candidates(case_id, outcome, candidate_id);
CREATE TABLE IF NOT EXISTS usp_intake_evidence_confirmations (
  confirmation_id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  request_key uuid NOT NULL,
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
  profile_id uuid NOT NULL,
  profile_sha256 text NOT NULL CHECK(profile_sha256 ~ '^[a-f0-9]{64}$'),
  additions text NOT NULL CHECK(additions IN ('citations','no_additions')),
  link_manifest_sha256 text CHECK(link_manifest_sha256 IS NULL OR link_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  pins jsonb NOT NULL CHECK(jsonb_typeof(pins) = 'object'),
  subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 256),
  acknowledgement text NOT NULL CHECK(length(acknowledgement) BETWEEN 1 AND 500),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK(expires_at > created_at),
  CHECK((additions = 'citations') = (link_manifest_sha256 IS NOT NULL)),
  UNIQUE(case_id, request_key),
  FOREIGN KEY(profile_id, case_id) REFERENCES usp_intake_key_profiles(profile_id, case_id)
);
