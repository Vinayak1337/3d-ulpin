-- S1.3al. Drafts (revision 0) never enter a review's context selectors; these indexes cover recorded features only,
-- so a package's context read no longer fetches and discards the drafts of every area its extent touches.
CREATE INDEX IF NOT EXISTS physical_recorded_local_gist
  ON physical_features USING gist(geometry) WHERE revision > 0;
CREATE INDEX IF NOT EXISTS physical_recorded_geographic_gist
  ON physical_features USING gist(geographic_geometry) WHERE revision > 0;
