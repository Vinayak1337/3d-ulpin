import { CarpetAreaCheck } from '@ulpin/design-system';

export const OverTolerance = () => (
  <CarpetAreaCheck
    unit="Flat 704"
    grossInternal={74.38}
    deductions={[
      { label: 'Less service shaft', area: 0.88 },
      { label: 'Less exclusive balcony', area: 4.2 },
    ]}
    declared={72}
    declaredEvidence={{ source: 'Sale deed', locator: 'cl.2', href: '#' }}
    tolerancePct={2}
  />
);

export const WithinTolerance = () => (
  <CarpetAreaCheck
    unit="Flat 701"
    grossInternal={76.02}
    deductions={[
      { label: 'Less service shaft', area: 0.72 },
      { label: 'Less exclusive balcony', area: 4.2 },
    ]}
    declared={71.5}
    declaredEvidence={{ source: 'Sale deed', locator: 'cl.2', href: '#' }}
    tolerancePct={2}
  />
);
