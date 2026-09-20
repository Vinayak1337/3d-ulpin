import {transaction} from './db';
import {ensureSpatialDatasets} from './spatial-dataset-db';
let ready:Promise<void>|undefined;
export async function ensureDatasetMl(){await ensureSpatialDatasets();return ready??=transaction(async client=>{
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dataset-ml-schema-v1',0))");
 await client.query(`CREATE TABLE IF NOT EXISTS spatial_dataset_ml_runs (
 id uuid PRIMARY KEY REFERENCES jobs(id), dataset_id uuid NOT NULL REFERENCES spatial_datasets(id),
 source_id uuid NOT NULL REFERENCES sources(id), request_key uuid NOT NULL, request_digest text NOT NULL,
 task text NOT NULL CHECK(task IN ('floor-plan','building')),page integer NOT NULL,model_id text NOT NULL,
 result jsonb, artifacts jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(dataset_id,request_key,source_id,task,page)
 );
 CREATE TABLE IF NOT EXISTS spatial_dataset_ml_reviews (
 id uuid PRIMARY KEY,run_id uuid NOT NULL REFERENCES spatial_dataset_ml_runs(id),request_key uuid NOT NULL,
 request_digest text NOT NULL,body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(run_id,request_key)
 );
 CREATE INDEX IF NOT EXISTS spatial_dataset_ml_recent ON spatial_dataset_ml_runs(dataset_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS spatial_dataset_ml_review_recent ON spatial_dataset_ml_reviews(run_id,created_at DESC);`);
 }).catch(e=>{ready=undefined;throw e;});}
