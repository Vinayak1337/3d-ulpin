import type { ReactNode } from 'react';
import { Circle, Warning, WarningOctagon } from '@phosphor-icons/react';
import { Icon } from './Icon';

export type Severity = 'blocking' | 'needs-review' | 'not-assessed';

export function SeverityBadge({ severity }: { severity: Severity }) {
  if (severity === 'blocking') return <span className="ul-badge ul-badge--danger"><Icon icon={WarningOctagon} size={16} />Blocking</span>;
  if (severity === 'needs-review') return <span className="ul-badge ul-badge--warning"><Icon icon={Warning} size={16} />Needs review</span>;
  return <span className="ul-badge"><Icon icon={Circle} size={16} />Not assessed</span>;
}

/** One reproducible finding: severity, the result with its number, the arithmetic, sources, next actions. */
export function FindingCard({ severity, method, title, calculation, evidence, actions }: {
  severity: Severity; method?: string; title: string; calculation?: string[]; evidence?: ReactNode; actions?: ReactNode;
}) {
  return (
    <section className="ul-panel">
      <div className="ul-panel__body ul-stack">
        <div className="ul-row" style={{ justifyContent: 'space-between' }}>
          <SeverityBadge severity={severity} />
          {method ? <span className="ul-caption">{method}</span> : null}
        </div>
        <h2 className="ul-finding__title">{title}</h2>
        {calculation?.length ? <div className="ul-calc">{calculation.map((line) => <div key={line}>{line}</div>)}</div> : null}
        {evidence ? <div className="ul-row">{evidence}</div> : null}
      </div>
      {actions ? <footer className="ul-panel__foot">{actions}</footer> : null}
    </section>
  );
}
