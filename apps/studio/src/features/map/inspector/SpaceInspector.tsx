import { useState, type ReactNode } from 'react';
import { CheckCircle, QrCode, ShieldCheck } from '@phosphor-icons/react';
import type { BuildingLedger, SourcedValue } from '@ulpin/api-client/draft';
import { Badge, Button, DescriptionList, EvidenceChip, StatusBadge, Tabs, UlpinCode, type Fact, type StatusWord } from '@ulpin/ui';
import type { BuildingRegister } from '../../../api/queries';
import type { BuildingModel, LevelModel, SpaceModel } from '../../../model/building';
import { useOpenEvidence } from '../../evidence/EvidenceContext';
import { parseLocator } from '../../evidence/refs';
import { useRecordReview, useSpaceWorkflow } from '../../workflow/useWorkflow';
import { RIGHTS_LABEL, RIGHTS_TOKEN, ledgerSpace } from '../ledger';
import { recordEvidence } from './evidence';
import { InspectorShell, type Crumb } from './InspectorShell';
import styles from './Inspector.module.css';

type Tab = 'overview' | 'rights' | 'evidence';

/**
 * Space variant: status (Draft → Reviewed → Assigned, or the ledger's review status), the proposed code
 * once assigned, facts with inline evidence, and one primary action that moves the space forward.
 */
