import type { CSSProperties, ReactNode } from 'react';
import { Badge } from './Badge';
import { Icon, type IconName } from './Icon';

export interface Revision {
  /** "r3 Recorded", "r2 Evidence applied", "r1 Draft from 5 sources". */
  title: string;
  /** Actor and time: "R. Iyer · 24 Sep 2026, 14:10". */
  byline: string;
  /** What changed and from which evidence. */
  summary?: ReactNode;
  /** This revision's hash and the previous one, shortened: "7f3a…c2e1", "91be…04d7". */
  hash?: string;
  previousHash?: string;
  /** recorded (success dot), evidence (commit), draft (import). */
  kind?: 'recorded' | 'evidence' | 'draft';
}

export interface RevisionTimelineProps {
  /** Newest first. */
  revisions: Revision[];
  /** consistent: every hash link matches. signed: a signed head verifies. broken: danger badge at the first bad link. */
  chain?: 'consistent' | 'signed' | 'broken';
  title?: string;
  style?: CSSProperties;
}

const KIND_ICON: Record<NonNullable<Revision['kind']>, IconName> = {
  recorded: 'check-circle',
  evidence: 'git-commit',
  draft: 'file-arrow-up',
};

/**
 * The hash-chained history of one record, newest first, with a chain-state badge. Unsigned is neutral, not a failure.
 */
export function RevisionTimeline({ revisions, chain = 'consistent', title = 'History', style }: RevisionTimelineProps) {
  return (
    <div className="ul-panel" style={{ maxWidth: 460, ...style }}>
      <div className="ul-panel__head">
        <h3 className="ul-panel__title">{title}</h3>
        {chain === 'broken' ? (
          <Badge tone="danger" icon="warning-octagon">
            Chain broken
          </Badge>
        ) : (
          <Badge tone="success" icon="shield-check">
            {chain === 'signed' ? 'Chain signed and verified' : 'Chain consistent'}
          </Badge>
        )}
      </div>
      <div className="ul-panel__body">
        <ol className="ul-timeline">
          {revisions.map((r, i) => {
            const kind = r.kind ?? 'evidence';
            return (
              <li key={i}>
                <span className={kind === 'recorded' ? 'ul-dot ul-dot--done' : 'ul-dot'}>
                  <Icon name={KIND_ICON[kind]} size="sm" />
                </span>
                <div>
                  <strong>{r.title}</strong>
                  <div className="ul-muted">{r.byline}</div>
                  {r.summary && <div>{r.summary}</div>}
                  {r.hash && (
                    <div className="ul-num ul-muted">
                      {r.hash}
                      {r.previousHash && ` ← ${r.previousHash}`}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
