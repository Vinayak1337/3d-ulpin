import { LevelRail } from '@ulpin/design-system';

const LEVELS = [
  { id: 'Roof', elevation: '239.8' },
  { id: 'F8', elevation: '236.8', ghost: true },
  { id: 'F7', elevation: '233.8' },
  { id: 'F6', elevation: '230.8' },
  { id: 'F2', elevation: '218.8' },
  { id: 'F1', elevation: '215.8' },
  { id: 'G', elevation: '212.8', title: 'Ground, stilt parking' },
  { id: 'B1', elevation: '209.1', belowGround: true },
  { id: 'B2', elevation: '205.8', estimated: true, belowGround: true },
];

export const FloorSelected = () => <LevelRail reference="m · SD-1" ground="212.4" defaultSelected="F7" levels={LEVELS} />;

export const BasementSelected = () => (
  <LevelRail reference="m · SD-1" ground="212.4" defaultSelected="B2" levels={LEVELS.map((l) => ({ ...l, ghost: false }))} />
);