export function SpaceInspector({ space, level, model, register, ledger, buildingId, crumbs, datum, onSelectSpace, onAssign, onCard, onFinding }: {
  space: SpaceModel; level: LevelModel | null; model: BuildingModel; register: BuildingRegister; ledger: BuildingLedger | null | undefined;
  buildingId: string; crumbs: Crumb[]; datum: string | null; onSelectSpace: (id: string) => void; onAssign: () => void; onCard: () => void;
  onFinding: (findingId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const openEvidence = useOpenEvidence();
  const workflow = useSpaceWorkflow(space.id);
  const review = useRecordReview();
  const facts = ledgerSpace(ledger, space.id);
  const recorded = workflow.data?.status;
  const status: StatusWord = recorded ?? (facts?.status === 'needs_review' ? 'Needs review' : facts?.status === 'reviewed' ? 'Reviewed' : 'Draft');
  const sourceName = (id: string) => register.sources.find((s) => s.id === id)?.name ?? 'Source';
  const refs = recordEvidence(space.record, sourceName, space.name);
  const parent = space.parentId ? model.spaceById.get(space.parentId) : null;
  const rooms = model.children.get(space.id) ?? [];
  const finding = register.findings.find((f) => f.featureIds.includes(space.id));

  const sourced = (value: SourcedValue<number> | SourcedValue<string> | null | undefined, format: (v: never) => ReactNode, extra?: ReactNode) => {
    if (!value) return <em className="ul-unknown">Unknown</em>;
    return (
      <span className="ul-row">
        <span className="ul-num">{format(value.value as never)}</span>
        {value.sourceId
          ? <EvidenceChip source={value.source ?? 'Source'} locator={value.locator ?? undefined} onOpen={() => openEvidence({
              sourceId: value.sourceId!, label: value.source ?? 'Source', locator: parseLocator({ locator: value.locator ?? undefined }),
              subject: { id: space.id, name: level ? `${space.name} · ${level.label}` : space.name, outline: space.polygons[0]?.[0] as number[][] | undefined },
              supports: supportsFrom(value.sourceId!),
            })} />
          : <EvidenceChip state="missing" source="Needs evidence" />}
        {extra}
      </span>
    );
  };
  const m2 = (v: number) => `${v.toFixed(2)} m²`;
  // Every value of this space read from the same source, plus the level it sits on.
  const supportsFrom = (sourceId: string) => {
    const named: [string, SourcedValue<number> | SourcedValue<string> | null | undefined, (v: never) => string][] = [
      ['Carpet area', facts?.carpetAreaM2, m2 as never], ['Declared', facts?.declaredAreaM2, m2 as never], ['Share', facts?.sharePct, ((v: number) => `${v.toFixed(2)} %`) as never],
    ];
    return [
      ...named.filter(([, v]) => v?.sourceId === sourceId).map(([label, v, f]) => ({ source: label, locator: f(v!.value as never) })),
      ...(level ? [{ source: 'Level', locator: level.label }] : []),
    ];
  };
  const deviation = facts?.carpetAreaM2 && facts.declaredAreaM2
    ? ((facts.declaredAreaM2.value - facts.carpetAreaM2.value) / facts.carpetAreaM2.value) * 100 : null;

  const rows: Fact[] = [
    {
      label: 'Level',
      value: level
        ? <span className="ul-num">{level.label}{level.lower !== null && level.upper !== null ? ` · ${level.lower.toFixed(1)} to ${level.upper.toFixed(1)} m` : ''}{datum ? ` · ${datum}` : ''}{level.estimated ? ' est.' : ''}</span>
        : <span className="ul-unknown">Unknown</span>,
    },
  ];
  if (ledger) {
    if (space.use === 'apartment' || facts?.carpetAreaM2) rows.push({ label: 'Carpet area', value: sourced(facts?.carpetAreaM2, m2) });
    if (facts?.declaredAreaM2) rows.push({ label: 'Declared', value: sourced(facts.declaredAreaM2, m2, deviation !== null && Math.abs(deviation) >= 0.05 ? <Badge tone={Math.abs(deviation) > 2 ? 'warning' : 'neutral'} icon={null}>{`${deviation > 0 ? '+' : ''}${deviation.toFixed(1)} %`}</Badge> : null) });
    if (space.use === 'apartment' || facts?.sharePct) rows.push({ label: 'Share', value: sourced(facts?.sharePct, (v: number) => `${v.toFixed(2)} %`) });
    if (facts?.parking) rows.push({ label: 'Parking', value: sourced(facts.parking, (v: string) => v) });
  } else {
    rows.push({ label: 'Limits', value: space.lower === null || space.upper === null ? <StatusBadge status="Unknown" /> : `${space.lower.toFixed(2)} to ${space.upper.toFixed(2)} m` });
    rows.push({ label: 'Use', value: space.use ?? <span className="ul-unknown">Unknown</span> });
  }
  if (parent) rows.push({ label: 'Within', value: <button type="button" className="ul-evid" onClick={() => onSelectSpace(parent.id)}><b>{parent.name}</b></button> });
  if (rooms.length) rows.push({ label: 'Rooms', value: <span className="ul-row">{rooms.map((r) => <button key={r.id} type="button" className="ul-evid" onClick={() => onSelectSpace(r.id)}><b>{r.shortName}</b></button>)}</span> });

  const primary = status === 'Assigned'
    ? <Button variant="primary" icon={QrCode} onClick={onCard}>Property Card</Button>
    : status === 'Reviewed'
      ? <Button variant="primary" icon={ShieldCheck} onClick={onAssign}>Assign code</Button>
      : <Button variant="primary" icon={CheckCircle} disabled={review.isPending} onClick={() => review.mutate({ spaceId: space.id, buildingId, spaceName: space.name, recordRevision: space.record.revision })}>Record reviewed details</Button>;
  const secondary = finding && status !== 'Assigned'
    ? <Button onClick={() => onFinding(finding.id)}>{finding.code === 'carpet_area_deviation' ? 'Review area' : 'Open finding'}</Button> : null;

  const rights = facts?.rights ?? 'unknown';
  return (
    <InspectorShell
      rekey={space.id}
      crumbs={crumbs}
      title={space.name}
      status={<StatusBadge status={status} />}
      subtitle={<span className="ul-mono">{space.record.identifier.replace(/\//g, ' / ')}</span>}
      tabs={<Tabs label="Space details" value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'rights', label: 'Rights' }, { value: 'evidence', label: 'Evidence', count: refs.length }]} />}
      actions={<>{primary}{secondary}</>}
    >
      {tab === 'overview' ? (
        <>
          {workflow.data?.code ? <UlpinCode code={workflow.data.code} state="assigned" /> : null}
          <DescriptionList items={rows} />
          {status === 'Draft' || status === 'Needs review' ? <p className={styles.note}>Review the details against the sources, then record them. A proposed code can be assigned after review.</p> : null}
        </>
      ) : tab === 'rights' ? (
        <DescriptionList items={[
          { label: 'Rights', value: rights === 'unknown' ? <StatusBadge status="Unknown" /> : <span className="ul-row"><span className="ul-swatch" style={{ backgroundColor: `var(${RIGHTS_TOKEN[rights]})` }} />{RIGHTS_LABEL[rights]}</span> },
          { label: 'Parties', value: <span className="ul-row"><StatusBadge status="Unknown" /><span className={styles.note}>not in the public record</span></span> },
          { label: 'Share', value: facts?.sharePct ? `${facts.sharePct.value.toFixed(2)} %` : <StatusBadge status="Unknown" /> },
        ]} />
      ) : (
        <div className={styles.chips}>{refs.map((ref) => <EvidenceChip key={ref.locator.text + ref.sourceId} kind="document" source={ref.label} locator={ref.locator.text} onOpen={() => openEvidence(ref)} />)}</div>
      )}
    </InspectorShell>
  );
}
