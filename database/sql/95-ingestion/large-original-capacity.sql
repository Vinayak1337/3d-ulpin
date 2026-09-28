-- Additive transport capacity only. Existing receipts keep the v1 contract in application validation.
ALTER TABLE usp_source_uploads DROP CONSTRAINT IF EXISTS usp_source_uploads_original_bytes_check;
ALTER TABLE usp_source_upload_parts DROP CONSTRAINT IF EXISTS usp_source_upload_parts_part_number_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='usp_source_uploads_original_bytes_capacity_check'
    AND conrelid='usp_source_uploads'::regclass) THEN
    ALTER TABLE usp_source_uploads ADD CONSTRAINT usp_source_uploads_original_bytes_capacity_check
      CHECK(original_bytes>0 AND original_bytes<=7516192768);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='usp_source_upload_parts_part_number_capacity_check'
    AND conrelid='usp_source_upload_parts'::regclass) THEN
    ALTER TABLE usp_source_upload_parts ADD CONSTRAINT usp_source_upload_parts_part_number_capacity_check
      CHECK(part_number BETWEEN 1 AND 896);
  END IF;
END $$;
