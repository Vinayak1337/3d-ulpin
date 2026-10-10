import { DescriptionList } from '@ulpin/ui';
import { AssignedCode } from './AssignedCode';
import { CitationControls } from './CitationControls';
import type { RecordedUnit } from './model';
import { ValueText } from './ValueText';
import styles from './Recorded.module.css';

/** One unit recorded from a source label: its literal, what is unknown about it, its citation and its code. */
export function RecordedUnitItem({ unit }: { unit: RecordedUnit }) {
  return (
    <li className={styles.unit}>
      <h4 className={styles.label}>{unit.label}</h4>
      <DescriptionList items={[
        { label: 'Kind', value: <ValueText value={unit.kind} /> },
        { label: 'Area', value: <ValueText value={unit.area} /> },
        { label: 'Citation', value: <CitationControls label={unit.label} citations={unit.citations} /> },
        { label: 'Application code', value: <AssignedCode code={unit.code} /> },
      ]} />
    </li>
  );
}
