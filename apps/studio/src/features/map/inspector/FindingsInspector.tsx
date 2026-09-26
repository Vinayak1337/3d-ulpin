import { DescriptionList, StatusBadge, formatCount } from '@ulpin/ui';
import type { BuildingRegister } from '../../../api/queries';
import { InspectorShell, type Crumb } from './InspectorShell';
import styles from './Inspector.module.css';

/** Findings mode. With no qualified geometry, checks are Not assessed, with the reason, never "no conflict". */
export function FindingsInspector({ register, crumbs }: { register: BuildingRegister | undefined; crumbs: Crumb[] }) {
  const findings = register?.findings ?? [];
  const qualification = register?.geometryQualification;
  return (
    <InspectorShell rekey="findings" crumbs={crumbs} title="Findings" status={findings.length ? undefined : <StatusBadge status="Not assessed" />}>
      {findings.length ? (
        <ul className={styles.list}>
          {findings.map((f) => <li key={f.id}><button type="button"><span>{f.message}</span><span className={styles.meta}>{f.code}</span></button></li>)}
        </ul>
      ) : (
        <>
          <DescriptionList items={[
            { label: 'Checks', value: <StatusBadge status="Not assessed" /> },
            { label: 'Geometry', value: qualification ? `${qualification.state.replace('_', ' ')} · ${qualification.purpose.replace(/_/g, ' ')}` : <span className="ul-unknown">Unknown</span> },
            { label: 'Open findings', value: formatCount(0) },
          ]} />
          <p className={styles.note}>Overlap, void and share checks need qualified 3D geometry for every space. This record has none yet, so nothing was checked. This is not a pass.</p>
        </>
      )}
    </InspectorShell>
  );
}
