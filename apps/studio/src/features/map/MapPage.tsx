import { useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { FilePlus, MapTrifold, WarningCircle } from '@phosphor-icons/react';
import { Button, EmptyState, Icon, Skeleton } from '@ulpin/ui';
import { useAreaContext, useAreas } from '../../api/queries';
import { readLastArea } from '../../app/lastArea';
import { MapWorkspace } from './MapWorkspace';
import { isAreaLimit } from './areaWindow';
import { WindowedArea } from './WindowedArea';
import styles from './MapPage.module.css';

/** /studio/map: open the last area, else the first area, else an honest Empty state. */
export function MapIndexRedirect() {
  const areas = useAreas();
  if (areas.isPending) return <MapSkeleton />;
  if (areas.error) {
    return (
      <div className={styles.emptyPage}>
        <EmptyState icon={WarningCircle} title="Areas could not be loaded" action={<Button onClick={() => void areas.refetch()}>Try again</Button>}>
          {areas.error.message}
        </EmptyState>
      </div>
    );
  }
  const last = readLastArea();
  const target = areas.data.find((area) => area.id === last) ?? areas.data[0];
  if (!target) {
    return (
      <div className={styles.emptyPage}>
        <EmptyState icon={MapTrifold} title="No areas yet" action={<Link to="/studio/add-files" className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>} />
      </div>
    );
  }
  return <Navigate to={`/studio/areas/${target.id}`} replace />;
}

/** /studio/areas/:areaId */
export function MapPage() {
  const { areaId } = useParams();
  const [params] = useSearchParams();
  const packageId = params.get('package');
  // When the package in the URL was opened: only area reads made since then can show it settled.
  const [opened, setOpened] = useState(() => ({ packageId, at: Date.now() }));
  if (opened.packageId !== packageId) setOpened({ packageId, at: Date.now() });
  // Read again only while the package in the URL streams into this area.
  const context = useAreaContext(areaId, packageId, opened.at);
  // An area with more features than one display read carries is drawn by the part in view. A refused area read
  // again has no answer while the read runs; the map it draws stays, its buildings drawn, until an answer differs.
  const limited = isAreaLimit(context.error);
  const [windowed, setWindowed] = useState<string | null>(null);
  if (limited && areaId && windowed !== areaId) setWindowed(areaId);
  if (areaId && (limited || (windowed === areaId && context.isPending))) {
    return <WindowedArea key={areaId} areaId={areaId} />;
  }
  if (context.isPending) return <MapSkeleton />;
  if (context.error || !context.data) {
    return (
      <div className={styles.emptyPage}>
        <EmptyState icon={WarningCircle} title="This area could not be opened" action={<Link to="/studio/work">Back to Batches</Link>}>
          {context.error?.message ?? 'The area was not found.'}
        </EmptyState>
      </div>
    );
  }
  return <MapWorkspace key={areaId} context={context.data} contextFresh={context.dataUpdatedAt >= opened.at} />;
}

/** Loading keeps the final layout: ground and chrome, records hidden. */
function MapSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading the map">
      <div className={styles.skeletonCanvas} />
      <div className={`ul-panel ${styles.skeletonInspector}`}>
        <Skeleton height={22} width="60%" />
        <Skeleton width="80%" />
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} width={i % 2 ? '50%' : '70%'} />)}
      </div>
    </div>
  );
}
