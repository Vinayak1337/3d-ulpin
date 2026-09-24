import { EvidenceChip } from '@ulpin/design-system';

export const Linked = () => (
  <div className="ul-row">
    <EvidenceChip source="Sanctioned plan" locator="p.3 · r2" href="#" />
    <EvidenceChip kind="table" source="unit_inventory.xlsx" locator="row 41" href="#" />
    <EvidenceChip kind="feature" source="parcels.gpkg" locator="feature 1187" href="#" />
  </div>
);

export const Estimated = () => <EvidenceChip state="estimated" source="Estimated" locator="from nDSM height" href="#" />;

export const Missing = () => <EvidenceChip state="missing" locator="Needs evidence · request" href="#" />;
