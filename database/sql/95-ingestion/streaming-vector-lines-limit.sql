-- A fully hashed line-framed original may seal its parsed prefix while retaining a counted, unread tail.
ALTER TABLE usp_streaming_vector_imports
  ADD COLUMN IF NOT EXISTS lines_beyond_limit integer NOT NULL DEFAULT 0 CHECK(lines_beyond_limit>=0);
