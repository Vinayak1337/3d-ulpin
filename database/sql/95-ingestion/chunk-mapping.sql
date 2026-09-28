CREATE TABLE IF NOT EXISTS usp_chunk_mapping_imports (
  job_id uuid PRIMARY KEY REFERENCES jobs(id),
  raw_job_id uuid NOT NULL REFERENCES usp_streaming_vector_imports(job_id),
  case_id uuid NOT NULL REFERENCES cases(id),
  source_id uuid NOT NULL REFERENCES sources(id),
  source_revision integer NOT NULL CHECK(source_revision>0),
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK(state IN ('queued','running','needs_input','disabled','unavailable','completed','completed_with_rejections','failed','stale')),
  next_publish_index integer NOT NULL DEFAULT 0 CHECK(next_publish_index>=0 AND next_publish_index<=4097),
  sealed_chunks integer CHECK(sealed_chunks>=0 AND sealed_chunks<=4097),
  records integer NOT NULL DEFAULT 0 CHECK(records>=0),
  normalized integer NOT NULL DEFAULT 0 CHECK(normalized>=0),
  quarantined integer NOT NULL DEFAULT 0 CHECK(quarantined>=0),
  unresolved integer NOT NULL DEFAULT 0 CHECK(unresolved>=0),
  duplicate_keys integer NOT NULL DEFAULT 0 CHECK(duplicate_keys>=0),
  baseline_schema_fingerprint text CHECK(baseline_schema_fingerprint IS NULL OR baseline_schema_fingerprint ~ '^[a-f0-9]{64}$'),
  schema_drift_chunks integer NOT NULL DEFAULT 0 CHECK(schema_drift_chunks>=0),
  issue_code text,
  proposal jsonb,
  unknown_remainder boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(normalized+quarantined+unresolved=records),
  CHECK(sealed_chunks IS NULL OR next_publish_index<=sealed_chunks)
);
CREATE TABLE IF NOT EXISTS usp_chunk_mapping_slots (
  job_id uuid NOT NULL REFERENCES usp_chunk_mapping_imports(job_id),
  chunk_index integer NOT NULL CHECK(chunk_index>=0 AND chunk_index<=4096),
  status text NOT NULL CHECK(status IN ('ready','quarantined')),
  published boolean NOT NULL DEFAULT false,
  raw_result_sha256 text CHECK(raw_result_sha256 IS NULL OR raw_result_sha256 ~ '^[a-f0-9]{64}$'),
  schema_fingerprint text CHECK(schema_fingerprint IS NULL OR schema_fingerprint ~ '^[a-f0-9]{64}$'),
  schema_drift boolean NOT NULL DEFAULT false,
  first_feature_index integer NOT NULL CHECK(first_feature_index>=0),
  last_feature_index integer CHECK(last_feature_index>=first_feature_index),
  records integer NOT NULL CHECK(records>=0 AND records<=100),
  normalized integer NOT NULL CHECK(normalized>=0),
  quarantined integer NOT NULL CHECK(quarantined>=0),
  unresolved integer NOT NULL CHECK(unresolved>=0),
  bytes integer NOT NULL CHECK(bytes>=0 AND bytes<=262144),
  object_key text,
  object_sha256 text,
  issue_code text,
  result_sha256 text NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),
  attempt integer NOT NULL CHECK(attempt>0),
  fence integer NOT NULL CHECK(fence>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,chunk_index),
  CHECK(normalized+quarantined+unresolved=records),
  CHECK((object_key IS NULL AND object_sha256 IS NULL AND bytes=0) OR
        (object_key IS NOT NULL AND object_sha256 ~ '^[a-f0-9]{64}$' AND bytes>0))
);
CREATE TABLE IF NOT EXISTS usp_chunk_mapping_keys (
  job_id uuid NOT NULL REFERENCES usp_chunk_mapping_imports(job_id),
  source_key_sha256 text NOT NULL CHECK(source_key_sha256 ~ '^[a-f0-9]{64}$'),
  source_key text NOT NULL CHECK(length(source_key)>0 AND length(source_key)<=256),
  first_feature_index integer NOT NULL CHECK(first_feature_index>=0),
  conflicted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(job_id,source_key_sha256)
);
CREATE TABLE IF NOT EXISTS usp_chunk_mapping_conflicts (
  job_id uuid NOT NULL REFERENCES usp_chunk_mapping_imports(job_id),
  later_feature_index integer NOT NULL CHECK(later_feature_index>=0),
  first_feature_index integer NOT NULL CHECK(first_feature_index>=0),
  source_key_sha256 text NOT NULL CHECK(source_key_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(job_id,later_feature_index)
);
CREATE INDEX IF NOT EXISTS usp_chunk_mapping_source_idx ON usp_chunk_mapping_imports(case_id,source_id,created_at DESC);
