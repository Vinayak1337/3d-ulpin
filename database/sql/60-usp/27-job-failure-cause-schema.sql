ALTER TABLE usp_job_attempts ADD COLUMN IF NOT EXISTS failure_cause jsonb;
