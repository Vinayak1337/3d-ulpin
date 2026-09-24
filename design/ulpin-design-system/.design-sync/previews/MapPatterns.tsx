import { MapPatterns } from '@ulpin/design-system';

export const Patterns = () => (
  <svg viewBox="0 0 320 120" width="320" height="120" role="img" aria-label="Map fill patterns">
    <MapPatterns />
    <rect className="m-ground" width="320" height="120" />
    <rect className="m-bldg" x="16" y="16" width="80" height="64" />
    <rect className="m-est" x="120" y="16" width="80" height="64" stroke="var(--map-building-edge)" strokeDasharray="4 3" />
    <rect x="224" y="16" width="80" height="64" fill="url(#crit)" />
    <text className="m-label" x="16" y="104">Measured</text>
    <text className="m-label" x="120" y="104">Estimated</text>
    <text className="m-label" x="224" y="104">6.4 m³ overlap</text>
  </svg>
);
