import type { CSSProperties, ReactNode } from 'react';
import { Button } from './Button';
import type { InspectorAction } from './Inspector';

export interface DigBand {
  /** Depth range below ground: "0.9 to 1.2 m". */
  depth: string;
  /** Swatch colour token, e.g. "var(--utility-water)". */
  color?: string;
  /** What is there. Bold the object name; utilities show size, quality letter and "tolerance not stated" unless the source states one. */
  label: ReactNode;
  /** No survey for this band: dashed Unknown row with a hatched swatch. */
  unknown?: boolean;
}

export interface DigColumnProps {
  /** "Below this trench" or "Below this point". */
  title?: string;
  /** Screened depth range, e.g. "0 to 20 m". */
  range?: string;
  /** Bands top to bottom. */
  bands: DigBand[];
  /** Records within a set distance of the column. */
  nearby?: DigBand[];
  /** Caption above the nearby list, e.g. "Within 3 m of the trench". */
  nearbyLabel?: string;
  /** Default: Export screening report (primary) and Request survey. */
  actions?: InspectorAction[];
  style?: CSSProperties;
}

function Band({ b }: { b: DigBand }) {
  return (
    <div className={b.unknown ? 'ul-band ul-band--unknown' : 'ul-band'}>
      <span className="ul-num">{b.depth}</span>
      <span
        className={b.unknown ? 'ul-swatch ul-hatch' : 'ul-swatch'}
        style={{ backgroundColor: b.unknown ? 'var(--readiness-unknown)' : b.color }}
      />
      <span>{b.label}</span>
    </div>
  );
}

/**
 * The impact-screening result for a point or trench: every recorded space and utility in the vertical column, with depth and survey quality. Screening only, never a clearance.
 */
export function DigColumn({
  title = 'Below this trench',
  range,
  bands,
  nearby,
  nearbyLabel,
  actions = [{ label: 'Export screening report', icon: 'download-simple' }, { label: 'Request survey' }],
  style,
}: DigColumnProps) {
  return (
    <div className="ul-panel" style={{ maxWidth: 480, ...style }}>
      <div className="ul-panel__head">
        <h3 className="ul-panel__title">{title}</h3>
        {range && <span className="ul-caption">{range}</span>}
      </div>
      <div className="ul-panel__body ul-stack">
        <div className="ul-help">Screening only. Not a clearance or dig permission. Unknown bands need a survey.</div>
        <div className="ul-dig">
          {bands.map((b, i) => (
            <Band key={i} b={b} />
          ))}
        </div>
        {nearby && nearby.length > 0 && (
          <>
            {nearbyLabel && <div className="ul-caption">{nearbyLabel}</div>}
            {nearby.map((b, i) => (
              <Band key={i} b={b} />
            ))}
          </>
        )}
      </div>
      {actions.length > 0 && (
        <div className="ul-panel__foot">
          {actions.map((a, i) => (
            <Button key={a.label} variant={i === 0 ? 'primary' : 'default'} icon={a.icon} onClick={a.onClick} disabled={a.disabled}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
