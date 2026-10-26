ALTER TABLE import_packages ADD COLUMN IF NOT EXISTS review_current boolean
  GENERATED ALWAYS AS (body->'review'->'packageRevision' IS NOT DISTINCT FROM body->'revision') STORED;
