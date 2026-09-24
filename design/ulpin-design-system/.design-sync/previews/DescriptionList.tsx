import { Badge, DescriptionList, EvidenceChip } from '@ulpin/design-system';

export const UnitFacts = () => (
  <div style={{ width: 360 }}>
    <DescriptionList
      items={[
        { label: 'Level', value: 'F7 · 233.80 to 236.80 m · SD-1' },
        { label: 'Carpet area', value: <>69.30 m² <EvidenceChip source="Plan F7" locator="p.3" href="#" /></> },
        { label: 'Undivided share', value: <>1.84 % <EvidenceChip source="Declaration" locator="sch.B" href="#" /></> },
        { label: 'Parcel ULPIN', value: 'MH2507A1B3C4D5', mono: true },
      ]}
    />
  </div>
);

export const WithUnknown = () => (
  <div style={{ width: 360 }}>
    <DescriptionList
      items={[
        { label: 'Parking', value: <>Unknown <EvidenceChip state="missing" locator="Request evidence" href="#" /></> },
        { label: 'B2 lower limit', value: '205.8 m est. · SD-1' },
        { label: 'Anchor state', value: <Badge status="Reviewed" /> },
      ]}
    />
  </div>
);
