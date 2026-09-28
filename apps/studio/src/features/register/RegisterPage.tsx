import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { DownloadSimple, FilePlus, Intersect, MapTrifold, QrCode, WarningCircle } from '@phosphor-icons/react';
import { SceneView } from '@ulpin/scene/react';
import type { DeviationInput, MultiPolygon, Pick, SceneEngine, SceneState } from '@ulpin/scene';
import type { BuildingLedger, BuildingResidents } from '@ulpin/api-client/draft';
import {
  Badge, Banner, Button, DataTable, DescriptionList, EmptyState, EvidenceChip, Icon, LevelRail, Menu, Panel, RevisionTimeline, Skeleton,
  StatusBadge, Tabs, formatDate, formatDateTime, type StatusWord,
} from '@ulpin/ui';
import { useAreaContext, useBuildingLedger, useBuildingRegister, useBuildingResidents, type BuildingRegister } from '../../api/queries';
import { shortHash, type SpaceWorkflow } from '../../local/workflow';
import { buildingModel, type SpaceModel } from '../../model/building';
import { EvidenceProvider, useOpenEvidence } from '../evidence/EvidenceContext';
import { parseLocator } from '../evidence/refs';
import { CardDialog } from '../identity/CardDialog';
import { levelSummary } from '../map/inspector/BuildingInspector';
import { ledgerSpace, ledgerStatus } from '../map/ledger';
import { polygonsOf } from '../map/footprints';
import { useBuildingScene } from '../map/useBuildingScene';
import { CheckGroups } from '../review/CheckGroups';
import { useBuildingActions, useBuildingWorkflow, useClearAction, useRecordAction } from '../workflow/useWorkflow';
import { cityJson, download, fileStem, occupancyLabel, printRegister, registerRows, registerWorkbook, unitsCsv } from './exporters';
import { useMapView } from '../map/useMapView';
import styles from './RegisterPage.module.css';

type Tab = 'units' | 'residents' | 'shares' | 'documents' | 'checks' | 'history';
const TABS: Tab[] = ['units', 'residents', 'shares', 'documents', 'checks', 'history'];

/** S12/S13 Register: the building in 3D beside its units, shares, documents, checks and history. */
export function RegisterPage() {
  const { buildingId } = useParams();
  const register = useBuildingRegister(buildingId);
  if (register.isPending) {
    return <div className={styles.loading}><div className="ul-panel ul-pad ul-stack">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} width={i ? '100%' : '40%'} />)}</div></div>;
  }
  if (register.error || !register.data) {
    return (
      <div className={styles.loading}>
        <EmptyState icon={WarningCircle} title="This register could not be opened" action={<Link to="/studio/registry">Back to Register</Link>}>
          {register.error?.message ?? 'The building was not found.'}
        </EmptyState>
      </div>
    );
  }
  return <Register register={register.data} />;
}

/** Unit status: the officer's own actions first, then the record's review state. */
export function unitStatus(workflow: SpaceWorkflow | undefined, ledger: BuildingLedger | null | undefined, spaceId: string): StatusWord {
  if (workflow?.status === 'Assigned') return 'Assigned';
  if (workflow?.status === 'Reviewed') return 'Reviewed';
  return ledgerStatus(ledgerSpace(ledger, spaceId)?.status) ?? 'Draft';
}

