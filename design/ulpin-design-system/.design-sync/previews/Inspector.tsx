import { EvidenceChip, Inspector } from '@ulpin/design-system';

export const Flat704 = () => (
  <Inspector
    title="Flat 704"
    status="Needs review"
    code="P3-7Q4M2R8T6V0W3X5Y9ZAB-R4"
    location="MH2507A1B3C4D5 / S01 / F07 / R003"
    facts={[
      { label: 'Level', value: 'F7 · 233.80 to 236.80 m · SD-1' },
      { label: 'Carpet area', value: <>69.30 m² <EvidenceChip source="Plan F7" locator="p.3" href="#" /></> },
      { label: 'Declared area', value: <>72.00 m² <EvidenceChip source="Sale deed" locator="cl.2" href="#" /></> },
      { label: 'Undivided share', value: <>1.84 % <EvidenceChip source="Declaration" locator="sch.B" href="#" /></> },
      { label: 'Shared spaces', value: 'Stair S1, Lift L1' },
      { label: 'Parking', value: <>Covered stilt <EvidenceChip state="missing" locator="Needs evidence" /></> },
    ]}
    primaryAction={{ label: 'Review area' }}
    secondaryAction={{ label: 'Open in 3D', icon: 'cube' }}
  />
);

export const Building = () => (
  <Inspector
    title="Lake View Residence"
    status="Reviewed"
    location="Parcel ULPIN MH2507A1B3C4D5"
    tabs={['Overview', 'Rights', 'Evidence', 'Checks', 'History']}
    facts={[
      { label: 'Address', value: '12 Lake View Road' },
      { label: 'Levels', value: 'Ground plus 8, stilt parking, B1 and B2' },
      { label: 'Units', value: '55' },
      { label: 'Readiness', value: 'Assign proposed 3D ULPIN: 4 of 6 ready' },
      { label: 'Open findings', value: '2' },
    ]}
    primaryAction={{ label: 'Open register' }}
    secondaryAction={{ label: 'Explore floors', icon: 'stack' }}
  />
);
