import { PropertyCard } from '@ulpin/design-system';

export const Flat704 = () => (
  <PropertyCard
    title="Flat 704, Lake View Residence"
    code="P3-7Q4M2R8T6V0W3X5Y9ZAB-R4"
    location="MH2507A1B3C4D5 / S01 / F07 / R003"
    revision="r3"
    hash="7f3a…c2e1"
    facts={[
      { label: 'Parcel ULPIN', value: 'MH2507A1B3C4D5', mono: true },
      { label: 'Level', value: 'F7 · 233.80 to 236.80 m · site datum SD-1' },
      { label: 'Carpet area', value: '69.30 m² (from plan components) · 72.00 m² declared' },
      { label: 'Undivided share', value: '1.84 % of parcel' },
      { label: 'Rights', value: 'Exclusive unit; shares Stair S1, Lift L1' },
      { label: 'Evidence', value: 'Sanctioned plan p.3, Declaration sch.B, Sale deed cl.2' },
    ]}
  />
);
