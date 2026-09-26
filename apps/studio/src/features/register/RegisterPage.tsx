import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { DownloadSimple, FilePlus, Intersect, MapTrifold, QrCode, WarningCircle } from '@phosphor-icons/react';
import {
  Badge, Button, DataTable, DescriptionList, EmptyState, EvidenceChip, Icon, Menu, Panel, RevisionTimeline, Skeleton, StatusBadge, Tabs,
  formatCount, formatDateTime,
} from '@ulpin/ui';
import { useBuildingRegister, type BuildingRegister } from '../../api/queries';
import { shortHash } from '../../local/workflow';
import { buildingModel, type SpaceModel } from '../../model/building';
import { EvidenceProvider, useOpenEvidence } from '../evidence/EvidenceContext';
import { CardDialog } from '../identity/CardDialog';
import { recordEvidence } from '../map/inspector/evidence';
import { useBuildingWorkflow } from '../workflow/useWorkflow';
import styles from './RegisterPage.module.css';

type Tab = 'units' | 'shares' | 'history';

/** S12 Register (GOAL override 6): identity header once, a full-width Units table, Shares and History. */
export function RegisterPage() {
  const { buildingId } = useParams();
  const register = useBuildingRegister(buildingId);
  if (register.isPending) {
    return <div className={styles.page}><div className="ul-panel ul-pad ul-stack">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} width={i ? '100%' : '40%'} />)}</div></div>;
  }
  if (register.error || !register.data) {
    return (
      <div className={styles.page}>
        <EmptyState icon={WarningCircle} title="This register could not be opened" action={<Link to="/studio/registry">Back to Register</Link>}>
          {register.error?.message ?? 'The building was not found.'}
        </EmptyState>
      </div>
    );
  }
  return <EvidenceProvider><Register register={register.data} /></EvidenceProvider>;
}

function Register({ register }: { register: BuildingRegister }) {
  const [params, setParams] = useSearchParams();
  const tab = (['units', 'shares', 'history'].includes(params.get('tab') ?? '') ? params.get('tab') : 'units') as Tab;
  const deviation = params.get('mode') === 'deviation';
  const selectedId = params.get('record');
  const [cardFor, setCardFor] = useState<string | null>(null);
  const model = useMemo(() => buildingModel(register), [register]);
  const workflow = useBuildingWorkflow(register.property.id);
  const byId = new Map((workflow.data ?? []).map((w) => [w.spaceId, w]));
  const property = register.property;
  const mapHref = `/studio/areas/${register.area.id}?feature=${property.id}&mode=building`;
  const selectedWorkflow = selectedId ? byId.get(selectedId) : undefined;
  const set = (patch: Record<string, string | null>) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(patch)) if (v === null) next.delete(k); else next.set(k, v);
    return next;
  });

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <div className="ul-row">
            <h1 className="ul-title">{property.name}</h1>
            <Badge tone="neutral" icon={null}>{`${property.worldStatus[0]!.toUpperCase()}${property.worldStatus.slice(1)} source`}</Badge>
          </div>
          <p className={styles.meta}>
            <span className="ul-mono">{property.identifier}</span> · Parcel ULPIN{' '}
            {register.parcelIdentifiers.length ? <span className="ul-mono">{register.parcelIdentifiers.map((p) => p.value).join(', ')}</span> : <span className="ul-unknown">not supplied</span>}
            {' '}· {register.area.name}
          </p>
        </div>
        <Link to={mapHref} className="ul-btn ul-btn--ghost"><Icon icon={MapTrifold} />Open in map</Link>
        <Button variant={deviation ? 'soft' : 'secondary'} icon={Intersect} onClick={() => set({ mode: deviation ? null : 'deviation' })}>
          {deviation ? 'Close deviation check' : 'Deviation check'}
        </Button>
        <Menu label="Export" icon={DownloadSimple} items={[
          { label: 'CityJSON 2.0 + sidecar', planned: true },
          { label: 'LADM mapping report', planned: true },
          { label: 'CityGML 3.0', planned: true },
        ]} />
        <div className={styles.primary}>
          <Button variant="primary" icon={QrCode} disabled={!selectedWorkflow?.code} onClick={() => setCardFor(selectedId)}>Property Card</Button>
          {!selectedWorkflow?.code ? <span className={styles.blocked}>Blocked: select a space with an assigned proposed code</span> : null}
        </div>
      </header>

      <div className={styles.page}>
        {deviation ? <DeviationPanel /> : (
          <>
            <Tabs label="Register sections" value={tab} onChange={(value) => set({ tab: value === 'units' ? null : value })}
              tabs={[{ value: 'units', label: 'Units', count: model.spaces.length }, { value: 'shares', label: 'Shares' }, { value: 'history', label: 'History' }]} />
            {tab === 'units' ? (
              <UnitsTable register={register} spaces={model.spaces.filter((sp) => !sp.parentId).flatMap((unit) => [unit, ...(model.children.get(unit.id) ?? [])])} levels={new Map(model.levels.map((l) => [l.id, l.label]))}
                statusOf={(id) => byId.get(id)} selectedId={selectedId} onSelect={(id) => set({ record: id })} mapHref={mapHref} />
            ) : tab === 'shares' ? (
              <Panel title="Undivided shares" aside={<StatusBadge status="Not assessed" />}>
                <p className="ul-help">Not assessed: no declaration of shares is among this building's sources, so the population is incomplete. Add the deed of declaration to check that shares total 100 %.</p>
              </Panel>
            ) : (
              <History register={register} events={(workflow.data ?? []).flatMap((w) => w.events.map((e) => ({ ...e, space: w.spaceName })))} />
            )}
            {register.missing.length ? (
              <Panel title="What the sources do not say" aside={<span className="ul-caption">{formatCount(register.missing.length)}</span>}>
                <ul className={styles.gaps}>{register.missing.map((m) => <li key={m}>{m}</li>)}</ul>
              </Panel>
            ) : null}
          </>
        )}
      </div>

      {cardFor && selectedWorkflow?.code ? (
        <CardDialog workflow={selectedWorkflow} space={model.spaceById.get(cardFor)!} buildingName={property.name}
          level={model.levels.find((l) => l.id === model.spaceById.get(cardFor)?.levelId) ?? null} onClose={() => setCardFor(null)} />
      ) : null}
    </div>
  );
}

