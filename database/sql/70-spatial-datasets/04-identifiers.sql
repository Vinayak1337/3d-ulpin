CREATE TABLE IF NOT EXISTS spatial_dataset_identifiers (
 dataset_id uuid NOT NULL REFERENCES spatial_datasets(id), object_id text NOT NULL,
 identifier text NOT NULL UNIQUE, record jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(dataset_id,object_id))