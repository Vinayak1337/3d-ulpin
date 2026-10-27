-- Explicit additive migration: feed this file to the selected runtime's psql with preparation paused.
-- Runtime startup and the migration manifest do not discover this file automatically.
-- Drafts (revision 0) cannot participate in either review context selector.
CREATE INDEX IF NOT EXISTS physical_recorded_local_gist
  ON physical_features USING gist(geometry) WHERE revision > 0;
CREATE INDEX IF NOT EXISTS physical_recorded_geographic_gist
  ON physical_features USING gist(geographic_geometry) WHERE revision > 0;
