import type { ReactNode } from 'react';
import type { BuildingCanonical } from './model';
import { RecordedPanel } from './RecordedPanel';
import styles from './Recorded.module.css';

/**
 * The building page: the candidate review keeps its own height and the recorded floors and units follow below
 * it at full width, so the panel stays readable when the review's three columns narrow at 200% zoom.
 */
export function RecordedLayout({ building, children }: { building: BuildingCanonical; children: ReactNode }) {
  return (
    <div className={styles.layout}>
      {children}
      <div className={styles.below}><RecordedPanel building={building} /></div>
    </div>
  );
}
