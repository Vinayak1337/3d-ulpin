import type { ReactNode } from 'react';
import { ReadingStatementsContext } from '../../register/ReadingNote';
import { NO_READING_STATEMENTS, type ReadingStatements } from '../../register/registerState';
import styles from './Inspector.module.css';

export interface Crumb {
  label: string;
  onSelect?: () => void;
}

/**
 * The one inspector (GOAL override 4): crumbs of the selection path, one title, optional tabs,
 * body, and a footer with one primary action; a blocked primary shows one "Blocked: …" line. `readings`
 * are what the server states about the building's document readings, for the citations in the body.
 * Everything above the footer is one box, so that a short window can scroll it as one region (the stylesheet).
 */
export function InspectorShell({
  crumbs, title, status, subtitle, tabs, children, actions, blocked, rekey, readings = NO_READING_STATEMENTS,
}: {
  crumbs?: Crumb[]; title: string; status?: ReactNode; subtitle?: ReactNode; tabs?: ReactNode; children: ReactNode;
  actions?: ReactNode; blocked?: string | null; rekey: string; readings?: ReadingStatements;
}) {
  return (
    <aside className={`ul-panel ${styles.inspector}`} aria-label="Inspector">
      <div className={styles.above}>
        <header className={`${styles.head} ${styles.rekey}`} key={`h-${rekey}`}>
          {crumbs?.length ? (
            <nav aria-label="Selection path" className={styles.crumbs}>
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`} style={{ display: 'contents' }}>
                  {index > 0 ? <span aria-hidden="true">/</span> : null}
                  {crumb.onSelect
                    ? <button type="button" onClick={crumb.onSelect}>{crumb.label}</button>
                    : <span>{crumb.label}</span>}
                </span>
              ))}
            </nav>
          ) : null}
          <div className={styles.titleRow}>
            <h2 className="ul-heading">{title}</h2>
            {status}
          </div>
          {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
        </header>
        {tabs ?? <span />}
        <div className={`${styles.body} ${styles.rekey}`} key={`b-${rekey}`}>
          <ReadingStatementsContext.Provider value={readings}>{children}</ReadingStatementsContext.Provider>
        </div>
      </div>
      {actions ? (
        <footer className={styles.foot}>
          <div className={styles.actions}>{actions}</div>
          {blocked ? <span className={styles.blocked}>Blocked: {blocked}</span> : null}
        </footer>
      ) : <span />}
    </aside>
  );
}
