ALTER TABLE usp_intake_items DROP CONSTRAINT usp_intake_items_state_check;
ALTER TABLE usp_intake_items ADD CONSTRAINT usp_intake_items_state_check
  CHECK(state IN ('received','probed','planned','reading','preparing','read','read_to_limit','failed_part','probe_failed'));
