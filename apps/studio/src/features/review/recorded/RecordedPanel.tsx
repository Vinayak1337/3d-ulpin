import { Banner, Panel } from '@ulpin/ui';
import { EvidenceProvider } from '../../evidence/EvidenceContext';
import { recordedFloors, sourceLabelGaps, type BuildingCanonical } from './model';
import { RecordedFloorItem } from './RecordedFloorItem';
import styles from './Recorded.module.css';

/** Floors and units an officer recorded from a source label, read from the canonical building. Read-only. */
export function RecordedPanel({ building }: { building: BuildingCanonical }) {
  const floors = recordedFloors(building.levels);
  return (
    <EvidenceProvider>
      <Panel title="Recorded floors and units">
        <div className={styles.body}>
          {sourceLabelGaps(building.gaps).map((gap) => <Banner key={gap} tone="info">{gap}</Banner>)}
          {floors.length ? (
            <ul className={styles.list} aria-label="Floors recorded from a source label">
              {floors.map((floor) => <RecordedFloorItem key={floor.id} floor={floor} />)}
            </ul>
          ) : <p>No floor or unit has been recorded from a source label for this building.</p>}
        </div>
      </Panel>
    </EvidenceProvider>
  );
}
