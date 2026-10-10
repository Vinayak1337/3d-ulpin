-- Intake metadata only: no reader, extraction, registry admission or case revision change.
CREATE TABLE IF NOT EXISTS usp_intake_items (
  item_id uuid PRIMARY KEY,
  source_id uuid REFERENCES sources(id),
  case_id uuid NOT NULL REFERENCES cases(id),
  parent_item_id uuid REFERENCES usp_intake_items(item_id),
  member_path text CHECK(member_path IS NULL OR length(member_path) BETWEEN 1 AND 1024),
  family text NOT NULL DEFAULT 'unknown'
    CHECK(family IN ('vector','table','raster','point_cloud','model3d','document','image','archive','unknown')),
  format text CHECK(format IS NULL OR length(format) BETWEEN 1 AND 64),
  size_bytes bigint NOT NULL CHECK(size_bytes >= 0 AND size_bytes <= 9007199254740991),
  size_class text NOT NULL CHECK(size_class IN ('S','M','L','XL')),
  wave smallint NOT NULL DEFAULT 4 CHECK(wave BETWEEN 1 AND 4),
  state text NOT NULL DEFAULT 'received'
    CHECK(state IN ('received','probed','planned','reading','read','read_to_limit','failed_part','probe_failed')),
  placement text NOT NULL DEFAULT 'undecided'
    CHECK(placement IN ('undecided','on_map','attached','waiting_for_anchor','needs_answer','not_understood')),
  card jsonb CHECK(card IS NULL OR jsonb_typeof(card) = 'object'),
  card_sha256 text CHECK(card_sha256 IS NULL OR card_sha256 ~ '^[a-f0-9]{64}$'),
  probe_version text CHECK(probe_version IS NULL OR length(probe_version) BETWEEN 1 AND 64),
  plan_ref jsonb CHECK(plan_ref IS NULL OR jsonb_typeof(plan_ref) = 'object'),
  probe_ref jsonb CHECK(probe_ref IS NULL OR jsonb_typeof(probe_ref) = 'object'),
  parts_planned integer CHECK(parts_planned > 0),
  parts_done integer NOT NULL DEFAULT 0 CHECK(parts_done >= 0),
  records_seen bigint NOT NULL DEFAULT 0 CHECK(records_seen >= 0),
  limit_reason text CHECK(limit_reason IS NULL OR length(limit_reason) BETWEEN 1 AND 2000),
  pinned_by_officer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_id IS NOT NULL OR parent_item_id IS NOT NULL),
  CHECK((parent_item_id IS NULL AND member_path IS NULL) OR (parent_item_id IS NOT NULL AND member_path IS NOT NULL)),
  CHECK(parent_item_id IS NULL OR parent_item_id <> item_id),
  CHECK((card IS NULL) = (card_sha256 IS NULL)),
  CHECK(parts_planned IS NULL OR parts_done <= parts_planned),
  UNIQUE(item_id,case_id),
  FOREIGN KEY(parent_item_id,case_id) REFERENCES usp_intake_items(item_id,case_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS usp_intake_source_idx
  ON usp_intake_items(source_id) WHERE parent_item_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS usp_intake_member_idx ON usp_intake_items(parent_item_id,member_path);
CREATE INDEX IF NOT EXISTS usp_intake_case_wave_idx ON usp_intake_items(case_id,wave,item_id);
-- Reserved for the next tasks. IN1 writes NO rows to parts, keys or extents.
CREATE TABLE IF NOT EXISTS usp_intake_parts (
  item_id uuid NOT NULL REFERENCES usp_intake_items(item_id),
  part_index integer NOT NULL CHECK(part_index >= 0),
  locator jsonb NOT NULL CHECK(jsonb_typeof(locator) = 'object'),
  priority integer NOT NULL DEFAULT 0 CHECK(priority >= 0),
  state text NOT NULL CHECK(state IN ('planned','queued','running','published','quarantined')),
  job_id uuid REFERENCES jobs(id),
  cost_memory_mb integer CHECK(cost_memory_mb >= 0),
  cost_scratch_mb integer CHECK(cost_scratch_mb >= 0),
  counts jsonb CHECK(counts IS NULL OR jsonb_typeof(counts) = 'object'),
  result_ref jsonb CHECK(result_ref IS NULL OR jsonb_typeof(result_ref) = 'object'),
  issue_code text CHECK(issue_code IS NULL OR issue_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(item_id,part_index)
);
CREATE TABLE IF NOT EXISTS usp_holding_keys (
  item_id uuid NOT NULL REFERENCES usp_intake_items(item_id),
  part_index integer NOT NULL CHECK(part_index >= 0),
  key_type text NOT NULL CHECK(length(key_type) BETWEEN 1 AND 128),
  key_norm text NOT NULL CHECK(length(key_norm) BETWEEN 1 AND 1024),
  key_raw text CHECK(key_raw IS NULL OR length(key_raw) BETWEEN 1 AND 2048),
  locator jsonb NOT NULL CHECK(jsonb_typeof(locator) = 'object'),
  FOREIGN KEY(item_id,part_index) REFERENCES usp_intake_parts(item_id,part_index)
);
CREATE INDEX IF NOT EXISTS usp_holding_key_idx ON usp_holding_keys(key_type,key_norm);
CREATE TABLE IF NOT EXISTS usp_holding_extent (
  item_id uuid NOT NULL REFERENCES usp_intake_items(item_id),
  part_index integer NOT NULL CHECK(part_index >= 0),
  bbox geometry(Polygon,4326) NOT NULL CHECK(ST_IsValid(bbox) AND NOT ST_IsEmpty(bbox)),
  crs_state text NOT NULL CHECK(crs_state IN ('stated','sidecar','absent','conflicting','not_applicable')),
  PRIMARY KEY(item_id,part_index),
  FOREIGN KEY(item_id,part_index) REFERENCES usp_intake_parts(item_id,part_index)
);
CREATE INDEX IF NOT EXISTS usp_holding_extent_idx ON usp_holding_extent USING gist(bbox);
