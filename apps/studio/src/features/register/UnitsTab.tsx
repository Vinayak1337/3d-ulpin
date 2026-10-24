import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Stack } from '@phosphor-icons/react';
import { Banner, EmptyState, Skeleton } from '@ulpin/ui';
import { RecordedPanel } from '../review/recorded/RecordedPanel';
import type { UnitsTabView } from './unitsTabView';
import styles from './RegisterPage.module.css';

/** The floor the tab is filtered to, with the control that clears the filter. */
export function FloorFilter({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className={styles.filterBar}>
      <span>Spaces on <b>{label}</b></span>
      <button type="button" className="ul-btn ul-btn--ghost" onClick={onClear}>All units</button>
    </div>
  );
}

/**
 * What the record holds when a level schedule is reviewed and the registry has no floor or unit of the
 * building: the levels by their literal labels, and that none is a registry floor yet.
 */
function ScheduledOnly({ labels, buildingId }: { labels: string[]; buildingId: string }) {
  const one = labels.length === 1;
  return (
    <div className="ul-panel">
      <EmptyState icon={Stack} title="No floor or unit of this building is recorded in the registry"
        action={<Link className="ul-btn" to={`/studio/properties/${buildingId}/candidates`}>Open record</Link>}>
        The record holds {labels.length} reviewed {one ? 'level' : 'levels'} from a level schedule
        ({labels.join(', ')}). {one ? 'It is not' : 'None is'} recorded as a registry floor, and no unit is
        recorded.
      </EmptyState>
    </div>
  );
}

/**
 * The Units tab. `table` is the register read's own table, which also words "nothing recorded"; it stands for
 * the states `register` and `nothing` and carries the floor filter itself. Floors and units recorded from a
 * source label are stated by the recorded panel of the building page, the one component that reads them.
 * With nothing recorded and a reviewed level schedule, the tab states the schedule instead of the table's
 * advice to add one.
 */
export function UnitsTab({ view, buildingId, floorLabel, onClearFloor, table }: {
  view: UnitsTabView<unknown>; buildingId: string; floorLabel: string | null; onClearFloor: () => void;
  table: ReactNode;
}) {
  if (view.state === 'pending') {
    return <div className="ul-panel ul-pad ul-stack"><Skeleton width="40%" /><Skeleton /><Skeleton /></div>;
  }
  const scheduleOnly = view.state === 'nothing' && !floorLabel && view.scheduled.length > 0;
  const tabled = !scheduleOnly && (view.state === 'register' || view.state === 'nothing');
  return (
    <>
      {scheduleOnly ? <ScheduledOnly labels={view.scheduled} buildingId={buildingId} /> : null}
      {tabled ? table : null}
      {!tabled && floorLabel ? (
        <div className="ul-panel"><FloorFilter label={floorLabel} onClear={onClearFloor} /></div>
      ) : null}
      {view.recorded ? <RecordedPanel building={view.recorded} /> : null}
      {view.unread ? (
        <Banner tone="warning">
          The recorded floors and units could not be read{view.code ? ` · ${view.code}` : ''}
        </Banner>
      ) : null}
    </>
  );
}
