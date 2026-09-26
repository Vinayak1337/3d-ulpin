CREATE TABLE IF NOT EXISTS usp_display.source_semantic_preparations (
  job_id uuid PRIMARY KEY REFERENCES jobs(id), source_id uuid NOT NULL REFERENCES sources(id),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), body jsonb NOT NULL CHECK(octet_length(body::text)<=1048576),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usp_display.source_semantic_chunks (
  job_id uuid NOT NULL REFERENCES jobs(id), sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 128),
  source_id uuid NOT NULL REFERENCES sources(id), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  body jsonb NOT NULL CHECK(octet_length(body::text)<=131072), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,sequence)
);
ALTER TABLE administrative_unit_observations ADD COLUMN IF NOT EXISTS committed_chunk_sequence integer;
ALTER TABLE administrative_unit_observations ADD COLUMN IF NOT EXISTS native_geometry_sha256 text;
ALTER TABLE administrative_unit_observations ADD COLUMN IF NOT EXISTS geographic_geometry_sha256 text;
ALTER TABLE administrative_unit_observations ADD COLUMN IF NOT EXISTS record_sha256 text;
CREATE OR REPLACE FUNCTION usp_display.protect_sealed_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.committed_chunk_sequence IS NOT NULL THEN RAISE EXCEPTION 'Committed semantic observations are immutable'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='observation_semantic_chunk' AND conrelid='administrative_unit_observations'::regclass) THEN
    ALTER TABLE administrative_unit_observations ADD CONSTRAINT observation_semantic_chunk
      FOREIGN KEY(job_id,committed_chunk_sequence) REFERENCES usp_display.source_semantic_chunks(job_id,sequence) DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='immutable_semantic_preparation' AND tgrelid='usp_display.source_semantic_preparations'::regclass) THEN
    CREATE TRIGGER immutable_semantic_preparation BEFORE UPDATE OR DELETE ON usp_display.source_semantic_preparations FOR EACH ROW EXECUTE FUNCTION usp_display.immutable_derivative();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='immutable_semantic_chunk' AND tgrelid='usp_display.source_semantic_chunks'::regclass) THEN
    CREATE TRIGGER immutable_semantic_chunk BEFORE UPDATE OR DELETE ON usp_display.source_semantic_chunks FOR EACH ROW EXECUTE FUNCTION usp_display.immutable_derivative();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='immutable_sealed_observation' AND tgrelid='administrative_unit_observations'::regclass) THEN
    CREATE TRIGGER immutable_sealed_observation BEFORE UPDATE OR DELETE ON administrative_unit_observations FOR EACH ROW EXECUTE FUNCTION usp_display.protect_sealed_observation();
  END IF;
END $$;
REVOKE ALL ON usp_display.source_semantic_preparations,usp_display.source_semantic_chunks FROM PUBLIC;
