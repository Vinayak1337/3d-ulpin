import { Buildings, Trash } from '@phosphor-icons/react';
import { Button, Icon, formatCount, formatMeasure } from '@ulpin/ui';
import type { AreaContext, AreaFeature } from '../../../api/queries';
import { InspectorShell } from './InspectorShell';
import styles from './Inspector.module.css';

/** Nothing selected: the area and its buildings. The list is the non-visual alternative to the map. */
export function AreaInspector({ area, buildings, onSelect, onDelete }: { area: AreaContext['area']; buildings: AreaFeature[]; onSelect: (id: string) => void; onDelete?: () => void }) {
  return (
    <InspectorShell rekey="area" crumbs={[{ label: 'Area' }]} title={area.name} subtitle="Select a building on the map or in the list."
      actions={onDelete ? <Button variant="ghost" icon={Trash} onClick={onDelete}>Delete area</Button> : undefined}>
      <h3 className={styles.sectionTitle}>Buildings <span className={styles.count}>{formatCount(buildings.length)}</span></h3>
      {buildings.length ? (
        <ul className={styles.list}>
          {buildings.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => onSelect(b.id)}>
                <span className="ul-row" style={{ flexWrap: 'nowrap', minWidth: 0 }}><Icon icon={Buildings} size={16} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span></span>
                <span className={styles.meta}>{b.height.value === null || b.height.value === undefined ? 'height ?' : formatMeasure(b.height.value, 'm', 1)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className={styles.note}>No buildings are recorded in this area yet.</p>}
    </InspectorShell>
  );
}
