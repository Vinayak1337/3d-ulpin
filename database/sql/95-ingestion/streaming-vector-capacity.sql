-- G16: the large GeoJSON reader reads up to 5000 parts (500,000 features). A part index may reach 5000 (the
-- terminal marker at the ceiling); a next index or sealed count 5001. Idempotent widening of the 4096/4097 checks.
DO $$
DECLARE bound text[];
BEGIN
  FOREACH bound SLICE 1 IN ARRAY ARRAY[
    ['usp_streaming_vector_imports','next_publish_index','5001'],
    ['usp_streaming_vector_imports','sealed_chunks','5001'],
    ['usp_streaming_vector_slots','chunk_index','5000'],
    ['usp_chunk_mapping_imports','next_publish_index','5001'],
    ['usp_chunk_mapping_imports','sealed_chunks','5001'],
    ['usp_chunk_mapping_slots','chunk_index','5000'],
    ['usp_streamed_profile_imports','next_raw_index','5001'],
    ['usp_streamed_profile_imports','sealed_generation','5001'],
    ['usp_streamed_profile_generations','generation','5001'],
    ['usp_streamed_profile_generations','raw_chunk_index','5000']] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', bound[1], bound[1]||'_'||bound[2]||'_check');
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=bound[1]||'_'||bound[2]||'_parts_check'
      AND conrelid=bound[1]::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK(%I>=0 AND %I<=%s)', bound[1],
        bound[1]||'_'||bound[2]||'_parts_check', bound[2], bound[2], bound[3]::integer);
    END IF;
  END LOOP;
END $$;
