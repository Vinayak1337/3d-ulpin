CREATE TABLE IF NOT EXISTS usp_streamed_profile_imports (
  job_id uuid PRIMARY KEY REFERENCES jobs(id),
  raw_job_id uuid NOT NULL REFERENCES usp_streaming_vector_imports(job_id),
  case_id uuid NOT NULL REFERENCES cases(id),
  source_id uuid NOT NULL REFERENCES sources(id),
  source_revision integer NOT NULL CHECK(source_revision>0),
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK(state IN ('queued','running','sealed','failed','stale')),
  next_raw_index integer NOT NULL DEFAULT 0 CHECK(next_raw_index>=0 AND next_raw_index<=4097),
  sealed_generation integer CHECK(sealed_generation>=0 AND sealed_generation<=4097),
  issue_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usp_streamed_profile_generations (
  job_id uuid NOT NULL REFERENCES usp_streamed_profile_imports(job_id),
  generation integer NOT NULL CHECK(generation>=0 AND generation<=4097),
  raw_chunk_index integer CHECK(raw_chunk_index>=0 AND raw_chunk_index<=4096),
  raw_result_sha256 text CHECK(raw_result_sha256 IS NULL OR raw_result_sha256 ~ '^[a-f0-9]{64}$'),
  body jsonb NOT NULL,
  body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
  sealed boolean NOT NULL,
  attempt integer NOT NULL CHECK(attempt>0),
  fence integer NOT NULL CHECK(fence>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,generation),
  CHECK((sealed AND raw_chunk_index IS NULL) OR (NOT sealed AND raw_chunk_index=generation))
);
CREATE INDEX IF NOT EXISTS usp_streamed_profile_source_idx ON usp_streamed_profile_imports(case_id,source_id,created_at DESC);
