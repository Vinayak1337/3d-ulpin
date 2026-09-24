import { ReadinessMeter } from '@ulpin/design-system';

export const FourOfSix = () => (
  <ReadinessMeter
    task="Assign proposed 3D ULPIN"
    dimensions={[
      { name: 'Evidence', value: 1 },
      { name: 'Geometry', value: 1 },
      { name: 'Association', value: 1 },
      { name: 'Consistency', value: 0.6, label: '1 finding' },
      { name: 'Review', value: 1 },
      { name: 'Freshness', value: 'unknown' },
    ]}
  />
);

export const AllReady = () => (
  <ReadinessMeter
    task="Assign proposed 3D ULPIN"
    dimensions={['Evidence', 'Geometry', 'Association', 'Consistency', 'Review', 'Freshness'].map((name) => ({ name, value: 1 }))}
  />
);
