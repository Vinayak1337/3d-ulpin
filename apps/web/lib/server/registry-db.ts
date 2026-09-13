import { query } from "./db";
export async function migrateRegistry() {
  await query(`
    CREATE TABLE IF NOT EXISTS registry_sites (
      id uuid PRIMARY KEY, identifier text UNIQUE NOT NULL, name text NOT NULL,
      frame jsonb NOT NULL, revision integer NOT NULL DEFAULT 0, synthetic boolean NOT NULL DEFAULT true,
      seed_key text UNIQUE, seed_case_id uuid REFERENCES cases(id)
    );
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES registry_sites(id);
    CREATE TABLE IF NOT EXISTS registry_records (
      id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES registry_sites(id),
      kind text NOT NULL CHECK(kind IN ('parcel','building','floor','space')),
      ordinal integer NOT NULL, identifier text UNIQUE NOT NULL, revision integer NOT NULL DEFAULT 0,
      body jsonb NOT NULL, footprint geometry(Polygon,0), UNIQUE(site_id,kind,ordinal)
    );
    CREATE INDEX IF NOT EXISTS registry_footprint_gist ON registry_records USING gist(footprint);
    CREATE TABLE IF NOT EXISTS registry_revisions (
      record_id uuid NOT NULL REFERENCES registry_records(id), revision integer NOT NULL,
      body jsonb NOT NULL, site_revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(record_id,revision)
    );
    CREATE TABLE IF NOT EXISTS registry_links (
      record_id uuid NOT NULL REFERENCES registry_records(id), target_id uuid NOT NULL REFERENCES registry_records(id),
      kind text NOT NULL, PRIMARY KEY(record_id,target_id,kind)
    );
    CREATE TABLE IF NOT EXISTS registry_rights (
      record_id uuid NOT NULL REFERENCES registry_records(id), ordinal integer NOT NULL,
      body jsonb NOT NULL, PRIMARY KEY(record_id,ordinal)
    );
    CREATE TABLE IF NOT EXISTS registry_drafts (
      id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES registry_sites(id), case_id uuid NOT NULL REFERENCES cases(id),
      revision integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'draft', records jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE registry_drafts ADD COLUMN IF NOT EXISTS request_key uuid;
    CREATE UNIQUE INDEX IF NOT EXISTS registry_draft_request_key ON registry_drafts(site_id, request_key);
    CREATE TABLE IF NOT EXISTS registry_reviews (
      id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES registry_drafts(id), body jsonb NOT NULL,
      committed boolean NOT NULL DEFAULT false, acknowledgement text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS registry_aliases (
      alias text PRIMARY KEY, record_id uuid REFERENCES registry_records(id), site_id uuid NOT NULL REFERENCES registry_sites(id),
      meaning text NOT NULL
    );
    ALTER TABLE registry_aliases ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES cases(id);
  `);
}
