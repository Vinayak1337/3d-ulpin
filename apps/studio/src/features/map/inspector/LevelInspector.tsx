import { DescriptionList, StatusBadge, formatCount } from '@ulpin/ui';
import type { BuildingModel, LevelModel } from '../../../model/building';
import { spacesOnLevel } from '../../../model/building';
import { InspectorShell, type Crumb } from './InspectorShell';
import styles from './Inspector.module.css';

/** Level selected, no space: the level's spaces (the accessible list alternative to the map). */
export function LevelInspector({ level, model, crumbs, verticalReference, onSelectSpace }: {
  level: LevelModel; model: BuildingModel; crumbs: Crumb[]; verticalReference: string | null; onSelectSpace: (id: string) => void;
}) {
  const top = spacesOnLevel(model, level.id);
  const total = model.spaces.filter((s) => s.levelId === level.id).length;
  return (
    <InspectorShell rekey={level.id} crumbs={crumbs} title={level.label} subtitle="Select a space on the map or in the list.">
      <DescriptionList items={[
        { label: 'Lower', value: level.lower === null ? <StatusBadge status="Unknown" /> : `${level.lower.toFixed(2)} m · ${verticalReference ?? 'reference not stated'}` },
        { label: 'Upper', value: level.upper === null ? <StatusBadge status="Unknown" /> : `${level.upper.toFixed(2)} m · ${verticalReference ?? 'reference not stated'}` },
      ]} />
      <h3 className={styles.sectionTitle}>Spaces <span className={styles.count}>{formatCount(total)}</span></h3>
      {top.length ? (
        <ul className={styles.list}>
          {top.map((space) => (
            <li key={space.id}>
              <button type="button" onClick={() => onSelectSpace(space.id)}>
                <span>{space.name}</span>
                <span className={styles.meta}>{space.use ?? ''}</span>
              </button>
              {model.children.get(space.id)?.length ? (
                <ul className={`${styles.list} ${styles.nested}`}>
                  {model.children.get(space.id)!.map((child) => (
                    <li key={child.id}><button type="button" onClick={() => onSelectSpace(child.id)}><span>{child.shortName}</span><span /></button></li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className={styles.note}>No spaces are recorded on this level.</p>}
    </InspectorShell>
  );
}
