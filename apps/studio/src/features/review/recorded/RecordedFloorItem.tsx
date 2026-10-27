import { DescriptionList, StatusBadge } from '@ulpin/ui';
import { CopyableId } from '../../identity/CopyableId';
import { CitationControls } from './CitationControls';
import type { RecordedFloor, RecordedValue } from './model';
import { RecordedUnitItem } from './RecordedUnitItem';
import { ValueText } from './ValueText';
import styles from './Recorded.module.css';

interface Props {
  buildingId: string;
  floor: RecordedFloor;
  /** The identifier the register read states for this floor, or the sentence that says why none is shown. */
  identifier: RecordedValue;
}

/**
 * One recorded floor with the units recorded under it. The identifier is the register read's own string under
 * that read's name for it; heights are the record's values, Unknown included.
 */
export function RecordedFloorItem({ buildingId, floor, identifier }: Props) {
  const stated = identifier.known
    ? <CopyableId id={identifier.text} name="identifier" /> : <ValueText value={identifier} />;
  return (
    <li className={styles.floor}>
      <div className={styles.head}>
        <h3 className={styles.label}>{floor.label}</h3>
        {floor.reviewed ? <StatusBadge status="Reviewed" /> : null}
      </div>
      <p className="ul-help">{floor.origin}</p>
      <DescriptionList items={[
        { label: 'Identifier', value: stated },
        { label: 'Lower height', value: <ValueText value={floor.lower} /> },
        { label: 'Upper height', value: <ValueText value={floor.upper} /> },
        { label: 'Citation', value: <CitationControls label={floor.label} citations={floor.citations} /> },
      ]} />
      {floor.units.length ? (
        <ul className={styles.list} aria-label={`Units recorded under ${floor.label}`}>
          {floor.units.map((unit) => (
            <RecordedUnitItem key={unit.id} buildingId={buildingId} floorLabel={floor.label} unit={unit} />
          ))}
        </ul>
      ) : <p className="ul-help">No unit is recorded under this floor.</p>}
    </li>
  );
}
