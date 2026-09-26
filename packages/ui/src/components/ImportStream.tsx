import type { ReactNode } from 'react';
import { CheckCircle, CircleNotch, Warning, WarningOctagon } from '@phosphor-icons/react';
import { Icon } from './Icon';

export interface StreamRow {
  id: string;
  file: string;
  state: 'saved' | 'attention' | 'running' | 'failed';
  detail: string;
  progress?: number;
  action?: ReactNode;
}

/** Live list of an import: one row per file; only rows needing a person show an action. */
export function ImportStream({ title, meta, rows, aside }: { title: string; meta?: string; rows: StreamRow[]; aside?: ReactNode }) {
  return (
    <section className="ul-panel" aria-live="polite">
      <header className="ul-panel__head">
        <h2 className="ul-panel__title">{title}</h2>
        <span className="ul-row">{meta ? <span className="ul-caption">{meta}</span> : null}{aside}</span>
      </header>
      <div className="ul-stream">
        {rows.map((row) => (
          <div key={row.id} className="ul-srow">
            <Icon
              icon={row.state === 'saved' ? CheckCircle : row.state === 'running' ? CircleNotch : row.state === 'failed' ? WarningOctagon : Warning}
              size={16}
              className={`ul-srow__icon ul-srow__icon--${row.state}`}
            />
            <span>
              <strong className="ul-mono">{row.file}</strong> · {row.detail}
              {row.state === 'running' && row.progress !== undefined ? (
                <span className="ul-progress" role="progressbar" aria-valuenow={row.progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${row.progress}%` }} /></span>
              ) : null}
            </span>
            {row.action ?? <span className="ul-caption">{row.state === 'saved' ? 'Saved' : row.state === 'failed' ? 'Failed' : row.state === 'running' ? 'Reading' : ''}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
