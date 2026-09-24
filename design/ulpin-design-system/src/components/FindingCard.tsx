import type { CSSProperties, ReactNode } from 'react';
import { Badge } from './Badge';
import { Button } from './Button';
import { EvidenceChip, type EvidenceChipProps } from './EvidenceChip';
import type { InspectorAction } from './Inspector';

export interface FindingCardProps {
  /** Blocking (danger), needs review (warning), info, or not assessed (neutral). */
  severity: 'blocking' | 'needs-review' | 'info' | 'not-assessed';
  /** Result with its number: "Flat 101 / Flat 201: 6.4 m³ overlap". */
  title: string;
  /** Method and revision: "Check v1.4 · r1". */
  method?: string;
  /** The arithmetic, one line per step, so an officer can check it by hand. */
  calculation?: ReactNode[];
  /** Sources involved. */
  evidence?: EvidenceChipProps[];
  /** Usually Open in 3D (primary) and Request evidence. Mark resolved only when new evidence is applied. */
  actions?: InspectorAction[];
  style?: CSSProperties;
}

const SEVERITY = {
  blocking: { status: 'Blocking', tone: 'danger' },
  'needs-review': { status: 'Needs review', tone: 'warning' },
  info: { status: 'Info', tone: 'info' },
  'not-assessed': { status: 'Not assessed', tone: 'neutral' },
} as const;

/**
 * One reproducible finding: severity badge, the result, its arithmetic, its sources and the next actions.
 */
export function FindingCard({ severity, title, method, calculation, evidence, actions, style }: FindingCardProps) {
  const sev = SEVERITY[severity];
  return (
    <article className="ul-panel" style={{ maxWidth: 440, ...style }}>
      <div className="ul-panel__body ul-stack">
        <div className="ul-row" style={{ justifyContent: 'space-between' }}>
          {severity === 'info' ? (
            <Badge tone="info" icon="info">
              Info
            </Badge>
          ) : (
            <Badge status={sev.status as 'Blocking' | 'Needs review' | 'Not assessed'} />
          )}
          {method && <span className="ul-caption">{method}</span>}
        </div>
        <h3 className="ul-finding__title">{title}</h3>
        {calculation && calculation.length > 0 && (
          <div className="ul-calc">
            {calculation.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
        {evidence && evidence.length > 0 && (
          <div className="ul-row">
            {evidence.map((e, i) => (
              <EvidenceChip key={i} {...e} />
            ))}
          </div>
        )}
      </div>
      {actions && actions.length > 0 && (
        <div className="ul-panel__foot">
          {actions.map((a, i) => (
            <Button key={a.label} variant={i === 0 ? 'primary' : 'default'} icon={a.icon} onClick={a.onClick} disabled={a.disabled}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}
