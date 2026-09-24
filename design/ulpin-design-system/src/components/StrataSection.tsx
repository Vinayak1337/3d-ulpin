import type { CSSProperties } from 'react';

export interface StrataLevel {
  /** Label drawn on the slab when selected or below ground, e.g. "F7 · Flat 704", "B1 · parking". */
  label?: string;
  /** Lower elevation shown at the right, e.g. "233.8". */
  elevation?: string;
  /** Limits estimated: dashed outline. */
  estimated?: boolean;
}

export interface StrataSectionProps {
  /** Parcel ULPIN named in the accessible label. */
  parcel: string;
  /** Above-ground levels, top (roof side) to bottom (ground floor). Up to 12. */
  levels: StrataLevel[];
  /** Index into `levels` of the selected space (drawn in primary with an on-primary label). */
  selected?: number;
  /** Roof elevation label, e.g. "239.8 roof". */
  roof?: string;
  /** Ground line label, e.g. "212.4 ground". */
  ground?: string;
  /** Basements, top to bottom (up to 3). */
  basements?: StrataLevel[];
  /** Air-rights envelope label, e.g. "Air-rights envelope to 254.0 m". Omit to hide. */
  airRights?: string;
  /** Utility label at its depth, e.g. "Water main (B)". */
  utility?: string;
  /** Corridor label, e.g. "Metro corridor · test fixture", and its depth range. */
  corridor?: string;
  corridorRange?: string;
  style?: CSSProperties;
}

/**
 * A schematic vertical section of one parcel: airspace, levels, the ground line, basements, a utility and a corridor, each labelled with its elevation.
 */
export function StrataSection({
  parcel,
  levels,
  selected,
  roof,
  ground,
  basements = [],
  airRights,
  utility,
  corridor,
  corridorRange,
  style,
}: StrataSectionProps) {
  const top = 60;
  const groundY = 190;
  const h = (groundY - top) / Math.max(1, levels.length);
  return (
    <div className="ul-panel" style={{ maxWidth: 560, ...style }}>
      <div className="ul-panel__body" style={{ padding: 12 }}>
        <svg viewBox="0 0 520 330" width="100%" role="img" aria-label={`Vertical section of parcel ${parcel}`}>
          <rect className="s-sky" x="0" y="0" width="520" height="190" />
          <rect className="s-soil" x="0" y="190" width="520" height="70" />
          <rect className="s-soil2" x="0" y="260" width="520" height="70" />
          {airRights && (
            <>
              <rect className="s-air" x="110" y="12" width="220" height="44" />
              <text className="s-name" x="118" y="30">
                {airRights}
              </text>
            </>
          )}
          {levels.map((l, i) => {
            const y = top + i * h;
            const sel = i === selected;
            return (
              <g key={i}>
                <rect className={sel ? 's-sel' : 's-level'} x="110" y={y} width="220" height={h} strokeDasharray={l.estimated ? '4 3' : undefined} />
                {sel && l.label && (
                  <text className="s-onsel" x="118" y={y + h / 2 + 4}>
                    {l.label}
                  </text>
                )}
                {sel && l.elevation && (
                  <text className="s-text" x="344" y={y + h / 2 + 4}>
                    {l.elevation}
                  </text>
                )}
              </g>
            );
          })}
          {roof && (
            <text className="s-text" x="344" y={top + 8}>
              {roof}
            </text>
          )}
          <line className="s-ground" x1="0" y1={groundY} x2="520" y2={groundY} />
          {ground && (
            <text className="s-text" x="6" y={groundY - 4}>
              {ground}
            </text>
          )}
          {basements.slice(0, 3).map((b, i) => {
            const y = groundY + 2 + i * 22;
            return (
              <g key={i}>
                <rect className="s-level" x="110" y={y} width="220" height="22" strokeDasharray={b.estimated ? '4 3' : undefined} />
                {b.label && (
                  <text className="s-name" x="118" y={y + 15}>
                    {b.label}
                  </text>
                )}
                {b.elevation && (
                  <text className="s-text" x="344" y={y + 26}>
                    {b.elevation}
                  </text>
                )}
              </g>
            );
          })}
          {utility && (
            <>
              <circle cx="400" cy="206" r="6" fill="var(--utility-water)" />
              <text className="s-name" x="412" y="210">
                {utility}
              </text>
            </>
          )}
          {corridor && (
            <>
              <rect className="s-tunnel" x="330" y="276" width="182" height="34" rx="17" />
              <text className="s-name" x="344" y="297">
                {corridor}
              </text>
              {corridorRange && (
                <text className="s-text" x="222" y="298">
                  {corridorRange}
                </text>
              )}
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
