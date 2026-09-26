import { Link, useSearchParams } from 'react-router';
import { ArrowRight, WarningCircle } from '@phosphor-icons/react';
import type { PublicRecordSummary } from '@ulpin/api-client/draft';
import { EmptyState, Icon, Skeleton, StatusBadge, UlpinCode } from '@ulpin/ui';
import { Crumbs } from './PortalFrame';
import { PublicScene } from './PublicScene';
import { SearchForm } from './SearchForm';
import { usePublicBuilding, usePublicMap, usePublicSearch } from './queries';
import styles from './Portal.module.css';

/** P2: released records matching the search, beside a view-only 3D view of their building. */
export function ResultsPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const search = usePublicSearch(q);
  const items = search.data?.items ?? [];
  const building = usePublicBuilding(items[0]?.buildingId).data ?? null;
  const map = usePublicMap(building?.areaId).data ?? null;
  return (
    <div className={styles.wrap}>
      <Crumbs items={[{ label: 'Home', to: '/portal' }, { label: 'Results' }]} />
      <h1 className="portal-h1">Results</h1>
      <SearchForm initial={q} key={q} />
      <div className={styles.split}>
        <div className={styles.list}>
          {search.isPending && q ? <Skeleton height={160} /> : search.error ? (
            <EmptyState icon={WarningCircle} title="Search is not available">{search.error.message}</EmptyState>
          ) : (
            <>
              <span className="portal-label ul-muted">{items.length === 1 ? '1 released record' : `${items.length} released records`}</span>
              {items.map((r) => <ResultCard key={r.id} record={r} />)}
              {search.data?.notReleased ? (
                <div className={styles.note}>{search.data.notReleased === 1 ? '1 other matching unit is' : `${search.data.notReleased} other matching units are`} not released yet.</div>
              ) : null}
              {!items.length && !search.data?.notReleased && q ? <div className={styles.note}>No record matches “{q}”. Try a 3D ULPIN, a parcel ULPIN or a building name.</div> : null}
            </>
          )}
        </div>
        <div className={styles.sceneBox}>
          {map && building ? <PublicScene className={styles.canvas} map={map} building={building} levelId={null} spaceId={null} label={`3D view of ${building.name}, view only`} /> : null}
          <span className={styles.viewOnly}>View only</span>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ record }: { record: PublicRecordSummary }) {
  return (
    <Link to={`/portal/records/${record.id}`} className={styles.result}>
      <span className={styles.resultHead}><span className="portal-h3">{record.name}, {record.buildingName}</span><StatusBadge status={record.status === 'assigned' ? 'Assigned' : 'Recorded'} /></span>
      {record.code ? <UlpinCode code={record.code} location={record.location} copyable={false} /> : null}
      <span className="portal-body ul-muted">{[record.address, record.level, record.carpetAreaM2 !== null ? `carpet area ${record.carpetAreaM2.toFixed(2)} m²` : null].filter(Boolean).join(' · ')}</span>
      <span className={styles.open}>Open record <Icon icon={ArrowRight} size={16} /></span>
    </Link>
  );
}
