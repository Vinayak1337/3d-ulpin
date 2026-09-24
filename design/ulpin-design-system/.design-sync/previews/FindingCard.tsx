import { FindingCard } from '@ulpin/design-system';

export const Blocking = () => (
  <FindingCard
    severity="blocking"
    method="Check v1.4 · r1"
    title="Flat 101 / Flat 201: 6.4 m³ overlap"
    calculation={['Flat 101 top 218.90 m · Flat 201 bottom 218.70 m', 'shared band 0.20 m × 32.0 m² = 6.4 m³']}
    evidence={[
      { kind: 'table', source: 'levels-r1.csv', locator: 'row 3', href: '#' },
      { state: 'estimated', source: 'Flat 201 lower', locator: 'unverified', href: '#' },
    ]}
    actions={[{ label: 'Open in 3D', icon: 'cube' }, { label: 'Request evidence' }]}
  />
);

export const NeedsReview = () => (
  <FindingCard
    severity="needs-review"
    method="Carpet area v1.0 · r2"
    title="Flat 704: carpet area 3.9 % below declared"
    calculation={['computed 69.30 m² · declared 72.00 m²', 'difference 2.70 m² = 3.9 % · tolerance 2 %']}
    evidence={[
      { source: 'Plan F7', locator: 'p.3', href: '#' },
      { source: 'Sale deed', locator: 'cl.2', href: '#' },
    ]}
    actions={[{ label: 'Review area' }, { label: 'Request evidence' }]}
  />
);

export const NotAssessed = () => (
  <FindingCard
    severity="not-assessed"
    method="Check v1.4 · r1"
    title="Overlap not assessed: open shell on Flat 305"
    calculation={['Flat 305 boundary is not closed; volume cannot be computed']}
    actions={[{ label: 'Open in 3D', icon: 'cube' }]}
  />
);
