import { DescriptionList, StatusBadge } from '@ulpin/ui';
import { CitationControls } from './CitationControls';
import type { RecordedFloor } from './model';
import { RecordedUnitItem } from './RecordedUnitItem';
import { ValueText } from './ValueText';
import styles from './Recorded.module.css';

/** One recorded floor with the units recorded under it. Heights are the record's values, Unknown included. */
export function RecordedFloorItem({ floor }: { floor: RecordedFloor }) {
  return (
    <li className={styles.floor}>
      <div className={styles.head}>
        <h3 className={styles.label}>{floor.label}</h3>
        {floor.reviewed ? <StatusBadge status="Reviewed" /> : null}
      </div>
      <p className="ul-help">{floor.origin}</p>
      <DescriptionList items={[
        { label: 'Lower height', value: <ValueText value={floor.lower} /> },
        { label: 'Upper height', value: <ValueText value={floor.upper} /> },
        { label: 'Citation', value: <CitationControls label={floor.label} citations={floor.citations} /> },
      ]} />
      {floor.units.length ? (
        <ul className={styles.list} aria-label={`Units recorded under ${floor.label}`}>
          {floor.units.map((unit) => <RecordedUnitItem key={unit.id} unit={unit} />)}
        </ul>
      ) : <p className="ul-help">No unit is recorded under this floor.</p>}
    </li>
  );
}
