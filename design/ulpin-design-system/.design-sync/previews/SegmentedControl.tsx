import { SegmentedControl } from '@ulpin/design-system';

export const View = () => (
  <SegmentedControl aria-label="View" options={[{ value: '3D', label: '3D', icon: 'cube' }, { value: '2D', label: '2D', icon: 'map-trifold' }]} />
);

export const Render = () => (
  <SegmentedControl aria-label="Render" defaultValue="Volumes" options={[{ value: 'Model', label: 'Model' }, { value: 'Volumes', label: 'Volumes' }]} />
);

export const Camera = () => (
  <SegmentedControl
    aria-label="Camera"
    options={[{ value: 'Plan', label: 'Plan' }, { value: 'Oblique', label: 'Oblique' }, { value: 'Section', label: 'Section' }]}
  />
);
