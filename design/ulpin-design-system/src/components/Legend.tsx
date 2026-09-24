import type { CSSProperties, ReactNode } from 'react';

export interface LegendItem {
  label: ReactNode;
  /** Fill colour as a token reference, e.g. "var(--rights-exclusive)". */
  color?: string;
  /** 45° hatch over the fill (estimated or unknown). Unknown is always its own hatched entry. */
  hatch?: boolean;
  /** Fill opacity (illustrative geometry uses 0.35). */
  opacity?: number;
  /** Record-status key: a line sample instead of a swatch. */
  line?: 'solid' | 'dash' | 'dot';
}

export interface LegendSection {
  /** Mode name as the title: Rights, Readiness, Findings, Utilities, Evidence, Record. */
  title: string;
  items: LegendItem[];
}

export interface LegendProps {
  /** One active Colour by mode, optionally followed by the always-on Evidence and Record keys. */
  sections: LegendSection[];
  style?: CSSProperties;
}

/**
 * The floating bottom-left map legend: the active Colour by mode plus the evidence (pattern) and record (line style) keys.
 */
export function Legend({ sections, style }: LegendProps) {
  return (
    <div className="ul-float ul-legend" style={style}>
      {sections.map((s, si) => (
        <Section key={s.title} s={s} first={si === 0} />
      ))}
    </div>
  );
}

function Section({ s, first }: { s: LegendSection; first: boolean }) {
  return (
    <>
      <span className="ul-legend__title" style={first ? undefined : { marginTop: 4 }}>
        {s.title}
      </span>
      {s.items.map((it, i) => (
        <span key={i} className="ul-legend__item">
          {it.line ? (
            <span className={it.line === 'solid' ? 'ul-legend__line' : `ul-legend__line ul-legend__line--${it.line}`} />
          ) : (
            <span
              className={it.hatch ? 'ul-swatch ul-hatch' : 'ul-swatch'}
              style={{ backgroundColor: it.color ?? 'var(--map-building)', opacity: it.opacity }}
            />
          )}
          {it.label}
        </span>
      ))}
    </>
  );
}

/** The always-on evidence and record-status keys, ready to append after a Colour by section. */
export const EVIDENCE_AND_RECORD_KEYS: LegendSection[] = [
  {
    title: 'Evidence',
    items: [
      { label: 'Measured or documented' },
      { label: 'Estimated', hatch: true },
      { label: 'Illustrative', opacity: 0.35 },
    ],
  },
  {
    title: 'Record',
    items: [
      { label: 'Recorded', line: 'solid' },
      { label: 'Draft or provisional', line: 'dash' },
      { label: 'Retired', line: 'dot' },
    ],
  },
];