function UnitsTable({ register, spaces, levels, statusOf, selectedId, onSelect, mapHref }: {
  register: BuildingRegister; spaces: SpaceModel[]; levels: Map<string, string>;
  statusOf: (id: string) => { status: 'Draft' | 'Reviewed' | 'Assigned'; code: string | null } | undefined;
  selectedId: string | null; onSelect: (id: string) => void; mapHref: string;
}) {
  const openEvidence = useOpenEvidence();
  if (!spaces.length) {
    return (
      <div className="ul-panel">
        <EmptyState icon={FilePlus} title="No floors recorded for this building"
          action={<Link to={`/studio/add-files?feature=${register.property.id}`} className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>}>
          Add a plan or level schedule.
        </EmptyState>
      </div>
    );
  }
  const sourceName = (id: string) => register.sources.find((s) => s.id === id)?.name ?? 'Source';
  const nameOf = (id: string | null) => (id ? spaces.find((s) => s.id === id)?.name ?? '' : '');
  return (
    <div className="ul-panel">
      <DataTable
        caption="Spaces in this building"
        rows={spaces}
        rowKey={(s) => s.id}
        selectedKey={selectedId}
        onRowClick={(s) => onSelect(s.id)}
        columns={[
          { header: 'Level', cell: (s) => (s.levelId ? levels.get(s.levelId) : <span className="ul-unknown">Unknown</span>), width: '15%' },
          { header: 'Space', cell: (s) => (s.parentId ? <span style={{ paddingLeft: 16 }}>{s.shortName}</span> : <strong>{s.name}</strong>), width: '16%' },
          { header: 'Within', cell: (s) => nameOf(s.parentId) || <span className="ul-muted">—</span>, width: '12%' },
          { header: 'Code', cell: (s) => { const code = statusOf(s.id)?.code; return code ? <span className="ul-id">{code.slice(0, 7)}…{code.slice(-3)}</span> : <span className="ul-muted">After review</span>; }, width: '14%' },
          { header: 'Area m²', numeric: true, cell: (s) => (typeof s.record.geometry?.area === 'number' ? s.record.geometry.area.toFixed(2) : <span className="ul-unknown">Not assessed</span>), width: '11%' },
          { header: 'Status', cell: (s) => <StatusBadge status={statusOf(s.id)?.status ?? 'Draft'} />, width: '12%' },
          {
            header: 'Source',
            cell: (s) => recordEvidence(s.record, sourceName, s.name).map((ref) => (
              <EvidenceChip key={ref.locator.text} kind="table" source={ref.locator.text || ref.label} onOpen={() => openEvidence(ref)} />
            )),
          },
        ]}
      />
      <p className="ul-help" style={{ padding: '8px 12px' }}>
        Select a row, then <Link to={mapHref}>open the map</Link> to review a space in 3D.
      </p>
    </div>
  );
}

function History({ register, events }: {
  register: BuildingRegister;
  events: { revision: number; kind: 'draft' | 'evidence' | 'recorded'; title: string; at: string; by: string; hash: string; previousHash: string | null; space: string }[];
}) {
  const source = register.sources[0];
  const revisions = [
    ...[...events].sort((a, b) => b.at.localeCompare(a.at)).map((e, i) => ({
      id: `${e.space}-${e.revision}-${i}`, title: `${e.space}: ${e.title}`, byline: `${e.by} · ${formatDateTime(e.at)}`,
      kind: e.kind, hash: shortHash(e.hash), previousHash: e.previousHash ? shortHash(e.previousHash) : null,
    })),
    ...(source ? [{ id: 'source', title: `r${register.property.revision} Imported from ${source.name}`, byline: `Source acquired ${formatDateTime(source.createdAt)}`, kind: 'draft' as const, hash: shortHash(source.sha256), previousHash: null }] : []),
  ];
  return <RevisionTimeline revisions={revisions} chain="unknown" />;
}

/** S13: sanctioned against observed needs both; HISTORY-02 supplies the pair. Nothing is compared until then. */
function DeviationPanel() {
  return (
    <Panel title="Sanctioned against observed" aside={<StatusBadge status="Not assessed" />}>
      <DescriptionList items={[
        { label: 'Sanctioned', value: <span className="ul-unknown">No sanctioned plan among the sources</span> },
        { label: 'Observed', value: <span className="ul-unknown">No observed survey among the sources</span> },
      ]} />
      <p className="ul-help" style={{ marginTop: 12 }}>A deviation check compares a sanctioned plan with an observed survey of the same building. Add both to compare storeys, height and rooftop structures. Observed geometry is never a legal determination.</p>
    </Panel>
  );
}
