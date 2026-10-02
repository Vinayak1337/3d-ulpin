-- Immutable bounded card derivatives; the executed plan and packet remain authoritative.
CREATE TABLE usp_property_cards (
  id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
  site_id uuid NOT NULL REFERENCES registry_sites(id), manifest_id uuid NOT NULL REFERENCES usp_snapshots(id),
  plan_id uuid NOT NULL, plan_version integer NOT NULL,
  packet_id uuid NOT NULL REFERENCES usp_packets(id), subject text NOT NULL,
  artifact_hash text NOT NULL CHECK(artifact_hash ~ '^[a-f0-9]{64}$'), object_key text NOT NULL UNIQUE,
  body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id,revision),
  FOREIGN KEY(plan_id,plan_version) REFERENCES usp_packet_plan_executions(plan_id,version)
);
CREATE INDEX usp_property_cards_site ON usp_property_cards(site_id,id,revision DESC);
CREATE FUNCTION usp_property_card_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Property card revisions are immutable; append a guarded revision';
END $$;
CREATE TRIGGER usp_property_cards_immutable BEFORE UPDATE OR DELETE ON usp_property_cards FOR EACH ROW EXECUTE FUNCTION usp_property_card_immutable();
