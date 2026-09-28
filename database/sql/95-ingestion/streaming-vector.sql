CREATE TABLE IF NOT EXISTS usp_streaming_vector_imports (
  job_id uuid PRIMARY KEY REFERENCES jobs(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  source_id uuid NOT NULL REFERENCES sources(id),
  source_revision integer NOT NULL CHECK(source_revision>0),
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK(state IN ('queued','running','completed','completed_with_rejections','failed','stale')),
  next_publish_index integer NOT NULL DEFAULT 0 CHECK(next_publish_index>=0 AND next_publish_index<=4097),
  sealed_chunks integer CHECK(sealed_chunks>=0 AND sealed_chunks<=4097),
  records integer NOT NULL DEFAULT 0 CHECK(records>=0),
  accepted integer NOT NULL DEFAULT 0 CHECK(accepted>=0),
  quarantined integer NOT NULL DEFAULT 0 CHECK(quarantined>=0),
  issue_code text,
  unknown_remainder boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(accepted+quarantined=records),
  CHECK(sealed_chunks IS NULL OR next_publish_index<=sealed_chunks)
);
CREATE TABLE IF NOT EXISTS usp_streaming_vector_slots (
  job_id uuid NOT NULL REFERENCES usp_streaming_vector_imports(job_id),
  source_revision integer NOT NULL CHECK(source_revision>0),
  chunk_index integer NOT NULL CHECK(chunk_index>=0 AND chunk_index<=4096),
  status text NOT NULL CHECK(status IN ('ready','quarantined')),
  published boolean NOT NULL DEFAULT false,
  first_feature_index integer NOT NULL CHECK(first_feature_index>=0),
  last_feature_index integer CHECK(last_feature_index>=first_feature_index),
  records integer NOT NULL CHECK(records>=0 AND records<=100),
  accepted integer NOT NULL CHECK(accepted>=0),
  quarantined integer NOT NULL CHECK(quarantined>=0),
  bytes integer NOT NULL CHECK(bytes>=0 AND bytes<=524288),
  object_key text,
  object_sha256 text,
  issue_code text,
  result_sha256 text NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),
  attempt integer NOT NULL CHECK(attempt>0),
  fence integer NOT NULL CHECK(fence>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,source_revision,chunk_index),
  CHECK(accepted+quarantined=records),
  CHECK((object_key IS NULL AND object_sha256 IS NULL AND bytes=0) OR
        (object_key IS NOT NULL AND object_sha256 ~ '^[a-f0-9]{64}$' AND bytes>0))
);
CREATE INDEX IF NOT EXISTS usp_streaming_vector_source_idx ON usp_streaming_vector_imports(case_id,source_id,created_at DESC);
CREATE INDEX IF NOT EXISTS usp_streaming_vector_publish_idx ON usp_streaming_vector_slots(job_id,chunk_index) WHERE published=false;
