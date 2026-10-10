import type { ReactNode } from 'react';
import { Polygon } from '@phosphor-icons/react';
import { EmptyState } from '@ulpin/ui';
import { useBuildingCanonical } from '../../api/queries';
import { geometryGaps } from '../map/sceneGeometry';
import styles from './RegisterPage.module.css';

const TITLE = 'No geometry is recorded for this building';

/**
 * What stands where the scene would be when its inputs hold nothing to draw for the building: the title and the
 * canonical record's own gap lines about geometry and placement, as returned. Only the title while that record is
 * not read or has no such line. It fills the scene pane it is placed in; no canvas and no stand-in shape.
 * `children` are the pane's controls that still apply (the level rail); they stand beside the statement.
 */
export function NoGeometry({ buildingId, children }: { buildingId: string; children?: ReactNode }) {
  const lines = geometryGaps(useBuildingCanonical(buildingId).data?.gaps ?? []);
  const stated = lines.length
    ? <ul className={styles.gaps}>{lines.map((line) => <li key={line}>{line}</li>)}</ul>
    : undefined;
  return (
    <div className={styles.noGeometry}>
      <div className={styles.statement}><EmptyState icon={Polygon} title={TITLE} action={stated} /></div>
      {children ? <div className={styles.sceneControls}>{children}</div> : null}
    </div>
  );
}
