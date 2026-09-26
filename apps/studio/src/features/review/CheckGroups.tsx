import type { ReactNode } from 'react';
import type { BuildingLedger, CheckState } from '@ulpin/api-client/draft';
import { Button } from '@ulpin/ui';
import { CheckBadge } from '../map/LeftPanel';
import styles from './Review.module.css';

type Check = BuildingLedger['checks'][number];

const GROUPS: { state: CheckState; title: string; tone: string }[] = [
  { state: 'blocking', title: 'Blocking', tone: 'ul-badge--danger' },
  { state: 'needs_review', title: 'Needs review', tone: 'ul-badge--warning' },
  { state: 'not_assessed', title: 'Not assessed', tone: '' },
  { state: 'passed', title: 'Passed', tone: 'ul-badge--success' },
];

/**
 * The building's checks grouped by outcome. `action` names the button a row shows (blocking rows open
 * their finding); rows without one show their state.
 */
export function CheckGroups({ checks, action, onOpen, extra }: {
  checks: Check[]; action?: (check: Check) => string | null; onOpen?: (check: Check) => void; extra?: ReactNode;
}) {
  return (
    <div className={styles.checkGroups}>
      {GROUPS.map((group) => {
        const rows = checks.filter((c) => c.state === group.state);
        if (!rows.length) return null;
        return (
          <section key={group.state} aria-label={group.title}>
            <header className={styles.groupHead}>
              <span className="ul-label ul-muted">{group.title}</span>
              <span className={`ul-badge ${group.tone}`}>{rows.length}</span>
            </header>
            <div className={group.state === 'not_assessed' ? `${styles.groupRows} ${styles.hatched}` : styles.groupRows}>
              {rows.map((c) => {
                const label = action?.(c) ?? null;
                return (
                  <div key={c.name} className={styles.checkRow}>
                    <span className={styles.checkText}><span className={styles.checkName}>{c.name}</span>{c.detail ? <span className="ul-muted">{c.detail}</span> : null}</span>
                    {label && onOpen ? <Button variant="soft" onClick={() => onOpen(c)}>{label}</Button> : <CheckBadge state={c.state} />}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {extra}
    </div>
  );
}
