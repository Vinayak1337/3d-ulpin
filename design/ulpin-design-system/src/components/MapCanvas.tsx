import type { CSSProperties, ReactNode } from 'react';

export interface MapCanvasProps {
  /** Scene content: an SVG using the `m-*` scene classes, or a 3D view. Floating chrome (MapToolbar, LevelRail, Legend) goes in `overlays`. */
  children?: ReactNode;
  /** Absolutely positioned chrome; place each with `style={{ position: 'absolute', ... }}`. */
  overlays?: ReactNode;
  /** Canvas height (default fills its container). */
  height?: number | string;
  style?: CSSProperties;
}

/**
 * The map canvas frame on `map-ground` with `radius-12`: the centre of every Studio map screen.
 */
export function MapCanvas({ children, overlays, height, style }: MapCanvasProps) {
  return (
    <div className="ul-canvas" style={{ height, ...style }}>
      {children}
      {overlays}
    </div>
  );
}

/**
 * SVG `<defs>` for the two map patterns: `url(#hatch)` (estimated geometry over map-building) and `url(#crit)` (a finding solid in mark-critical).
 * Put inside any scene `<svg>` that uses the `m-est` class or the critical fill.
 */
export function MapPatterns() {
  return (
    <defs>
      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--map-building)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-muted)" strokeWidth="1.5" />
      </pattern>
      <pattern id="crit" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--mark-critical)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--map-halo)" strokeWidth="1.2" />
      </pattern>
    </defs>
  );
}

export interface MapStyleProps {
  /** Label of the selected building. */
  selectedLabel?: string;
  /** Parcel ULPIN drawn at the selected parcel. */
  parcelCode?: string;
  /** Finding label on the red hatched solid. */
  findingLabel?: string;
  /** Utility label along the service lane. */
  utilityLabel?: string;
  style?: CSSProperties;
}

/**
 * The reference plan-view rendering of the base scene: neutral ground, roads, parcel lines, grey massing at context opacity,
 * one green selection with halo, estimated geometry hatched, a finding as its own red hatched solid, and a utility line.
 */
export function MapStyle({
  selectedLabel = 'Lake View Residence',
  parcelCode = 'MH2507A1B3C4D5',
  findingLabel = '6.4 m³ overlap',
  utilityLabel = 'Water main DN300 · B · tolerance not stated',
  style,
}: MapStyleProps) {
  return (
    <div className="ul-canvas" style={{ maxWidth: 720, ...style }}>
      <svg viewBox="0 0 720 320" width="100%" role="img" aria-label="Plan view map style sample">
        <MapPatterns />
        <rect className="m-ground" width="720" height="320" />
        <rect className="m-road" x="0" y="232" width="720" height="44" />
        <rect className="m-road" x="452" y="0" width="40" height="232" />
        <rect className="m-public" x="508" y="20" width="192" height="92" rx="4" />
        <rect className="m-water" x="560" y="136" width="120" height="64" rx="20" />
        <path className="m-water-line" d="M0 262 H720" />
        <g className="m-ctx">
          <rect className="m-bldg" x="36" y="36" width="110" height="80" />
          <rect className="m-bldg" x="36" y="138" width="110" height="70" />
          <rect className="m-bldg" x="330" y="30" width="100" height="92" />
        </g>
        <rect className="m-parcel" x="24" y="24" width="140" height="196" />
        <rect className="m-parcel" x="176" y="24" width="140" height="196" />
        <rect className="m-parcel" x="320" y="24" width="120" height="196" />
        <rect className="m-halo" x="196" y="48" width="100" height="120" />
        <rect className="m-sel" x="196" y="48" width="100" height="120" />
        <rect x="330" y="140" width="100" height="64" className="m-est" stroke="var(--map-building-edge)" strokeDasharray="4 3" />
        <rect x="266" y="120" width="30" height="48" fill="url(#crit)" />
        <text className="m-label" x="204" y="66">
          {selectedLabel}
        </text>
        <text className="m-label" x="270" y="188">
          {findingLabel}
        </text>
        <text className="m-label" x="336" y="158">
          Height estimated
        </text>
        <text className="m-code" x="180" y="214">
          {parcelCode}
        </text>
        <text className="m-label" x="12" y="254">
          {utilityLabel}
        </text>
        <text className="m-label" x="516" y="36">
          Public land
        </text>
      </svg>
    </div>
  );
}
