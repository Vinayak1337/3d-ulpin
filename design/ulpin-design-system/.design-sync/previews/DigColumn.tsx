import { DigColumn } from '@ulpin/design-system';

export const Trench = () => (
  <DigColumn
    range="0 to 20 m"
    nearbyLabel="Within 3 m of the trench"
    bands={[
      { depth: '0.0 to 0.6 m', color: 'var(--map-road)', label: 'Paving and sub-base' },
      { depth: '0.9 to 1.2 m', color: 'var(--utility-water)', label: <><strong>Water main DN300</strong> · quality B · tolerance not stated</> },
      { depth: '1.2 to 3.0 m', unknown: true, label: <><strong>Unknown</strong> · no utility survey</> },
      { depth: '3.0 to 14.4 m', color: 'var(--soil-deep)', label: 'No recorded spaces' },
      { depth: '14.4 to 18.4 m', color: 'var(--rights-public)', label: <><strong>Metro corridor</strong> · Test fixture</> },
    ]}
    nearby={[
      { depth: '0.0 to 6.9 m', color: 'var(--soil-top)', label: <><strong>Basements B1, B2</strong> · Lake View Residence, 1.5 m from trench edge</> },
    ]}
  />
);