function Register({ register }: { register: BuildingRegister }) {
  const [{ look: mapLook, layers: mapLayers }] = useMapView();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'units') as Tab;
  const compare = params.get('mode') === 'deviation';
  const levelId = params.get('level');
  const recordId = params.get('record');
  const [engine, setEngine] = useState<SceneEngine | null>(null);
  const [tick, setTick] = useState(0);
  const [cardOpen, setCardOpen] = useState(false);

  const property = register.property;
  const context = useAreaContext(register.area.id).data;
  const ledger = useBuildingLedger(property.id).data;
  const residents = useBuildingResidents(property.id).data;
  const workflow = useBuildingWorkflow(property.id).data;
  const actions = useBuildingActions(property.id).data ?? [];
  const model = useMemo(() => buildingModel(register), [register]);
  const byId = useMemo(() => new Map((workflow ?? []).map((w) => [w.spaceId, w])), [workflow]);
  const features = context?.features ?? NO_FEATURES;
  const feature = features.find((f) => f.id === property.id) ?? null;
  const { base, footprints, detail, groundM } = useBuildingScene(features, feature, model, ledger, levelId ? 'rights' : 'none');
  const level = model.levels.find((l) => l.id === levelId) ?? null;
  const record = recordId ? model.spaceById.get(recordId) ?? null : null;
  const recordWorkflow = record ? byId.get(record.id) : undefined;
  const mapHref = `/studio/areas/${register.area.id}?feature=${property.id}&mode=building`;

  const set = useCallback((patch: Record<string, string | null>) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(patch)) if (v === null) next.delete(k); else next.set(k, v);
    return next;
  }, { replace: true }), [setParams]);

  const deviation = useMemo<DeviationInput | null>(() => {
    const v = ledger?.deviation?.volume;
    if (!v || groundM === null) return null;
    return { polygons: polygonsOf(v.geometry as never) as MultiPolygon, lowerM: v.lowerM - groundM, upperM: v.upperM - groundM };
  }, [ledger, groundM]);

  const sceneState = useMemo<SceneState>(() => ({
    mode: compare ? 'deviation' : level ? 'level' : 'building',
    buildingId: property.id, levelId: compare ? null : level?.id ?? null, spaceId: compare ? null : record?.id ?? null,
    tool: 'select', deviation: compare ? deviation : null,
  }), [compare, level, record, property.id, deviation]);

  const onPick = useCallback((pick: Pick) => {
    if (compare) return;
    if (pick.kind === 'space') set({ level: pick.levelId, record: pick.id });
    else if (pick.kind === 'building' && pick.id === property.id && pick.levelId) set({ level: pick.levelId, record: null });
    else set({ record: null });
  }, [compare, set, property.id]);

  const units = useMemo(() => {
    const top = model.spaces.filter((s) => !s.parentId);
    return level ? top.filter((s) => s.levelId === level.id) : top.filter((s) => s.use === 'apartment');
  }, [model, level]);
  const workflowMap = useMemo(() => byId, [byId]);
  const snapshot = useCallback(() => engine?.snapshot() ?? null, [engine]);

  const cardBlocked = !record ? 'Blocked: select a unit with an assigned proposed code'
    : !recordWorkflow?.code ? 'Blocked: assign a proposed code first' : null;
  const stem = fileStem(register);

  return (
    <EvidenceProvider snapshot={snapshot}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <div className="ul-row">
              <h1 className="ul-title">{property.name}</h1>
              {ledgerStatus(ledger?.status) ? <StatusBadge status={ledgerStatus(ledger?.status)!} /> : null}
            </div>
            <p className={styles.meta}>
              {ledger?.address ? <>{ledger.address} · </> : null}
              Parcel ULPIN{' '}
              {register.parcelIdentifiers.length ? <span className="ul-mono">{register.parcelIdentifiers.map((p) => p.value).join(', ')}</span> : <span className="ul-unknown">not supplied</span>}
              {ledger?.declaration ? <> · {ledger.declaration}</> : null}
              {model.levels.length ? <> · {levelSummary(model)}</> : null}
            </p>
          </div>
          <Link to={mapHref} className="ul-btn ul-btn--ghost"><Icon icon={MapTrifold} />Back to map</Link>
          <Button variant={compare ? 'soft' : 'secondary'} icon={Intersect} disabled={!ledger?.deviation}
            title={ledger?.deviation ? undefined : 'Needs a sanctioned plan and an observed survey of this building'}
            onClick={() => set({ mode: compare ? null : 'deviation' })}>
            {compare ? 'Close compare' : 'Deviation check'}
          </Button>
          <Menu label="Export" icon={DownloadSimple} items={[
            { label: 'Full register (Excel)', disabled: !model.levels.length, onSelect: () => download(`${stem}-register.xlsx`, registerWorkbook(registerRows(register, model, ledger, residents, workflowMap)), '') },
            { label: 'Register extract (PDF)', disabled: !model.levels.length, onSelect: () => printRegister(registerRows(register, model, ledger, residents, workflowMap), property.name) },
            { label: 'CityJSON 2.0', disabled: !model.levels.length, onSelect: () => download(`${stem}.city.json`, cityJson(register, model, ledger, workflowMap), 'application/city+json') },
            { label: 'Units table (CSV)', disabled: !model.spaces.length, onSelect: () => download(`${stem}-units.csv`, unitsCsv(model, ledger, workflowMap), 'text/csv') },
            { label: 'Register record (JSON)', onSelect: () => download(`${stem}-register.json`, JSON.stringify({ register, ledger, residents }, null, 2), 'application/json') },
          ]} />
          <div className={styles.primary}>
            <Button variant="primary" icon={QrCode} disabled={Boolean(cardBlocked)} onClick={() => setCardOpen(true)}>Property Card</Button>
            {cardBlocked ? <span className={styles.blocked}>{cardBlocked}</span> : null}
          </div>
        </header>

        <div className={styles.body}>
          <div className={styles.sceneColumn}>
            <div className={styles.canvasWrap}>
              {context ? <SceneView look={mapLook} layers={mapLayers} className={styles.canvas} base={base} buildings={footprints} detail={detail} state={sceneState}
                onPick={onPick} onView={() => setTick((t) => (t + 1) % 1_000_000)} onReady={setEngine}
                label={`3D view of ${property.name}. The tables beside it list the same levels and units.`} /> : null}
              {compare && ledger?.deviation ? (
                <>
                  <span className={`ul-float ${styles.pill}`} style={{ left: 16 }}>{ledger.deviation.sanctioned.label}</span>
                  <span className={`ul-float ${styles.pill}`} style={{ left: 'calc(50% + 16px)' }}>{ledger.deviation.observed.label}</span>
                  <span className={styles.divider} />
                  <DeviationLabel engine={engine} tick={tick} text={deviationLabel(ledger.deviation)} />
                </>
              ) : model.levels.length ? (
                <div className={styles.rail}>
                  <LevelRail
                    levels={model.levels.map((l) => ({ id: l.id, label: l.label, lower: l.lower, estimated: l.estimated, belowGround: l.belowGround }))}
                    reference={ledger?.siteDatum ?? null} ground={groundM} selected={level?.id ?? null}
                    onSelect={(id) => set({ level: id === level?.id ? null : id, record: null })} />
                </div>
              ) : null}
              {!context ? <div className={styles.sceneLoading}><Skeleton width={160} /></div> : null}
            </div>
            {compare && ledger?.deviation ? <p className={styles.caption}>{ledger.deviation.note}</p> : null}
          </div>

          <div className={styles.side}>
            {compare && ledger?.deviation ? (
              <DeviationPanel ledger={ledger} buildingId={property.id} created={actions.find((a) => a.kind === 'finding' && a.subjectId === 'deviation') ?? null} />
            ) : (
              <>
                <Tabs label="Register sections" value={tab} onChange={(value) => set({ tab: value === 'units' ? null : value })}
                  tabs={[
                    { value: 'units', label: 'Units', count: units.length },
                    { value: 'residents', label: 'Residents', count: residents ? residents.units.reduce((n, u) => n + u.occupants.length, 0) : undefined },
                    { value: 'shares', label: 'Shares' },
                    { value: 'documents', label: 'Documents', count: ledger?.sources.length ?? register.sources.length },
                    { value: 'checks', label: 'Checks', count: ledger?.checks.filter((c) => c.state === 'blocking' || c.state === 'needs_review').length },
                    { value: 'history', label: 'History' },
                  ]} />
                <div key={tab} className={styles.tabBody}>
                  {tab === 'units' ? (
                    <UnitsTable register={register} units={units} levelLabel={level?.label ?? null} levels={new Map(model.levels.map((l) => [l.id, l.label]))}
                      ledger={ledger} workflow={workflowMap} selectedId={record?.id ?? null}
                      onSelect={(s) => set({ record: s.id === record?.id ? null : s.id, level: s.levelId })} onClearLevel={() => set({ level: null, record: null })} />
                  ) : tab === 'residents' ? (
                    <Residents residents={residents} levelLabel={level?.label ?? null} selectedId={record?.id ?? null}
                      onSelect={(spaceId) => { const s = model.spaceById.get(spaceId); if (s) set({ record: s.id === record?.id ? null : s.id, level: s.levelId }); }}
                      onClearLevel={() => set({ level: null, record: null })} />
                  ) : tab === 'shares' ? (
                    <Shares ledger={ledger} model={model} workflow={workflowMap} />
                  ) : tab === 'documents' ? (
                    <Documents register={register} ledger={ledger} />
                  ) : tab === 'checks' ? (
                    ledger ? (
                      <Panel title="Checks" aside={<span className="ul-caption">{ledger.checkMethod}</span>}>
                        <CheckGroups checks={ledger.checks} action={(c) => (c.findingId && c.state !== 'passed' ? 'Open in 3D' : null)}
                          onOpen={(c) => navigate(`/studio/areas/${register.area.id}?feature=${property.id}&mode=findings&finding=${c.findingId}`)} />
                      </Panel>
                    ) : <Panel title="Checks"><p className="ul-help">Not assessed: no checks have run on this building's records.</p></Panel>
                  ) : (
                    <History register={register} ledger={ledger} workflow={workflow ?? []} actions={actions} />
                  )}
                </div>
                {register.missing.length ? (
                  <Panel title="What the sources do not say">
                    <ul className={styles.gaps}>{register.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                  </Panel>
                ) : null}
              </>
            )}
          </div>
        </div>

        {cardOpen && record && recordWorkflow?.code ? (
          <CardDialog workflow={recordWorkflow} space={record} buildingName={property.name}
            level={model.levels.find((l) => l.id === record.levelId) ?? null} onClose={() => setCardOpen(false)} />
        ) : null}
      </div>
    </EvidenceProvider>
  );
}

