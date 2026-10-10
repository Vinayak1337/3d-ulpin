import { DescriptionList } from '@ulpin/ui';
import { AssignedCode } from './AssignedCode';
import { CitationControls } from './CitationControls';
import type { RecordedUnit } from './model';
import { UnitCards } from './UnitCards';
import { ValueText } from './ValueText';
import styles from './Recorded.module.css';

/**
 * One unit recorded from a source label: its literal, what is unknown about it, its citation and its code.
 * A unit with an assigned code also lists its registry cards; a unit without one says nothing about cards.
 */
export function RecordedUnitItem({ buildingId, unit }: { buildingId: string; unit: RecordedUnit }) {
  return (
    <li className={styles.unit}>
      <h4 className={styles.label}>{unit.label}</h4>
      <DescriptionList items={[
        { label: 'Kind', value: <ValueText value={unit.kind} /> },
        { label: 'Area', value: <ValueText value={unit.area} /> },
        { label: 'Citation', value: <CitationControls label={unit.label} citations={unit.citations} /> },
        { label: 'Application code', value: <AssignedCode code={unit.code} /> },
      ]} />
      {unit.code ? <UnitCards buildingId={buildingId} unit={unit} /> : null}
    </li>
  );
}
