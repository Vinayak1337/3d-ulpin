-- Questions are a bounded projection over canonical source evidence. Immutable
-- evaluation/answer receipts remain in operations; source/registry authorities do not move.
CREATE TABLE IF NOT EXISTS usp_ingestion_questions (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  source_id uuid NOT NULL REFERENCES sources(id),
  gap_class text NOT NULL,
  owner_subject text NOT NULL,
  access_sha256 text NOT NULL CHECK(access_sha256 ~ '^[a-f0-9]{64}$'),
  context_sha256 text NOT NULL CHECK(context_sha256 ~ '^[a-f0-9]{64}$'),
  revision integer NOT NULL CHECK(revision > 0),
  state text NOT NULL CHECK(state IN ('open','answered','parked','stale')),
  body jsonb NOT NULL CHECK(octet_length(body::text)<=16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(body->>'id'=id::text AND body->>'state'=state),
  CHECK((body->>'revision')::integer=revision),
  CHECK(body#>>'{pins,caseId}'=case_id::text AND body#>>'{pins,sourceId}'=source_id::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS usp_ingestion_question_group
  ON usp_ingestion_questions(case_id,source_id,gap_class) WHERE state<>'stale';
CREATE INDEX IF NOT EXISTS usp_ingestion_question_case ON usp_ingestion_questions(case_id,state,created_at,id);
CREATE INDEX IF NOT EXISTS usp_sufficiency_receipts ON operations(case_id,created_at DESC,operation_key)
  WHERE kind='ingestion-sufficiency';
