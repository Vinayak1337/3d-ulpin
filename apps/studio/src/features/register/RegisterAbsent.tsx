import { Link } from 'react-router';
import { FileDashed } from '@phosphor-icons/react';
import { EmptyState, Skeleton } from '@ulpin/ui';
import { useBuildingCanonical } from '../../api/queries';
import { unrecordedStatement } from './registerState';
import styles from './RegisterPage.module.css';

// The server refused the read (409); whether a register was ever recorded is not known from that answer.
const REFUSED = 'The register of this building could not be read';
// The server holds none (404 NOT_FOUND).
const NOT_RECORDED = 'No register is recorded for this building';

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
 * A building with no register to show: its recorded name, why in words and the pages that hold its record.
 * `reason` is the server's refusal in words (409); null when the server holds no register (404), and then the
 * sentence says what the building's canonical record is. No export, table or unit count: no register was read.
 */
export function RegisterAbsent({ buildingId, reason }: { buildingId: string; reason: string | null }) {
  const canonical = useBuildingCanonical(buildingId);
  if (canonical.isPending) return <div className={styles.loading}><Skeleton width="40%" height={28} /></div>;
  const building = canonical.data;
  return (
    <div className={styles.loading}>
      <h1 className={`ul-title ${styles.absentName}`}>{building?.name.value ?? 'Name unknown'}</h1>
      <EmptyState icon={FileDashed} title={reason === null ? NOT_RECORDED : REFUSED}
        action={<RecordLinks buildingId={buildingId} areaId={building?.areaId} />}>
        {reason ?? unrecordedStatement(building, canonical.error)}
      </EmptyState>
    </div>
  );
}
