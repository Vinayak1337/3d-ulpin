import { query } from "./db";

/** Additive canonical v2 storage. Existing registry geometry/history is untouched. */
export async function migrateAreas() {
  await query(`
    CREATE TABLE IF NOT EXISTS map_areas (
      id uuid PRIMARY KEY, site_id uuid UNIQUE NOT NULL REFERENCES registry_sites(id),
      name text NOT NULL, revision integer NOT NULL DEFAULT 0, reference jsonb,
      extent jsonb, geographic_extent jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE map_areas ADD COLUMN IF NOT EXISTS seed_key text UNIQUE;
    ALTER TABLE map_areas ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE map_areas ADD COLUMN IF NOT EXISTS archive_reason text;
    INSERT INTO map_areas(id,site_id,name)
      SELECT id,id,name FROM registry_sites ON CONFLICT(site_id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS administrative_units (
      id uuid PRIMARY KEY, kind text NOT NULL, name text NOT NULL, code text, authority text, source text
    );
    CREATE TABLE IF NOT EXISTS administrative_relationships (
      unit_id uuid REFERENCES administrative_units(id), related_id uuid REFERENCES administrative_units(id),
      relationship text NOT NULL, source text NOT NULL, PRIMARY KEY(unit_id,related_id,relationship)
    );
    CREATE TABLE IF NOT EXISTS area_memberships (
      area_id uuid REFERENCES map_areas(id), unit_id uuid REFERENCES administrative_units(id),
      PRIMARY KEY(area_id,unit_id)
    );
    CREATE TABLE IF NOT EXISTS import_packages (
      id uuid PRIMARY KEY, area_id uuid NOT NULL REFERENCES map_areas(id), case_id uuid NOT NULL REFERENCES cases(id),
      revision integer NOT NULL DEFAULT 1, state text NOT NULL, body jsonb NOT NULL,
      operation_key text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS import_package_revisions (
      package_id uuid REFERENCES import_packages(id), revision integer NOT NULL, body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(package_id,revision)
    );
    CREATE TABLE IF NOT EXISTS physical_features (
      id uuid PRIMARY KEY, area_id uuid NOT NULL REFERENCES map_areas(id), record_id uuid REFERENCES registry_records(id),
      identifier text UNIQUE NOT NULL, revision integer NOT NULL DEFAULT 0, body jsonb NOT NULL,
      geometry geometry(Geometry,0), geographic_geometry geometry(Geometry,4326)
    );
    CREATE INDEX IF NOT EXISTS physical_local_gist ON physical_features USING gist(geometry);
    CREATE INDEX IF NOT EXISTS physical_geographic_gist ON physical_features USING gist(geographic_geometry);
    CREATE TABLE IF NOT EXISTS physical_feature_revisions (
      feature_id uuid REFERENCES physical_features(id), revision integer NOT NULL, body jsonb NOT NULL,
      package_id uuid NOT NULL REFERENCES import_packages(id), area_revision integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(feature_id,revision)
    );
    CREATE TABLE IF NOT EXISTS source_feature_links (
      namespace text NOT NULL, source_key text NOT NULL, area_id uuid REFERENCES map_areas(id),
      feature_id uuid NOT NULL REFERENCES physical_features(id), PRIMARY KEY(namespace,source_key)
    );
    CREATE TABLE IF NOT EXISTS external_identifiers (
      id uuid PRIMARY KEY, scheme text NOT NULL, normalized_value text NOT NULL, issuer text NOT NULL,
      record_id uuid REFERENCES registry_records(id), feature_id uuid REFERENCES physical_features(id),
      source_id uuid REFERENCES sources(id), evidence jsonb NOT NULL, verification_state text NOT NULL,
      valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
      CHECK ((record_id IS NOT NULL)::int + (feature_id IS NOT NULL)::int = 1)
    );
    CREATE INDEX IF NOT EXISTS external_identifier_resolver ON external_identifiers(normalized_value)
      WHERE valid_to IS NULL AND verification_state='validated';
    CREATE UNIQUE INDEX IF NOT EXISTS external_identifier_assertion ON external_identifiers
      (scheme,normalized_value,issuer,COALESCE(record_id,feature_id),COALESCE(source_id,'00000000-0000-0000-0000-000000000000'::uuid));
    CREATE TABLE IF NOT EXISTS area_check_runs (
      id uuid PRIMARY KEY, area_id uuid NOT NULL REFERENCES map_areas(id), area_revision integer NOT NULL,
      status text NOT NULL, input_fingerprint text NOT NULL, body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS scene_asset_bindings (
      feature_id uuid NOT NULL REFERENCES physical_features(id),
      feature_revision integer NOT NULL,
      body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(feature_id,feature_revision)
    );
    CREATE TABLE IF NOT EXISTS area_acquisitions (
      id uuid PRIMARY KEY, source_id text NOT NULL, operation_key text UNIQUE NOT NULL,
      status text NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
