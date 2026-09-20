import {transaction} from './db';
let ready:Promise<void>|undefined;
/** Additive receipt storage; canonical/source IDs live unchanged in the immutable snapshot. */
export function ensureSpatialDatasets(){
 return ready??=transaction(async client=>{
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('spatial-dataset-schema-v1',0))");
 await client.query(`CREATE TABLE IF NOT EXISTS spatial_datasets (
 id uuid PRIMARY KEY, case_id uuid NOT NULL UNIQUE REFERENCES cases(id),
 original_source_id uuid NOT NULL REFERENCES sources(id),
 name text NOT NULL, original_name text NOT NULL, sha256 text NOT NULL UNIQUE,
 digest text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK (revision=1),
 classification text NOT NULL CHECK (classification='synthetic'),
 building_count integer NOT NULL, floor_count integer NOT NULL, source_count integer NOT NULL,
 normalized_source jsonb NOT NULL, canonical_input jsonb NOT NULL, snapshot_manifest jsonb NOT NULL,
 source_bindings jsonb NOT NULL, diagnostics jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
 )`);
 await client.query('ALTER TABLE spatial_datasets ADD COLUMN IF NOT EXISTS archived_at timestamptz');
 await client.query('ALTER TABLE spatial_datasets ADD COLUMN IF NOT EXISTS identifiers_version integer');
 await client.query(`CREATE TABLE IF NOT EXISTS spatial_dataset_identifiers (
 dataset_id uuid NOT NULL REFERENCES spatial_datasets(id), object_id text NOT NULL,
 identifier text NOT NULL UNIQUE, record jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(dataset_id,object_id))`);
 }).catch(error=>{ready=undefined;throw error;});
}
