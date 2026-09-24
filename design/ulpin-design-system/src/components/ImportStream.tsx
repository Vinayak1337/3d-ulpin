import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface ImportRow {
  /** File name, shown bold. */
  file: string;
  /** What was detected or mapped: "214 parcels · CRS EPSG:32643 detected". */
  detail: ReactNode;
  /** saved (success), attention (needs a person), running (progress bar), error (reader missing or failed). */
  state: 'saved' | 'attention' | 'running' | 'error';
  /** Running: progress 0–100. */
  progress?: number;
  /** Only rows that need a person get an action: "Review 1 mapping". */
  action?: { label: string; onClick?: () => void };
  /** Quiet right-hand status word when there is no action; defaults to "Saved" or the progress %. */
  status?: string;
}

export interface ImportStreamProps {
  /** "Importing Lake View bundle". */
  title: string;
  /** "186 spaces saved". */
  meta?: string;
  rows: ImportRow[];
  style?: CSSProperties;
}

const STATE: Record<ImportRow['state'], { icon: IconName; color: string }> = {
  saved: { icon: 'check-circle', color: 'var(--success)' },
  attention: { icon: 'warning', color: 'var(--warning)' },
  running: { icon: 'file-text', color: 'var(--ink-muted)' },
  error: { icon: 'warning-octagon', color: 'var(--danger)' },
};

/**
 * The live list of an import in progress: one row per file with what was detected, what was mapped, and what needs a decision.
 */
export function ImportStream({ title, meta, rows, style }: ImportStreamProps) {
  return (
    <div className="ul-panel" style={{ maxWidth: 600, ...style }}>
      <div className="ul-panel__head">
        <h3 className="ul-panel__title">{title}</h3>
        {meta && <span className="ul-caption">{meta}</span>}
      </div>
      <div className="ul-panel__body" style={{ padding: 8 }}>
        <div className="ul-stream">
          {rows.map((r) => (
            <div key={r.file} className="ul-srow">
              <span style={{ color: STATE[r.state].color }}>
                <Icon name={STATE[r.state].icon} />
              </span>
              <span>
                <strong>{r.file}</strong> · {r.detail}
                {r.state === 'running' && (
                  <div className="ul-progress">
                    <i style={{ width: `${r.progress ?? 0}%` }} />
                  </div>
                )}
              </span>
              {r.action ? (
                <button type="button" className="ul-btn ul-btn--soft" style={{ height: 32 }} onClick={r.action.onClick}>
                  {r.action.label}
                </button>
              ) : (
                <span className="ul-caption">{r.status ?? (r.state === 'running' ? `${r.progress ?? 0} %` : r.state === 'saved' ? 'Saved' : '')}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
