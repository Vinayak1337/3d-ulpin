import type { ReactNode } from 'react';
import { Banner, Skeleton } from '@ulpin/ui';
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
 * The Units tab. `table` is the register read's own table, which also words "nothing recorded"; it stands for
 * the states `register` and `nothing` and carries the floor filter itself. Floors and units recorded from a
 * source label are stated by the recorded panel of the building page, the one component that reads them.
 */
export function UnitsTab({ view, floorLabel, onClearFloor, table }: {
  view: UnitsTabView<unknown>; floorLabel: string | null; onClearFloor: () => void; table: ReactNode;
}) {
  if (view.state === 'pending') {
    return <div className="ul-panel ul-pad ul-stack"><Skeleton width="40%" /><Skeleton /><Skeleton /></div>;
  }
  const tabled = view.state === 'register' || view.state === 'nothing';
  return (
    <>
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
