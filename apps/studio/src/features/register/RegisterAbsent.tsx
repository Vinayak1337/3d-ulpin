import { Link } from 'react-router';
import { FileDashed } from '@phosphor-icons/react';
import { EmptyState, Skeleton } from '@ulpin/ui';
import { useBuildingCanonical } from '../../api/queries';
import styles from './RegisterPage.module.css';

const TITLE = 'No register is recorded for this building yet';

/** The pages that do hold this building's record; the register index when its record cannot be read either. */
function RecordLinks({ buildingId, areaId }: { buildingId: string; areaId: string | undefined }) {
  if (!areaId) return <Link to="/studio/registry">Back to Register</Link>;
  return (
    <div className={styles.absentLinks}>
      <Link className="ul-btn ul-btn--primary" to={`/studio/properties/${buildingId}/candidates`}>Open record</Link>
      <Link className="ul-btn" to={`/studio/areas/${areaId}?feature=${buildingId}&mode=building`}>Open area map</Link>
    </div>
  );
}

/**
 * A building the server will not read a register out for: its recorded name, the server's reason in words and
 * the pages that hold its record. No export, table or unit count, because no register was read.
 */
export function RegisterAbsent({ buildingId, reason }: { buildingId: string; reason: string }) {
  const canonical = useBuildingCanonical(buildingId);
  if (canonical.isPending) return <div className={styles.loading}><Skeleton width="40%" height={28} /></div>;
  const building = canonical.data;
  return (
    <div className={styles.loading}>
      <h1 className={`ul-title ${styles.absentName}`}>{building?.name.value ?? 'Name unknown'}</h1>
      <EmptyState icon={FileDashed} title={TITLE}
        action={<RecordLinks buildingId={buildingId} areaId={building?.areaId} />}>
        {reason}
      </EmptyState>
    </div>
  );
}
