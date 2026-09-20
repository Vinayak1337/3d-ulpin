import { query } from "./db";

/** Application-owned receipts; the private inference worker has no database access. */
export async function migrateSpatialMl() {
  await query(`
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
    CREATE TABLE IF NOT EXISTS spatial_ml_batches (
      id uuid PRIMARY KEY,
      package_id uuid NOT NULL REFERENCES import_packages(id),
      request_key uuid NOT NULL,
      request_digest text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(package_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS spatial_ml_items (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL REFERENCES spatial_ml_batches(id),
      package_id uuid NOT NULL REFERENCES import_packages(id),
      source_id uuid NOT NULL REFERENCES sources(id),
      current_job_id uuid NOT NULL REFERENCES jobs(id),
      body jsonb NOT NULL,
      private_input jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS spatial_ml_package_idx ON spatial_ml_batches(package_id,created_at);
    CREATE INDEX IF NOT EXISTS spatial_ml_job_idx ON spatial_ml_items(current_job_id);
    CREATE TABLE IF NOT EXISTS spatial_ml_footprint_drafts (
      item_id uuid NOT NULL REFERENCES spatial_ml_items(id),
      request_key uuid NOT NULL,
      request_digest text NOT NULL,
      package_id uuid NOT NULL REFERENCES import_packages(id),
      body jsonb NOT NULL,
      PRIMARY KEY(item_id, request_key)
    );
  `);
}
