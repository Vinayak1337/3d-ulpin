-- Existing package rows retain their references and unique key. No row is reseeded.
ALTER TABLE spatial_ml_batches ALTER COLUMN package_id DROP NOT NULL;
ALTER TABLE spatial_ml_items ALTER COLUMN package_id DROP NOT NULL;
ALTER TABLE spatial_ml_batches ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'package';
ALTER TABLE spatial_ml_batches ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES cases(id);
ALTER TABLE spatial_ml_batches ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES sources(id);
ALTER TABLE spatial_ml_batches ADD COLUMN IF NOT EXISTS source_scope jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='spatial_ml_batches'::regclass AND conname='spatial_ml_batch_scope') THEN
    ALTER TABLE spatial_ml_batches ADD CONSTRAINT spatial_ml_batch_scope CHECK ((
      (scope='package' AND package_id IS NOT NULL AND case_id IS NULL AND source_id IS NULL AND source_scope IS NULL)
      OR (scope='source' AND package_id IS NULL AND case_id IS NOT NULL AND source_id IS NOT NULL
          AND source_scope IS NOT NULL AND source_scope->>'kind'='source')
    ) IS TRUE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='spatial_ml_items'::regclass AND conname='spatial_ml_item_scope') THEN
    ALTER TABLE spatial_ml_items ADD CONSTRAINT spatial_ml_item_scope CHECK ((
      package_id IS NOT NULL OR (body->'scope' IS NOT NULL AND body->'scope'->>'kind'='source'
        AND body->>'partId' IS NULL AND body->>'packageId' IS NULL)
    ) IS TRUE);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS spatial_ml_source_request_idx
  ON spatial_ml_batches(case_id,source_id,request_key) WHERE scope='source';
