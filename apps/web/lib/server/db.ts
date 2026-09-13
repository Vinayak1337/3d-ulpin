import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { migrateRegistry } from "./registry-db";
import { settings } from "./config";
const globals = globalThis as unknown as { ulpinPool?: Pool };
export function pool(): Pool {
  if (!globals.ulpinPool) {
    const connectionPool = new Pool({
      connectionString: settings.databaseUrl,
      max: 8,
      connectionTimeoutMillis: 5000,
    });
    // pg removes a failed idle connection. Handle its event so a database
    // restart does not terminate the web server or the durable job dispatcher.
    connectionPool.on("error", () => {
      console.warn(
        "An idle database connection closed; the pool will reconnect on the next request.",
      );
    });
    globals.ulpinPool = connectionPool;
  }
  return globals.ulpinPool;
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return pool().query<T>(text, values);
}
export async function transaction<T>(
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate() {
  await query(`
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE TABLE IF NOT EXISTS cases (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      frame jsonb NOT NULL,
      revision integer NOT NULL DEFAULT 0,
      context jsonb NOT NULL DEFAULT '[]',
      current_snapshot_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS sources (
      id uuid PRIMARY KEY,
      case_id uuid NOT NULL REFERENCES cases(id),
      family_id uuid NOT NULL,
      revision integer NOT NULL CHECK (revision > 0),
      name text NOT NULL,
      profile text NOT NULL,
      mime_type text NOT NULL,
      bytes bigint NOT NULL CHECK (bytes > 0),
      sha256 text NOT NULL,
      object_key text NOT NULL UNIQUE,
      status text NOT NULL,
      inspection jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(case_id, family_id, revision)
    );
    CREATE TABLE IF NOT EXISTS units (
      id uuid PRIMARY KEY,
      case_id uuid NOT NULL REFERENCES cases(id),
      alias text NOT NULL,
      revision integer NOT NULL,
      active boolean NOT NULL DEFAULT true,
      body jsonb NOT NULL,
      footprint geometry(Polygon,0) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(case_id,alias)
    );
    CREATE INDEX IF NOT EXISTS units_footprint_gist ON units USING gist(footprint);
    CREATE TABLE IF NOT EXISTS unit_revisions (
      unit_id uuid NOT NULL REFERENCES units(id),
      revision integer NOT NULL,
      body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(unit_id,revision)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id uuid PRIMARY KEY,
      case_id uuid NOT NULL REFERENCES cases(id),
      source_id uuid REFERENCES sources(id),
      operation text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      case_revision integer,
      input_fingerprint text NOT NULL,
      payload jsonb NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      dispatched_at timestamptz,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(status, next_attempt_at);
    CREATE TABLE IF NOT EXISTS snapshots (
      id uuid PRIMARY KEY,
      case_id uuid NOT NULL REFERENCES cases(id),
      revision integer NOT NULL,
      input_fingerprint text NOT NULL,
      body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(case_id,input_fingerprint)
    );
    CREATE TABLE IF NOT EXISTS events (
      id uuid PRIMARY KEY,
      case_id uuid NOT NULL REFERENCES cases(id),
      actor text NOT NULL DEFAULT 'local-demo-operator',
      kind text NOT NULL,
      message text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS operations (
      case_id uuid NOT NULL REFERENCES cases(id),
      operation_key text NOT NULL,
      kind text NOT NULL,
      payload_hash text NOT NULL,
      result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(case_id,operation_key,kind)
    );
    CREATE TABLE IF NOT EXISTS identity_floors (
      case_id uuid NOT NULL REFERENCES cases(id),
      label text NOT NULL,
      ordinal integer NOT NULL CHECK(ordinal > 0),
      PRIMARY KEY(case_id,ordinal),
      UNIQUE(case_id,label)
    );
    CREATE TABLE IF NOT EXISTS identity_spaces (
      case_id uuid NOT NULL REFERENCES cases(id),
      unit_id uuid PRIMARY KEY REFERENCES units(id),
      ordinal integer NOT NULL CHECK(ordinal > 0),
      floor_ordinal integer NOT NULL,
      UNIQUE(case_id,ordinal),
      FOREIGN KEY(case_id,floor_ordinal) REFERENCES identity_floors(case_id,ordinal)
    );
    -- Backfill all historical units, including inactive ones. Never reuse suffixes.
    WITH missing AS (
      SELECT DISTINCT u.case_id,COALESCE(NULLIF(btrim(u.body->>'levelLabel'),''),'Unassigned') AS label
      FROM units u WHERE NOT EXISTS(SELECT 1 FROM identity_floors f WHERE f.case_id=u.case_id
        AND f.label=COALESCE(NULLIF(btrim(u.body->>'levelLabel'),''),'Unassigned'))
    )
    INSERT INTO identity_floors(case_id,label,ordinal)
      SELECT m.case_id,m.label,COALESCE((SELECT MAX(f.ordinal) FROM identity_floors f WHERE f.case_id=m.case_id),0)
        + ROW_NUMBER() OVER(PARTITION BY m.case_id ORDER BY m.label)
      FROM missing m ON CONFLICT DO NOTHING;
    WITH missing AS (
      SELECT u.id,u.case_id,u.created_at,f.ordinal AS floor_ordinal FROM units u
      JOIN identity_floors f ON f.case_id=u.case_id AND f.label=COALESCE(NULLIF(btrim(u.body->>'levelLabel'),''),'Unassigned')
      WHERE NOT EXISTS(SELECT 1 FROM identity_spaces s WHERE s.unit_id=u.id)
    )
    INSERT INTO identity_spaces(case_id,unit_id,ordinal,floor_ordinal)
      SELECT m.case_id,m.id,COALESCE((SELECT MAX(s.ordinal) FROM identity_spaces s WHERE s.case_id=m.case_id),0)
        + ROW_NUMBER() OVER(PARTITION BY m.case_id ORDER BY m.created_at,m.id),m.floor_ordinal
      FROM missing m ON CONFLICT DO NOTHING;
  `);
  await migrateRegistry();
}
