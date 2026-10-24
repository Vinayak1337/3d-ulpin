-- Reject-only source-candidate receipts create no package. Existing rows and the foreign key remain unchanged.
ALTER TABLE spatial_ml_footprint_drafts ALTER COLUMN package_id DROP NOT NULL;