const NO_FEATURES: never[] = [];

function deviationLabel(d: NonNullable<BuildingLedger['deviation']>) {
  const storeys = d.observed.storeys - d.sanctioned.storeys;
  return [storeys > 0 ? `+${storeys} storey${storeys > 1 ? 's' : ''}` : null, d.observed.rooftopAreaM2 ? `${d.observed.rooftopAreaM2} m²` : null].filter(Boolean).join(' · ');
}

function DeviationLabel({ engine, tick, text }: { engine: SceneEngine | null; tick: number; text: string }) {
  void tick;
  const at = engine?.projectRight('deviation');
  if (!at?.visible || !text) return null;
  return <span className={styles.critical} style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -115%)` }}>{text}</span>;
}

function UnitsTable({ register, units, levelLabel, levels, ledger, workflow, selectedId, onSelect, onClearLevel }: {
  register: BuildingRegister; units: SpaceModel[]; levelLabel: string | null; levels: Map<string, string>; ledger: BuildingLedger | null | undefined;
  workflow: Map<string, SpaceWorkflow>; selectedId: string | null; onSelect: (s: SpaceModel) => void; onClearLevel: () => void;
}) {
  if (!units.length && !levelLabel) {
    return (
      <div className="ul-panel">
        <EmptyState icon={FilePlus} title="No floors recorded for this building"
          action={<Link to={`/studio/add-files?feature=${register.property.id}`} className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>}>
          Add a plan or level schedule.
        </EmptyState>
      </div>
    );
  }
  const unknown = <em className="ul-unknown">Unknown</em>;
  return (
    <div className="ul-panel">
      {levelLabel ? (
        <div className={styles.filterBar}>
          <span>Spaces on <b>{levelLabel}</b></span>
          <button type="button" className="ul-btn ul-btn--ghost" onClick={onClearLevel}>All units</button>
        </div>
      ) : null}
      <DataTable
        caption={levelLabel ? `Spaces on ${levelLabel}` : 'Units in this building'}
        rows={units}
        rowKey={(s) => s.id}
        selectedKey={selectedId}
        onRowClick={onSelect}
        columns={[
          { header: 'Level', cell: (s) => (s.levelId ? levels.get(s.levelId) : unknown), width: '10%' },
          { header: 'Unit', cell: (s) => <strong>{s.name}</strong>, width: '20%' },
          { header: 'Code', cell: (s) => { const code = workflow.get(s.id)?.code; return code ? <span className="ul-id">{code.slice(0, 7)}…{code.slice(-3)}</span> : <span className="ul-muted">After review</span>; }, width: '20%' },
          { header: 'Carpet m²', numeric: true, cell: (s) => { const v = ledgerSpace(ledger, s.id)?.carpetAreaM2; return v ? v.value.toFixed(2) : s.use === 'apartment' ? unknown : <span className="ul-muted">—</span>; }, width: '15%' },
          { header: 'Share %', numeric: true, cell: (s) => { const v = ledgerSpace(ledger, s.id)?.sharePct; return v ? v.value.toFixed(2) : s.use === 'apartment' ? unknown : <span className="ul-muted">—</span>; }, width: '13%' },
          { header: 'Status', cell: (s) => <StatusBadge status={unitStatus(workflow.get(s.id), ledger, s.id)} /> },
        ]}
      />
    </div>
  );
}

function Residents({ residents, levelLabel, selectedId, onSelect, onClearLevel }: {
  residents: BuildingResidents | null | undefined; levelLabel: string | null; selectedId: string | null; onSelect: (spaceId: string) => void; onClearLevel: () => void;
}) {
  if (!residents) {
    return (
      <Panel title="Residents" aside={<StatusBadge status="Not assessed" />}>
        <p className="ul-help">No register extract is linked to this building yet. Holders come from the deed index; residents from the society or tenant register.</p>
      </Panel>
    );
  }
  const rows = levelLabel ? residents.units.filter((u) => u.level === levelLabel) : residents.units;
  const people = rows.reduce((n, u) => n + u.occupants.length, 0);
  const tone = { owner_occupied: 'success', rented: 'info', vacant: 'neutral' } as const;
  return (
    <div className="ul-panel">
      <div className={styles.filterBar}>
        <span>{levelLabel ? <>Residents on <b>{levelLabel}</b> · </> : null}<span className="ul-num">{people}</span> people in <span className="ul-num">{rows.length}</span> units · as of {formatDate(residents.asOf)}</span>
        {levelLabel ? <button type="button" className="ul-btn ul-btn--ghost" onClick={onClearLevel}>All floors</button> : null}
      </div>
      <DataTable
        caption={levelLabel ? `Residents on ${levelLabel}` : 'Registered holders and residents of each unit'}
        rows={rows}
        rowKey={(u) => u.spaceId}
        selectedKey={selectedId}
        onRowClick={(u) => onSelect(u.spaceId)}
        columns={[
          { header: 'Level', cell: (u) => u.level, width: '8%' },
          { header: 'Unit', cell: (u) => <strong>{u.unit}</strong>, width: '13%' },
          { header: 'Registered holders', cell: (u) => (
            <span className={styles.people}>{u.holders.map((h) => <span key={h.name}>{h.name}{u.holders.length > 1 ? <span className="ul-muted"> · {h.sharePct} %</span> : null}</span>)}
              <span className="ul-caption ul-mono">{u.holders[0]?.deedNo} · {formatDate(u.holders[0]?.since ?? '')}</span></span>
          ), width: '30%' },
          { header: 'Occupancy', cell: (u) => <Badge tone={tone[u.occupancy]} icon={null}>{occupancyLabel(u.occupancy)}</Badge>, width: '14%' },
          { header: 'Living here', cell: (u) => (u.occupants.length ? (
            <span className={styles.people}>{u.occupants.map((o) => <span key={o.name + o.relation}>{o.name} <span className="ul-muted">· {o.relation}</span></span>)}</span>
          ) : <span className="ul-muted">No one registered</span>) },
        ]}
      />
      <p className={`ul-caption ${styles.residentsSource}`}>{residents.source}. For official use.</p>
    </div>
  );
}

function Shares({ ledger, model, workflow }: { ledger: BuildingLedger | null | undefined; model: ReturnType<typeof buildingModel>; workflow: Map<string, SpaceWorkflow> }) {
  const openEvidence = useOpenEvidence();
  if (!ledger || ledger.shareTotalPct === null) {
    return (
      <Panel title="Undivided shares" aside={<StatusBadge status="Not assessed" />}>
        <p className="ul-help">Not assessed: no declaration of shares is among this building's sources. Add the deed of declaration to check that shares total 100 %.</p>
      </Panel>
    );
  }
  const units = model.spaces.filter((s) => s.use === 'apartment');
  const rows = units.map((s) => ({ space: s, share: ledgerSpace(ledger, s.id)?.sharePct ?? null, carpet: ledgerSpace(ledger, s.id)?.carpetAreaM2 ?? null }));
  const declared = rows.filter((r) => r.share).length;
  const gap = Math.round((100 - ledger.shareTotalPct) * 100) / 100;
  const evidence = ledger.shareEvidence;
  return (
    <div className={styles.stack}>
      {gap !== 0 ? <Banner tone="warning">Shares total {ledger.shareTotalPct.toFixed(2)} %: {Math.abs(gap).toFixed(2)} % {gap > 0 ? 'unexplained' : 'over'} against the expected 100 %.</Banner> : null}
      <Panel title="Undivided shares" aside={<span className="ul-row"><span className="ul-num">{ledger.shareTotalPct.toFixed(2)} %</span>{gap !== 0 ? <StatusBadge status="Needs review" /> : <StatusBadge status="Reviewed" />}</span>}
        flush={(
          <DataTable caption="Share of each unit" rows={rows} rowKey={(r) => r.space.id} columns={[
            { header: 'Unit', cell: (r) => <strong>{r.space.name}</strong>, width: '28%' },
            { header: 'Code', cell: (r) => { const c = workflow.get(r.space.id)?.code; return c ? <span className="ul-id">{c.slice(0, 7)}…{c.slice(-3)}</span> : <span className="ul-muted">—</span>; }, width: '24%' },
            { header: 'Carpet m²', numeric: true, cell: (r) => (r.carpet ? r.carpet.value.toFixed(2) : <em className="ul-unknown">Unknown</em>) },
            { header: 'Share %', numeric: true, cell: (r) => (r.share ? r.share.value.toFixed(3) : <em className="ul-unknown">Unknown</em>) },
          ]} />
        )}>
        <DescriptionList items={[
          { label: 'Basis', value: ledger.shareBasis ?? <span className="ul-unknown">Unknown</span> },
          { label: 'Units with a share', value: <span className="ul-num">{declared} of {units.length}</span> },
          { label: 'Declared in', value: evidence ? <EvidenceChip kind="document" source={evidence.source} locator={evidence.locator}
            onOpen={() => openEvidence({ sourceId: evidence.sourceId, label: evidence.source, locator: parseLocator({ locator: evidence.locator }) })} /> : <span className="ul-unknown">No source</span> },
        ]} />
      </Panel>
    </div>
  );
}

function Documents({ register, ledger }: { register: BuildingRegister; ledger: BuildingLedger | null | undefined }) {
  const openEvidence = useOpenEvidence();
  const sources = ledger?.sources ?? register.sources.map((s) => ({ sourceId: s.id, kind: 'table' as const, name: s.name, file: s.name, summary: `r${s.revision}` }));
  const bySource = new Map(register.sources.map((s) => [s.id, s]));
  return (
    <Panel title="Sources" aside={<span className="ul-caption">{sources.length}</span>} flush={(
      <ul className={styles.sources}>
        {sources.map((s) => {
          const retained = bySource.get(s.sourceId);
          return (
            <li key={s.sourceId}>
              <EvidenceChip kind={s.kind} source={s.name} locator={s.summary}
                onOpen={() => openEvidence({ sourceId: s.sourceId, label: s.name, locator: parseLocator({ locator: s.summary }) })} />
              <span className="ul-caption">{s.file}{retained ? <> · r{retained.revision} · {formatDate(retained.createdAt)} · <span className="ul-mono">{shortHash(retained.sha256)}</span></> : null}</span>
            </li>
          );
        })}
      </ul>
    )} />
  );
}

function History({ register, ledger, workflow, actions }: {
  register: BuildingRegister; ledger: BuildingLedger | null | undefined; workflow: SpaceWorkflow[]; actions: { title: string; at: string; by: string; hash: string; previousHash: string | null; kind: string }[];
}) {
  const own = [
    ...actions.map((a) => ({ id: a.hash, title: a.title, kind: a.kind === 'finding' ? 'evidence' as const : 'draft' as const, at: a.at, by: a.by, hash: a.hash, previousHash: a.previousHash })),
    ...workflow.flatMap((w) => w.events.map((e) => ({ id: `${w.spaceId}-${e.hash}`, title: `${w.spaceName}: ${e.title}`, kind: e.kind, at: e.at, by: e.by, hash: e.hash, previousHash: e.previousHash }))),
  ];
  const recorded = ledger?.revisions.map((r) => ({ id: r.hash, title: r.title, kind: r.kind, at: r.at, by: r.actor, hash: r.hash, previousHash: r.previousHash }))
    ?? register.sources.slice(0, 1).map((s) => ({ id: s.id, title: `r${register.property.revision} Imported from ${s.name}`, kind: 'draft' as const, at: s.createdAt, by: 'Import', hash: s.sha256, previousHash: null }));
  const revisions = [...own, ...recorded].sort((a, b) => b.at.localeCompare(a.at)).map((r) => ({
    id: r.id, title: r.title, kind: r.kind, byline: `${r.by} · ${formatDateTime(r.at)}`, hash: shortHash(r.hash), previousHash: r.previousHash ? shortHash(r.previousHash) : null,
  }));
  return <RevisionTimeline revisions={revisions} chain={ledger ? 'consistent' : 'unknown'} />;
}

function DeviationPanel({ ledger, buildingId, created }: {
  ledger: BuildingLedger; buildingId: string; created: { at: string; title: string } | null;
}) {
  const d = ledger.deviation!;
  const openEvidence = useOpenEvidence();
  const record = useRecordAction();
  const clear = useClearAction();
  const over = (a: number, b: number) => (b > a ? <strong className={styles.over}>{b}</strong> : b);
  const storeys = d.observed.storeys - d.sanctioned.storeys;
  const heightDelta = Math.round((d.observed.heightM - d.sanctioned.heightM) * 10) / 10;
  const open = (sourceId: string, source: string, locator: string) => openEvidence({ sourceId, label: source, locator: parseLocator({ locator }) });
  return (
    <Panel title="Sanctioned against observed" aside={created ? <Badge tone="danger" icon={null}>Finding raised</Badge> : <StatusBadge status={d.state === 'passed' ? 'Reviewed' : d.state === 'not_assessed' ? 'Not assessed' : 'Needs review'} />}
      footer={created ? (
        <div className={styles.footRow}>
          <span className="ul-help">Raised {formatDateTime(created.at)}. It is listed in the building's history.</span>
          <Button variant="ghost" onClick={() => clear.mutate({ buildingId, kind: 'finding', subjectId: 'deviation' })}>Withdraw</Button>
        </div>
      ) : (
        <Button variant="primary" disabled={record.isPending || d.state === 'passed'} onClick={() => record.mutate({
          buildingId, kind: 'finding', subjectId: 'deviation', value: 'needs_review',
          title: `Deviation finding raised: ${storeys > 0 ? `+${storeys} storey, ` : ''}+${heightDelta.toFixed(1)} m against the sanctioned plan`,
        })}>Create finding</Button>
      )}>
      <div className={styles.stack}>
        <table className="ul-table">
          <thead><tr><th scope="col"><span className="ul-visually-hidden">Measure</span></th><th scope="col">Sanctioned</th><th scope="col">Observed</th></tr></thead>
          <tbody>
            <tr><th scope="row">Storeys</th><td className="ul-num">{d.sanctioned.storeys}</td><td className="ul-num">{over(d.sanctioned.storeys, d.observed.storeys)}</td></tr>
            <tr><th scope="row">Height</th><td className="ul-num">{d.sanctioned.heightM.toFixed(1)} m</td><td className="ul-num">{d.observed.heightM > d.sanctioned.heightM ? <strong className={styles.over}>{d.observed.heightM.toFixed(1)} m</strong> : `${d.observed.heightM.toFixed(1)} m`}</td></tr>
            <tr><th scope="row">Rooftop structure</th><td className="ul-num">—</td><td className="ul-num">{d.observed.rooftopAreaM2 === null ? <em className="ul-unknown">Unknown</em> : `${d.observed.rooftopAreaM2} m²`}</td></tr>
            <tr><th scope="row">Setback</th><td className="ul-num">{d.setback === 'not_comparable' ? <StatusBadge status="Not comparable" /> : 'Compared'}</td><td className="ul-num ul-muted">{d.setback === 'not_comparable' ? 'roofprint only' : '—'}</td></tr>
          </tbody>
        </table>
        {d.exclusions ? <p className="ul-help">{d.exclusions}</p> : null}
        <div className="ul-row">
          <EvidenceChip kind="document" source={d.sanctioned.source} locator={d.sanctioned.locator} onOpen={() => open(d.sanctioned.sourceId, d.sanctioned.source, d.sanctioned.locator)} />
          <EvidenceChip kind="feature" source={d.observed.source} locator={d.observed.locator} onOpen={() => open(d.observed.sourceId, d.observed.source, d.observed.locator)} />
        </div>
        <DescriptionList items={[{ label: 'Surveyed', value: formatDate(d.observed.surveyedAt) }]} />
      </div>
    </Panel>
  );
}
