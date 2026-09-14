import { query } from "./db";
export async function migrateOfficer() {
  await query(`
    CREATE TABLE IF NOT EXISTS property_associations (
      id uuid PRIMARY KEY, from_id uuid NOT NULL REFERENCES physical_features(id),
      to_id uuid NOT NULL, relationship text NOT NULL, revision integer NOT NULL,
      status text NOT NULL, body jsonb NOT NULL, UNIQUE(from_id,to_id,relationship)
    );
    CREATE INDEX IF NOT EXISTS property_associations_target ON property_associations(to_id,status);
    CREATE TABLE IF NOT EXISTS property_association_revisions (
      association_id uuid REFERENCES property_associations(id),revision integer NOT NULL,body jsonb NOT NULL,
      PRIMARY KEY(association_id,revision)
    );
    CREATE TABLE IF NOT EXISTS block_groups (
      id uuid PRIMARY KEY, area_id uuid NOT NULL REFERENCES map_areas(id), body jsonb NOT NULL
    );
    ALTER TABLE block_groups ADD COLUMN IF NOT EXISTS operation_key text UNIQUE;
    CREATE TABLE IF NOT EXISTS block_group_revisions (
      group_id uuid REFERENCES block_groups(id),revision integer NOT NULL,body jsonb NOT NULL,
      PRIMARY KEY(group_id,revision)
    );
    CREATE TABLE IF NOT EXISTS block_group_memberships (
      group_id uuid REFERENCES block_groups(id), feature_id uuid REFERENCES physical_features(id),
      PRIMARY KEY(group_id,feature_id)
    );
    CREATE TABLE IF NOT EXISTS building_preparations (
      id uuid PRIMARY KEY, building_id uuid UNIQUE NOT NULL REFERENCES physical_features(id),
      case_id uuid UNIQUE NOT NULL REFERENCES cases(id), package_id uuid UNIQUE NOT NULL REFERENCES import_packages(id),
      revision integer NOT NULL DEFAULT 1, body jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS building_preparation_revisions (
      preparation_id uuid REFERENCES building_preparations(id),revision integer NOT NULL,body jsonb NOT NULL,
      PRIMARY KEY(preparation_id,revision)
    );
    CREATE TABLE IF NOT EXISTS officer_investigations (
      id uuid PRIMARY KEY, building_id uuid NOT NULL REFERENCES physical_features(id), area_id uuid NOT NULL REFERENCES map_areas(id),
      request_key uuid UNIQUE NOT NULL, revision integer NOT NULL, body jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS officer_investigation_revisions (
      investigation_id uuid REFERENCES officer_investigations(id),revision integer NOT NULL,body jsonb NOT NULL,
      PRIMARY KEY(investigation_id,revision)
    );
  `);
}
