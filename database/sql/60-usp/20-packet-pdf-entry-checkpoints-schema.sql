-- Private immutable accepted crops beside canonical jobs/plans, never ready packets.
-- Register through the existing migration ledger; no application in this worker task.
CREATE TABLE usp_packet_pdf_entry_checkpoints (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id),
  plan_id uuid NOT NULL, plan_version integer NOT NULL CHECK (plan_version > 0),
  entry_index smallint NOT NULL CHECK (entry_index >= 0 AND entry_index < 4),
  identity_sha256 text NOT NULL CHECK (identity_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_bytes integer NOT NULL CHECK (artifact_bytes > 0 AND artifact_bytes <= 8388608),
  object_key text NOT NULL UNIQUE,
  accepted_attempt integer NOT NULL CHECK (accepted_attempt > 0),
  accepted_fence bigint NOT NULL CHECK (accepted_fence > 0),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 65536),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id,entry_index),
  FOREIGN KEY (plan_id,plan_version) REFERENCES usp_packet_plans(id,version),
  FOREIGN KEY (job_id,accepted_attempt) REFERENCES usp_job_attempts(job_id,number),
  FOREIGN KEY (job_id,accepted_fence) REFERENCES usp_job_attempts(job_id,fence)
);
CREATE FUNCTION usp_packet_pdf_entry_checkpoint_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Accepted PDF entry checkpoints are immutable; review a new plan version';
END $$;
CREATE TRIGGER usp_packet_pdf_entry_checkpoints_immutable BEFORE UPDATE OR DELETE
  ON usp_packet_pdf_entry_checkpoints FOR EACH ROW EXECUTE FUNCTION usp_packet_pdf_entry_checkpoint_immutable();
