ALTER TABLE administrative_units ADD COLUMN IF NOT EXISTS dataset_namespace text;
ALTER TABLE administrative_units ADD COLUMN IF NOT EXISTS native_key jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS administrative_native_identity ON administrative_units(dataset_namespace,native_key)
  WHERE dataset_namespace IS NOT NULL;
CREATE TABLE IF NOT EXISTS administrative_unit_observations (
  job_id uuid NOT NULL REFERENCES jobs(id), feature_index integer NOT NULL CHECK(feature_index BETWEEN 0 AND 732),
  unit_id uuid NOT NULL REFERENCES administrative_units(id), source_id uuid NOT NULL REFERENCES sources(id),
  disposition text NOT NULL CHECK(disposition IN('admitted','quarantined')), reason text,
  source_locator jsonb NOT NULL, properties jsonb NOT NULL, native_bounds jsonb NOT NULL, geographic_bounds jsonb,
  native_geometry geometry(MultiPolygon,7755) NOT NULL, geographic_geometry geometry(MultiPolygon,4326),
  raw_ref jsonb NOT NULL, geographic_ref jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,feature_index), UNIQUE(job_id,unit_id),
  CHECK ((disposition='admitted' AND geographic_geometry IS NOT NULL AND geographic_ref IS NOT NULL AND reason IS NULL)
    OR (disposition='quarantined' AND geographic_geometry IS NULL AND geographic_ref IS NULL AND reason IS NOT NULL)),
  CHECK (geographic_geometry IS NULL OR (ST_IsValid(geographic_geometry) AND NOT ST_IsEmpty(geographic_geometry))),
  CHECK (disposition<>'admitted' OR ST_IsValid(native_geometry))
);
CREATE INDEX IF NOT EXISTS administrative_observations_geographic ON administrative_unit_observations USING gist(geographic_geometry)
  WHERE disposition='admitted';
CREATE INDEX IF NOT EXISTS administrative_observations_source ON administrative_unit_observations(source_id,job_id);
