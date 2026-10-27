import { Link } from 'react-router';
import type { UndrawnBuilding } from './canonicalScene';
import { RecordState } from './RecordState';
import styles from './UndrawnBuildings.module.css';

/** Buildings the area record holds without a footprint: named here, never drawn or given a position. */
export function UndrawnBuildings({ buildings }: { buildings: UndrawnBuilding[] }) {
  if (!buildings.length) return null;
  return (
    <section className={styles.section} aria-labelledby="undrawn-heading">
      <h2 id="undrawn-heading" className={styles.heading}>
        Buildings without recorded geometry <span className="ul-num">{buildings.length}</span>
      </h2>
      <ul className={styles.rows}>
        {buildings.map((building) => (
          <li key={building.id} className={styles.row}>
            <span className={styles.name}>{building.name}</span>
            <RecordState state={building.state} />
            <span className={styles.note}>No footprint recorded · not drawn on the map</span>
            <Link to={`/studio/properties/${building.id}/register`} aria-label={`Open register of ${building.name}`}>
              Open register
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
