CREATE TABLE IF NOT EXISTS officer_ai_runs (
    id uuid PRIMARY KEY, package_id uuid NOT NULL REFERENCES import_packages(id) ON DELETE CASCADE,
    request_key uuid NOT NULL, input_fingerprint text NOT NULL, body jsonb NOT NULL,
    private_input jsonb NOT NULL, raw_outputs jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(package_id,request_key)
  ); CREATE INDEX IF NOT EXISTS officer_ai_input_idx ON officer_ai_runs(package_id,input_fingerprint);
  CREATE TABLE IF NOT EXISTS officer_ai_derivatives (run_id uuid REFERENCES officer_ai_runs(id) ON DELETE CASCADE, part_id uuid NOT NULL, sha256 text NOT NULL, bytes bytea NOT NULL, PRIMARY KEY(run_id,part_id));