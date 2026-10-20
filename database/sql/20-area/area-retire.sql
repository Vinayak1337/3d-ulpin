-- G20: an officer retires an area and may restore it; nothing is deleted. The event rows are the history.
ALTER TABLE map_areas ADD COLUMN IF NOT EXISTS archived_by text
  CHECK(archived_by IS NULL OR length(archived_by) BETWEEN 1 AND 256);
CREATE TABLE IF NOT EXISTS map_area_events (
  id uuid PRIMARY KEY,
  area_id uuid NOT NULL REFERENCES map_areas(id),
  area_revision integer NOT NULL CHECK(area_revision >= 0),
  kind text NOT NULL CHECK(kind IN ('retired', 'restored')),
  actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 256),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_area_events_area_idx ON map_area_events(area_id, created_at);
