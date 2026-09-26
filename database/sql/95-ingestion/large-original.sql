CREATE TABLE IF NOT EXISTS usp_source_uploads (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  operator_subject text NOT NULL,
  request_key uuid NOT NULL,
  request_hash text NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  case_revision integer NOT NULL CHECK(case_revision>=0),
  state text NOT NULL CHECK(state IN ('receiving','finalizing','retained','aborting','aborted')),
  source_id uuid NOT NULL UNIQUE,
  original_bytes bigint NOT NULL CHECK(original_bytes>0 AND original_bytes<=134217728),
  body jsonb NOT NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  finalize_attempts integer NOT NULL DEFAULT 0 CHECK(finalize_attempts BETWEEN 0 AND 3),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id,operator_subject,request_key)
);
CREATE TABLE IF NOT EXISTS usp_source_upload_parts (
  upload_id uuid NOT NULL REFERENCES usp_source_uploads(id),
  part_number integer NOT NULL CHECK(part_number BETWEEN 1 AND 16),
  request_key uuid NOT NULL,
  sha256 text NOT NULL,
  bytes integer NOT NULL CHECK(bytes>0 AND bytes<=8388608),
  object_key text NOT NULL UNIQUE,
  state text NOT NULL CHECK(state IN ('writing','failed','received')),
  attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 3),
  lease_token uuid,
  lease_expires_at timestamptz,
  PRIMARY KEY(upload_id,part_number),
  UNIQUE(upload_id,request_key)
);
