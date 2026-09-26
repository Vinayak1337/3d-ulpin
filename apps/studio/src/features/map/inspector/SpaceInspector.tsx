import { useState } from 'react';
import { QrCode, ShieldCheck, CheckCircle } from '@phosphor-icons/react';
import { Button, DescriptionList, EvidenceChip, StatusBadge, Tabs, UlpinCode, formatCount, type Fact } from '@ulpin/ui';
import type { BuildingRegister } from '../../../api/queries';
import type { BuildingModel, LevelModel, SpaceModel } from '../../../model/building';
import { useOpenEvidence } from '../../evidence/EvidenceContext';
import { useRecordReview, useSpaceWorkflow } from '../../workflow/useWorkflow';
import { recordEvidence } from './evidence';
import { InspectorShell, type Crumb } from './InspectorShell';
import styles from './Inspector.module.css';

type Tab = 'overview' | 'rights' | 'evidence';

/**
 * Space variant: status from the workflow (Draft → Reviewed → Assigned), the proposed code once assigned,
 * facts with evidence, and one primary action that moves the space forward.
 */
export function SpaceInspector({ space, level, model, register, buildingId, crumbs, onSelectSpace, onAssign, onCard, areaUnitStated }: {
  space: SpaceModel; level: LevelModel | null; model: BuildingModel; register: BuildingRegister; buildingId: string;
  crumbs: Crumb[]; onSelectSpace: (id: string) => void; onAssign: () => void; onCard: () => void; areaUnitStated: boolean;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const openEvidence = useOpenEvidence();
  const workflow = useSpaceWorkflow(space.id);
  const review = useRecordReview();
  const status = workflow.data?.status ?? 'Draft';
  const sourceName = (id: string) => register.sources.find((s) => s.id === id)?.name ?? 'Source';
  const refs = recordEvidence(space.record, sourceName, space.name);
  const parent = space.parentId ? model.spaceById.get(space.parentId) : null;
  const rooms = model.children.get(space.id) ?? [];

  const facts: Fact[] = [
    { label: 'Level', value: level ? <span>{level.label} · {level.lower === null ? <span className="ul-unknown">elevation unknown</span> : `${level.lower.toFixed(2)} m`}</span> : <span className="ul-unknown">Unknown</span> },
    { label: 'Limits', value: space.lower === null || space.upper === null ? <StatusBadge status="Unknown" /> : `${space.lower.toFixed(2)} to ${space.upper.toFixed(2)} m` },
    {
      label: 'Area',
      value: areaUnitStated && typeof space.record.geometry?.area === 'number'
        ? <span className="ul-num">{space.record.geometry.area.toFixed(2)} m²</span>
        : <span className="ul-row"><StatusBadge status="Not assessed" /><span className={styles.note}>source unit not stated</span></span>,
    },
    { label: 'Use', value: space.use ?? <span className="ul-unknown">Unknown</span> },
  ];
  if (parent) facts.push({ label: 'Within', value: <button type="button" className="ul-evid" onClick={() => onSelectSpace(parent.id)}><b>{parent.name}</b></button> });
  if (rooms.length) facts.push({ label: 'Rooms', value: <span className="ul-row">{rooms.map((r) => <button key={r.id} type="button" className="ul-evid" onClick={() => onSelectSpace(r.id)}><b>{r.shortName}</b></button>)}</span> });
  facts.push({ label: 'Source', value: <span className="ul-row">{refs.map((ref) => <EvidenceChip key={ref.locator.text} kind="table" source={ref.label} locator={ref.locator.text} onOpen={() => openEvidence(ref)} />)}</span> });

  const primary = status === 'Draft'
    ? <Button variant="primary" icon={CheckCircle} disabled={review.isPending} onClick={() => review.mutate({ spaceId: space.id, buildingId, spaceName: space.name, recordRevision: space.record.revision })}>Record reviewed details</Button>
    : status === 'Reviewed'
      ? <Button variant="primary" icon={ShieldCheck} onClick={onAssign}>Assign code</Button>
      : <Button variant="primary" icon={QrCode} onClick={onCard}>Property Card</Button>;

  return (
    <InspectorShell
      rekey={space.id}
      crumbs={crumbs}
      title={space.name}
      status={<StatusBadge status={status} />}
      tabs={<Tabs label="Space details" value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'rights', label: 'Rights' }, { value: 'evidence', label: 'Evidence', count: refs.length }]} />}
      actions={primary}
    >
      {tab === 'overview' ? (
        <>
          <UlpinCode code={workflow.data?.code ?? null} state={status === 'Assigned' ? 'assigned' : 'draft'} />
          <DescriptionList items={facts} />
          {status === 'Draft' ? <p className={styles.note}>Review the details against the source, then record them. A proposed code can be assigned after review.</p> : null}
        </>
      ) : tab === 'rights' ? (
        <>
          <DescriptionList items={[
            { label: 'Rights', value: <StatusBadge status="Unknown" /> },
            { label: 'Parties', value: <StatusBadge status="Unknown" /> },
            { label: 'Share', value: <StatusBadge status="Unknown" /> },
          ]} />
          <p className={styles.note}>The source records no rights, parties or shares for this space.</p>
        </>
      ) : (
        <>
          <div className={styles.chips}>{refs.map((ref) => <EvidenceChip key={ref.locator.text} kind="table" source={ref.label} locator={ref.locator.text} onOpen={() => openEvidence(ref)} />)}</div>
          <h3 className={styles.sectionTitle}>What the sources do not say <span className={styles.count}>{formatCount(register.missing.length)}</span></h3>
          <ul className={styles.gaps}>{register.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </>
      )}
    </InspectorShell>
  );
}
