import type { ReactNode } from 'react';

export interface DigBand {
  id: string;
  depth: string;
  color?: string;
  unknown?: boolean;
  label: ReactNode;
}

/** Screening result for a drawn trench. Never a clearance; unsurveyed bands are dashed Unknown rows. */
export function DigColumn({ range, bands, actions }: { range: string; bands: DigBand[]; actions?: ReactNode }) {
  return (
    <section className="ul-panel">
      <header className="ul-panel__head">
        <h2 className="ul-panel__title">Below this trench</h2>
        <span className="ul-caption ul-num">{range}</span>
      </header>
      <div className="ul-panel__body ul-dig">
        <p className="ul-help">Screening only. Not a clearance or dig permission. Unknown bands need a survey.</p>
        {bands.map((band) => (
          <div key={band.id} className={`ul-band${band.unknown ? ' ul-band--unknown' : ''}`}>
            <span className="ul-num">{band.depth}</span>
            <span className={`ul-swatch${band.unknown ? ' ul-hatch' : ''}`} style={{ backgroundColor: band.color }} />
            <span>{band.label}</span>
          </div>
        ))}
      </div>
      {actions ? <footer className="ul-panel__foot">{actions}</footer> : null}
    </section>
  );
}
