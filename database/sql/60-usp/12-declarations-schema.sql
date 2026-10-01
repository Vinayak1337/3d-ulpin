-- Source-defined claims beside the canonical registry. All feature rows are append-only.
-- The fence is transaction metadata, not a second record/declaration authority.
CREATE TABLE usp_declaration_scope_fences (
  site_id uuid PRIMARY KEY REFERENCES registry_sites(id), fence bigint NOT NULL DEFAULT 0
);
CREATE TABLE usp_declaration_proposals (
  id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES registry_sites(id),
  manifest_id uuid NOT NULL REFERENCES usp_snapshots(id), subject text NOT NULL,
  version integer NOT NULL CHECK(version=1), body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE usp_declaration_reviews (
  id uuid PRIMARY KEY, proposal_id uuid NOT NULL UNIQUE REFERENCES usp_declaration_proposals(id),
  site_id uuid NOT NULL REFERENCES registry_sites(id), subject text NOT NULL,
  body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE usp_declaration_revisions (
  id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
  site_id uuid NOT NULL REFERENCES registry_sites(id),
  proposal_id uuid NOT NULL UNIQUE REFERENCES usp_declaration_proposals(id),
  review_id uuid NOT NULL UNIQUE REFERENCES usp_declaration_reviews(id),
  body jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(id,revision)
);
CREATE INDEX usp_declarations_site ON usp_declaration_revisions(site_id,id,revision DESC);
CREATE TABLE usp_declaration_entries (
  id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
  declaration_id uuid NOT NULL, declaration_revision integer NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(id,revision),
  FOREIGN KEY(declaration_id,declaration_revision) REFERENCES usp_declaration_revisions(id,revision)
);
CREATE INDEX usp_declaration_entries_parent ON usp_declaration_entries(declaration_id,declaration_revision);
CREATE TABLE usp_declaration_applicability (
  id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
  declaration_id uuid NOT NULL, declaration_revision integer NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY(id,revision),
  FOREIGN KEY(declaration_id,declaration_revision) REFERENCES usp_declaration_revisions(id,revision)
);
CREATE INDEX usp_declaration_applicability_parent ON usp_declaration_applicability(declaration_id,declaration_revision);
CREATE TABLE usp_declaration_commit_links (
  proposal_id uuid PRIMARY KEY REFERENCES usp_declaration_proposals(id),
  review_id uuid NOT NULL UNIQUE REFERENCES usp_declaration_reviews(id),
  receipt_id uuid NOT NULL UNIQUE,
  declaration_id uuid NOT NULL, declaration_revision integer NOT NULL,
  FOREIGN KEY(declaration_id,declaration_revision) REFERENCES usp_declaration_revisions(id,revision),
  FOREIGN KEY(receipt_id) REFERENCES usp_command_receipts(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE FUNCTION usp_declaration_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Declaration proposals, reviews and accepted revisions are immutable; append a reviewed amendment';
END $$;
CREATE TRIGGER usp_declaration_proposals_immutable BEFORE UPDATE OR DELETE ON usp_declaration_proposals FOR EACH ROW EXECUTE FUNCTION usp_declaration_immutable();
CREATE TRIGGER usp_declaration_reviews_immutable BEFORE UPDATE OR DELETE ON usp_declaration_reviews FOR EACH ROW EXECUTE FUNCTION usp_declaration_immutable();
CREATE TRIGGER usp_declaration_revisions_immutable BEFORE UPDATE OR DELETE ON usp_declaration_revisions FOR EACH ROW EXECUTE FUNCTION usp_declaration_immutable();
CREATE TRIGGER usp_declaration_entries_immutable BEFORE UPDATE OR DELETE ON usp_declaration_entries FOR EACH ROW EXECUTE FUNCTION usp_declaration_immutable();
CREATE TRIGGER usp_declaration_applicability_immutable BEFORE UPDATE OR DELETE ON usp_declaration_applicability FOR EACH ROW EXECUTE FUNCTION usp_declaration_immutable();
CREATE TRIGGER usp_declaration_commit_links_immutable BEFORE UPDATE OR DELETE ON usp_declaration_commit_links FOR EACH ROW EXECUTE FUNCTION usp_declaration_immutable();
