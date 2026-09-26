import { CheckCircle, GitCommit, FilePlus } from '@phosphor-icons/react';
import { Icon } from './Icon';

export interface Revision {
  id: string;
  title: string;
  byline: string;
  hash?: string | null;
  previousHash?: string | null;
  kind: 'recorded' | 'evidence' | 'draft';
}

/** History of one record. "Chain consistent" only when every link matches; unsigned is neutral. */
export function RevisionTimeline({ revisions, chain }: { revisions: Revision[]; chain: 'consistent' | 'broken' | 'unknown' }) {
  return (
    <section className="ul-panel">
      <header className="ul-panel__head">
        <h2 className="ul-panel__title">History</h2>
        {chain === 'consistent' ? <span className="ul-badge ul-badge--success">Chain consistent</span>
          : chain === 'broken' ? <span className="ul-badge ul-badge--danger">Chain broken</span>
            : <span className="ul-badge">Chain not checked</span>}
      </header>
      <div className="ul-panel__body">
        <ol className="ul-timeline">
          {revisions.map((revision) => (
            <li key={revision.id}>
              <span className={`ul-dot${revision.kind === 'recorded' ? ' ul-dot--done' : ''}`}>
                <Icon icon={revision.kind === 'recorded' ? CheckCircle : revision.kind === 'evidence' ? GitCommit : FilePlus} size={16} />
              </span>
              <span>
                <strong>{revision.title}</strong>
                <span className="ul-timeline__by">{revision.byline}</span>
                {revision.hash ? <span className="ul-timeline__hash ul-mono">{revision.hash}{revision.previousHash ? ` ← ${revision.previousHash}` : ''}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
