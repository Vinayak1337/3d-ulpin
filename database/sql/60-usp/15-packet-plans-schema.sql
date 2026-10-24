-- Immutable selected-target PACK0 plans beside the existing snapshot/packet authorities.
CREATE TABLE usp_packet_plans (
  id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  site_id uuid NOT NULL REFERENCES registry_sites(id), manifest_id uuid NOT NULL REFERENCES usp_snapshots(id),
  subject text NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id,version)
);
CREATE INDEX usp_packet_plans_site ON usp_packet_plans(site_id,id,version DESC);
CREATE TABLE usp_packet_plan_confirmations (
  id uuid PRIMARY KEY, plan_id uuid NOT NULL, version integer NOT NULL,
  subject text NOT NULL, body jsonb NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,version), UNIQUE(id,plan_id,version),
  FOREIGN KEY(plan_id,version) REFERENCES usp_packet_plans(id,version)
);
CREATE TABLE usp_packet_plan_executions (
  plan_id uuid NOT NULL, version integer NOT NULL, confirmation_id uuid NOT NULL,
  packet_id uuid NOT NULL UNIQUE REFERENCES usp_packets(id), body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(plan_id,version),
  FOREIGN KEY(plan_id,version) REFERENCES usp_packet_plans(id,version),
  FOREIGN KEY(confirmation_id,plan_id,version) REFERENCES usp_packet_plan_confirmations(id,plan_id,version)
);
CREATE FUNCTION usp_packet_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Packet plan versions, confirmations and executions are immutable; append a reviewed revision';
END $$;
CREATE TRIGGER usp_packet_plans_immutable BEFORE UPDATE OR DELETE ON usp_packet_plans FOR EACH ROW EXECUTE FUNCTION usp_packet_plan_immutable();
CREATE TRIGGER usp_packet_plan_confirmations_immutable BEFORE UPDATE OR DELETE ON usp_packet_plan_confirmations FOR EACH ROW EXECUTE FUNCTION usp_packet_plan_immutable();
CREATE TRIGGER usp_packet_plan_executions_immutable BEFORE UPDATE OR DELETE ON usp_packet_plan_executions FOR EACH ROW EXECUTE FUNCTION usp_packet_plan_immutable();
