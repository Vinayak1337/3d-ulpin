import { transaction } from '../db';
import { migrateUspGeometryTx } from './geometry-migration';

/** Additive metadata beside the existing registry/source/job authorities. */
export async function migrateUsp() {
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('usp-migration-ledger',0))");
    await client.query(`CREATE TABLE IF NOT EXISTS usp_migration_ledger (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const name = 'usp_f1_min_001';
    if (!(await client.query('SELECT 1 FROM usp_migration_ledger WHERE name=$1', [name])).rowCount) {
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
    }
    const identityName = 'usp_identity_001';
    if (!(await client.query('SELECT 1 FROM usp_migration_ledger WHERE name=$1', [identityName])).rowCount) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS usp_project_identity_reviews (
        id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES registry_sites(id),
        manifest_id uuid NOT NULL REFERENCES usp_snapshots(id),
        operation text NOT NULL, command_hash text NOT NULL,
        reviewer_subject text NOT NULL, body jsonb NOT NULL,
        consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS usp_project_codes (
        code text PRIMARY KEY CHECK (code ~ '^P3-[0-9A-HJKMNP-TV-Z]{20}-[0-9A-HJKMNP-TV-Z]{2}$'),
        record_id uuid NOT NULL UNIQUE REFERENCES registry_records(id),
        scope_id uuid NOT NULL REFERENCES registry_sites(id),
        status text NOT NULL CHECK (status IN ('assigned','retired','cancelled_error')),
        review_id uuid NOT NULL REFERENCES usp_project_identity_reviews(id),
        assigned_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE FUNCTION usp_project_code_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'A P3 reservation cannot be deleted';
        END IF;
        IF NEW.code IS DISTINCT FROM OLD.code OR NEW.record_id IS DISTINCT FROM OLD.record_id
          OR NEW.scope_id IS DISTINCT FROM OLD.scope_id OR NEW.review_id IS DISTINCT FROM OLD.review_id
          OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
          OR NEW.status IS DISTINCT FROM OLD.status AND NOT
            (OLD.status = 'assigned' AND NEW.status IN ('retired','cancelled_error')) THEN
          RAISE EXCEPTION 'A P3 reservation is immutable except for terminal status';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER usp_project_code_guard_trigger BEFORE UPDATE OR DELETE ON usp_project_codes
        FOR EACH ROW EXECUTE FUNCTION usp_project_code_guard();
      CREATE TABLE IF NOT EXISTS usp_project_identity_state (
        record_id uuid PRIMARY KEY REFERENCES registry_records(id),
        location jsonb NOT NULL, review_id uuid NOT NULL REFERENCES usp_project_identity_reviews(id),
        version integer NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usp_project_identity_audit (
        id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES registry_sites(id),
        review_id uuid NOT NULL REFERENCES usp_project_identity_reviews(id),
        operation text NOT NULL, record_ids uuid[] NOT NULL, receipt_id uuid NOT NULL,
        body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS usp_project_lineage (
        id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES registry_sites(id),
        kind text NOT NULL CHECK (kind IN ('split','merge','boundary_adjustment')),
        predecessor_id uuid NOT NULL REFERENCES registry_records(id),
        successor_id uuid NOT NULL REFERENCES registry_records(id),
        review_id uuid NOT NULL REFERENCES usp_project_identity_reviews(id),
        evidence jsonb NOT NULL, transferred_geometry jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK(predecessor_id <> successor_id), UNIQUE(kind,predecessor_id,successor_id,review_id)
      );
    `);
    await client.query('INSERT INTO usp_migration_ledger(name) VALUES($1)', [identityName]);
    }
    await migrateUspGeometryTx(client);
  });
}
