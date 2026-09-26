CREATE TABLE IF NOT EXISTS spatial_datasets (
 id uuid PRIMARY KEY, case_id uuid NOT NULL UNIQUE REFERENCES cases(id),
 original_source_id uuid NOT NULL REFERENCES sources(id),
 name text NOT NULL, original_name text NOT NULL, sha256 text NOT NULL UNIQUE,
 digest text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK (revision=1),
 classification text NOT NULL CHECK (classification='synthetic'),
 building_count integer NOT NULL, floor_count integer NOT NULL, source_count integer NOT NULL,
 normalized_source jsonb NOT NULL, canonical_input jsonb NOT NULL, snapshot_manifest jsonb NOT NULL,
 source_bindings jsonb NOT NULL, diagnostics jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
 )