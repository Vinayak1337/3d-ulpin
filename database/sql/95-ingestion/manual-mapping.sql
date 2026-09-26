CREATE TABLE IF NOT EXISTS usp_mapping_recipes (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  source_id uuid NOT NULL UNIQUE REFERENCES sources(id),
  revision integer NOT NULL CHECK(revision > 0),
  state text NOT NULL CHECK(state IN ('proposed','approved','executed')),
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usp_mapping_recipe_revisions (
  recipe_id uuid NOT NULL REFERENCES usp_mapping_recipes(id),
  revision integer NOT NULL CHECK(revision > 0),
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(recipe_id,revision)
);
