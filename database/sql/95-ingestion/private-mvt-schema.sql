CREATE TABLE IF NOT EXISTS usp_display.source_tile_cells (
  job_id uuid NOT NULL REFERENCES jobs(id), source_id uuid NOT NULL REFERENCES sources(id),
  admission_job_id uuid NOT NULL REFERENCES jobs(id), z integer NOT NULL CHECK(z BETWEEN 2 AND 6),
  x integer NOT NULL CHECK(x>=0 AND x<power(2,z)), y integer NOT NULL CHECK(y>=0 AND y<power(2,z)),
  input_fingerprint text NOT NULL, body jsonb NOT NULL CHECK(octet_length(body::text)<=16384),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,z,x,y)
);
CREATE TABLE IF NOT EXISTS usp_display.source_tile_generations (
  job_id uuid NOT NULL REFERENCES jobs(id), version integer NOT NULL CHECK(version BETWEEN 1 AND 32),
  source_id uuid NOT NULL REFERENCES sources(id), admission_job_id uuid NOT NULL REFERENCES jobs(id),
  input_fingerprint text NOT NULL, attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3), fence bigint NOT NULL CHECK(fence>0),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), artifact jsonb NOT NULL,
  body jsonb NOT NULL CHECK(octet_length(body::text)<=1048576), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,version), UNIQUE(job_id,sha256)
);
CREATE INDEX IF NOT EXISTS source_tile_generations_source ON usp_display.source_tile_generations(source_id,job_id,version);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='immutable_source_tile_generation' AND tgrelid='usp_display.source_tile_generations'::regclass) THEN
    CREATE TRIGGER immutable_source_tile_generation BEFORE UPDATE OR DELETE ON usp_display.source_tile_generations
      FOR EACH ROW EXECUTE FUNCTION usp_display.immutable_derivative();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ulpin_private_mvt_compiler') THEN
    CREATE ROLE ulpin_private_mvt_compiler NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ulpin_private_mvt_compiler' AND
    (rolsuper OR rolcreatedb OR rolcreaterole OR rolcanlogin OR rolinherit OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Unsafe existing private MVT compiler role';
  END IF;
  EXECUTE format('GRANT ulpin_private_mvt_compiler TO %I',current_user);
END $$;
REVOKE ALL ON usp_display.source_tile_cells,usp_display.source_tile_generations FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ulpin_private_mvt_compiler;
GRANT SELECT ON administrative_unit_observations,administrative_units,spatial_ref_sys TO ulpin_private_mvt_compiler;
