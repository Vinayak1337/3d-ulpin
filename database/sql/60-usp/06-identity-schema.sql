
      CREATE TABLE IF NOT EXISTS usp_project_identity_reviews (
        id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES registry_sites(id),
        manifest_id uuid NOT NULL REFERENCES usp_snapshots(id),
        operation text NOT NULL, command_hash text NOT NULL,
        reviewer_subject text NOT NULL, body jsonb NOT NULL,
        consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS usp_project_codes (
        code text PRIMARY KEY CHECK (code ~ '^P3-[0-9A-HJKMNP-TV-Z]{20}-[0-9A-HJKMNP-TV-Z]{2}$'),
        record_id uuid NOT NULL UNIQUE REFERENCES registry_records(id),
        scope_id uuid NOT NULL REFERENCES registry_sites(id),
        status text NOT NULL CHECK (status IN ('assigned','retired','cancelled_error')),
        review_id uuid NOT NULL REFERENCES usp_project_identity_reviews(id),
        assigned_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE FUNCTION usp_project_code_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'A P3 reservation cannot be deleted';
        END IF;
        IF NEW.code IS DISTINCT FROM OLD.code OR NEW.record_id IS DISTINCT FROM OLD.record_id
          OR NEW.scope_id IS DISTINCT FROM OLD.scope_id OR NEW.review_id IS DISTINCT FROM OLD.review_id
          OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
          OR NEW.status IS DISTINCT FROM OLD.status AND NOT
            (OLD.status = 'assigned' AND NEW.status IN ('retired','cancelled_error')) THEN
          RAISE EXCEPTION 'A P3 reservation is immutable except for terminal status';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER usp_project_code_guard_trigger BEFORE UPDATE OR DELETE ON usp_project_codes
        FOR EACH ROW EXECUTE FUNCTION usp_project_code_guard();
      CREATE TABLE IF NOT EXISTS usp_project_identity_state (
        record_id uuid PRIMARY KEY REFERENCES registry_records(id),
        location jsonb NOT NULL, review_id uuid NOT NULL REFERENCES usp_project_identity_reviews(id),
        version integer NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usp_project_identity_audit (
        id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES registry_sites(id),
        review_id uuid NOT NULL REFERENCES usp_project_identity_reviews(id),
        operation text NOT NULL, record_ids uuid[] NOT NULL, receipt_id uuid NOT NULL,
        body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS usp_project_lineage (
        id uuid PRIMARY KEY, scope_id uuid NOT NULL REFERENCES registry_sites(id),
        kind text NOT NULL CHECK (kind IN ('split','merge','boundary_adjustment')),
        predecessor_id uuid NOT NULL REFERENCES registry_records(id),
        successor_id uuid NOT NULL REFERENCES registry_records(id),
        review_id uuid NOT NULL REFERENCES usp_project_identity_reviews(id),
        evidence jsonb NOT NULL, transferred_geometry jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK(predecessor_id <> successor_id), UNIQUE(kind,predecessor_id,successor_id,review_id)
      );
    