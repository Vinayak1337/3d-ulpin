-- G13: a streamed CSV's records, one row per window of at most 10,000, beside (never in) the streaming slots.
CREATE TABLE IF NOT EXISTS usp_table_windows (
  job_id uuid NOT NULL REFERENCES usp_streaming_vector_imports(job_id),
  source_id uuid NOT NULL REFERENCES sources(id),
  source_revision integer NOT NULL CHECK(source_revision>0),
  window_index integer NOT NULL CHECK(window_index>=0 AND window_index<=4095),
  first_record integer NOT NULL CHECK(first_record>=0),
  last_record integer NOT NULL CHECK(last_record>=first_record AND last_record<1000000),
  records integer NOT NULL CHECK(records BETWEEN 1 AND 10000),
  byte_start bigint NOT NULL CHECK(byte_start>=0),
  byte_end bigint NOT NULL CHECK(byte_end>=byte_start),
  window_sha256 text NOT NULL CHECK(window_sha256 ~ '^[a-f0-9]{64}$'),
  rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows)=records),
  attempt integer NOT NULL CHECK(attempt>0),
  fence integer NOT NULL CHECK(fence>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,window_index),
  UNIQUE(job_id,first_record),
  CHECK(last_record-first_record+1=records)
);
-- One approved recipe applied to one window; a failed window is kept with its reason, never skipped.
CREATE TABLE IF NOT EXISTS usp_table_window_mappings (
  job_id uuid NOT NULL REFERENCES usp_chunk_mapping_imports(job_id),
  raw_job_id uuid NOT NULL,
  window_index integer NOT NULL CHECK(window_index>=0 AND window_index<=4095),
  window_sha256 text NOT NULL CHECK(window_sha256 ~ '^[a-f0-9]{64}$'),
  first_record integer NOT NULL CHECK(first_record>=0),
  records integer NOT NULL CHECK(records BETWEEN 1 AND 10000),
  status text NOT NULL CHECK(status IN ('mapped','failed')),
  rows jsonb CHECK(rows IS NULL OR jsonb_typeof(rows)='array' AND jsonb_array_length(rows)=records),
  issue_code text CHECK(issue_code IS NULL OR issue_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  issue text CHECK(issue IS NULL OR length(issue) BETWEEN 1 AND 500),
  result_sha256 text NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),
  attempt integer NOT NULL CHECK(attempt>0),
  fence integer NOT NULL CHECK(fence>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,window_index),
  FOREIGN KEY(raw_job_id,window_index) REFERENCES usp_table_windows(job_id,window_index),
  CHECK((status='mapped')=(rows IS NOT NULL AND issue_code IS NULL AND issue IS NULL)),
  CHECK(status='mapped' OR issue_code IS NOT NULL AND issue IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS usp_table_windows_source_idx ON usp_table_windows(source_id,source_revision,job_id);
