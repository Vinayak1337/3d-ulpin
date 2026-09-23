import { transaction } from '../db';

/** Additive metadata beside the existing registry/source/job authorities. */
export async function migrateUsp() {
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('usp-migration-ledger',0))");
    await client.query(`CREATE TABLE IF NOT EXISTS usp_migration_ledger (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const name = 'usp_f1_min_001';
    if ((await client.query('SELECT 1 FROM usp_migration_ledger WHERE name=$1', [name])).rowCount) return;
    await client.query(`
      CREATE TABLE IF NOT EXISTS usp_snapshots (
        id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES registry_sites(id),
        digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
        body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS usp_snapshots_scope ON usp_snapshots(scope_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS usp_snapshot_bodies (
        manifest_id uuid NOT NULL REFERENCES usp_snapshots(id),
        namespace text NOT NULL, object_id text NOT NULL, revision bigint NOT NULL,
        body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
        body jsonb NOT NULL, PRIMARY KEY(manifest_id,namespace,object_id,revision)
      );
      CREATE TABLE IF NOT EXISTS usp_command_receipts (
        id uuid PRIMARY KEY, subject text NOT NULL, scope_key text NOT NULL,
        operation text NOT NULL, request_key text NOT NULL, command_sha256 text NOT NULL,
        body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(subject,scope_key,operation,request_key)
      );
      CREATE TABLE IF NOT EXISTS usp_outbox_streams (
        stream_id text PRIMARY KEY, last_sequence bigint NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS usp_outbox (
        stream_id text NOT NULL REFERENCES usp_outbox_streams(stream_id),
        sequence bigint NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(stream_id,sequence)
      );
      CREATE TABLE IF NOT EXISTS usp_job_attempts (
        job_id uuid NOT NULL REFERENCES jobs(id), number integer NOT NULL, fence bigint NOT NULL,
        owner text NOT NULL, input_sha256 text NOT NULL, lease_until timestamptz NOT NULL,
        state text NOT NULL, completion_sha256 text, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(job_id,number), UNIQUE(job_id,fence)
      );
      CREATE TABLE IF NOT EXISTS usp_job_metadata (
        job_id uuid PRIMARY KEY REFERENCES jobs(id), version integer NOT NULL DEFAULT 1,
        input_manifest_id text NOT NULL, input_sha256 text NOT NULL,
        scope jsonb NOT NULL, result_ref jsonb, accepted_fence bigint,
        logical_state text NOT NULL DEFAULT 'queued',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS usp_releases (
        id uuid PRIMARY KEY, version integer NOT NULL, output_hash text NOT NULL,
        body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS usp_packets (
        id uuid PRIMARY KEY, manifest_id uuid NOT NULL REFERENCES usp_snapshots(id),
        target_namespace text NOT NULL, target_id text NOT NULL,
        artifact_hash text NOT NULL, object_key text NOT NULL UNIQUE,
        body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query('INSERT INTO usp_migration_ledger(name) VALUES($1)', [name]);
  });
}
