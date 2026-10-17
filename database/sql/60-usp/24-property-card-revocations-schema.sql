-- Append-only revocations of exact card revisions. The card row and its PDF are never altered or removed.
CREATE TABLE usp_property_card_revocations (
  card_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
  subject text NOT NULL, reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=16384),
  revoked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(card_id,revision),
  FOREIGN KEY(card_id,revision) REFERENCES usp_property_cards(id,revision)
);
CREATE FUNCTION usp_property_card_revocation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Property card revocations are append-only; a revocation is never changed or withdrawn';
END $$;
CREATE TRIGGER usp_property_card_revocations_immutable
  BEFORE UPDATE OR DELETE ON usp_property_card_revocations
  FOR EACH ROW EXECUTE FUNCTION usp_property_card_revocation_immutable();
