import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FilePlus } from '@phosphor-icons/react';
import { SceneView } from '@ulpin/scene/react';
import type { FindingInput, Measurement, Pick, SceneEngine, SceneState, SceneTool, Trench } from '@ulpin/scene';
import { Badge, Banner, Icon, Legend, LevelRail, SeverityBadge, Toast, type LegendSection } from '@ulpin/ui';
import { useBuildingLedger, useBuildingRegister, type AreaContext } from '../../api/queries';
import { buildingModel } from '../../model/building';
import { effectiveColour } from '../../state/selection';
import { useSelection } from '../../state/useSelection';
import { EvidenceProvider } from '../evidence/EvidenceContext';
import { AssignDialog } from '../identity/AssignDialog';
import { CardDialog } from '../identity/CardDialog';
import { useSpaceWorkflow } from '../workflow/useWorkflow';
import { polygonsOf } from './footprints';
import { findingVolume, useBuildingScene } from './useBuildingScene';
import { MapSidebar } from './MapSidebar';
import { ImportTray } from './ImportTray';
import { ScaleAndNorth } from './ScaleAndNorth';
import { SceneLabels } from './SceneLabels';
import type { SceneLabel } from './labels';
import { RIGHTS_LABEL, RIGHTS_TOKEN, ledgerSpace } from './ledger';
import { AreaInspector } from './inspector/AreaInspector';
import { BuildingInspector } from './inspector/BuildingInspector';
import { FindingsInspector } from './inspector/FindingsInspector';
import { SpaceInspector } from './inspector/SpaceInspector';
import { UndergroundInspector } from './inspector/UndergroundInspector';
import type { Crumb } from './inspector/InspectorShell';
import styles from './MapWorkspace.module.css';

const ATTRIBUTION: Record<string, string> = {
  'nyc-building-footprints': 'City of New York Office of Technology and Innovation (OTI), BUILDING via NYC Open Data',
  'swiss-dwellings': 'Swiss Dwellings (Zenodo 7070952), CC BY 4.0',
};

/**
 * S4–S6, S8: one canvas whose modes (area, building, level, findings, underground) share one selection,
 * one inspector and one set of floating tools. The URL holds the selection; the tool is transient.
 */
export function MapWorkspace({ context }: { context: AreaContext }) {
  const { selection, dispatch, patch } = useSelection();
  const [searchParams] = useSearchParams();
  const packageId = searchParams.get('package');
  const [engine, setEngine] = useState<SceneEngine | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<'assign' | 'card' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tool, setTool] = useState<SceneTool>('select');
  const [sectionM, setSectionM] = useState<number | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [trench, setTrench] = useState<Trench | null>(null);

  const buildings = useMemo(() => context.features.filter((f) => f.kind === 'building'), [context.features]);
  const utilities = useMemo(() => context.features.filter((f) => f.kind === 'utility'), [context.features]);
  const feature = selection.buildingId ? buildings.find((b) => b.id === selection.buildingId) ?? null : null;
  const registerQuery = useBuildingRegister(feature?.id);
  const register = registerQuery.data;
  const ledger = useBuildingLedger(feature?.id).data;
  const model = useMemo(() => (register ? buildingModel(register) : null), [register]);
  const level = model?.levels.find((l) => l.id === selection.levelId) ?? null;
  const space = selection.spaceId ? model?.spaceById.get(selection.spaceId) ?? null : null;
  const spaceWorkflow = useSpaceWorkflow(space?.id ?? null);
  const reference = context.area.reference;
  const groundM = ledger?.groundElevationM ?? null;
  const colour = effectiveColour(selection);
  const findings = register?.findings ?? [];
  const finding = selection.mode === 'findings' ? findings.find((f) => f.id === selection.findingId) ?? findings[0] ?? null : null;

  const { base, footprints, detail } = useBuildingScene(context.features, feature, model, ledger, colour);

  const findingInput = useMemo<FindingInput | null>(() => (finding ? findingVolume(finding, groundM) : null), [finding, groundM]);

  const sceneState = useMemo<SceneState>(() => ({
    mode: selection.mode, buildingId: selection.buildingId, levelId: selection.levelId, spaceId: selection.spaceId,
    tool, sectionM: tool === 'section' ? sectionM : null, finding: findingInput,
  }), [selection, tool, sectionM, findingInput]);

  // Parcel code under the selected building (area mode), from the parcel the building is associated with.
  useEffect(() => {
    if (!engine) return;
    const parcelId = register?.parcelIdentifiers[0]?.parcelId;
    const parcel = parcelId ? context.features.find((f) => f.id === parcelId) : null;
    const ring = parcel ? polygonsOf(parcel.geometry)[0]?.[0] : null;
    if (!ring?.length) { engine.setAnchor('parcel', null); return; }
    const xs = ring.map(([x]) => x), ys = ring.map(([, y]) => y);
    engine.setAnchor('parcel', [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys) + 3, 0.3]);
  }, [engine, register, context.features]);

  const onPick = useCallback((pick: Pick) => {
    if (pick.kind === 'building') dispatch({ type: 'pickBuilding', id: pick.id, levelId: pick.levelId });
    else if (pick.kind === 'space') dispatch({ type: 'pickSpace', id: pick.id, levelId: pick.levelId });
    else dispatch({ type: 'pickGround' });
  }, [dispatch]);

  // Escape: leave a tool first, then unwind the selection one step (dialogs catch their own Escape).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dialog) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') return;
      if (tool !== 'select') { setTool('select'); setMeasurement(null); return; }
      dispatch({ type: 'escape' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, dialog, tool]);

  useEffect(() => {
    if (!import.meta.env.DEV || !engine) return;
    const target = window as unknown as { __ulpinSceneStats?: () => unknown; __ulpinScene?: SceneEngine };
    target.__ulpinSceneStats = () => engine.stats();
    target.__ulpinScene = engine;
    return () => { delete target.__ulpinSceneStats; delete target.__ulpinScene; };
  }, [engine]);

  const onView = useCallback(() => setTick((t) => (t + 1) % 1_000_000), []);
  const snapshot = useCallback(() => engine?.snapshot() ?? null, [engine]);
  const chooseTool = (next: SceneTool) => {
    if (next === 'section' && feature) setSectionM((m) => m ?? Math.round(((engine?.buildingTopM(feature.id) ?? 20) / 2) * 10) / 10);
    if (next !== 'measure') setMeasurement(null);
    setTool(next);
  };
  const toggleUnderground = () => { setTool('select'); dispatch(selection.mode === 'underground' ? { type: 'leaveMode' } : { type: 'openUnderground' }); };
  const chooseColour = (c: Exclude<typeof colour, never>) => {
    patch({ colourBy: c });
    if (c === 'rights' && selection.mode !== 'level') { const f = typicalFloor(); if (f) dispatch({ type: 'selectLevel', id: f.id }); }
    if (c === 'utilities' && feature && selection.mode !== 'underground') dispatch({ type: 'openUnderground' });
  };
  // Tool shortcuts, shown in the sidebar: V select, M measure, X section, U underground, R reset.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialog || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === 'v') chooseTool('select');
      else if (key === 'm') chooseTool(tool === 'measure' ? 'select' : 'measure');
      else if (key === 'x' && feature) chooseTool(tool === 'section' ? 'select' : 'section');
      else if (key === 'u' && feature) toggleUnderground();
      else if (key === 'r') engine?.resetCamera();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const typicalFloor = () => {
    const floors = model?.levels.filter((l) => /^F\d/i.test(l.label)) ?? [];
    return floors.length > 2 ? floors[Math.floor(floors.length / 4)] : floors[0] ?? model?.levels[0];
  };

  // Crumbs of the selection path.
  const crumbs: Crumb[] = [{ label: context.area.name, onSelect: () => dispatch({ type: 'selectBuilding', id: null }) }];
  if (feature) crumbs.push({ label: feature.name, onSelect: selection.mode === 'area' ? undefined : () => dispatch({ type: 'exploreBuilding' }) });
  if (selection.mode === 'level' && level) crumbs.push({ label: level.label, onSelect: space ? () => dispatch({ type: 'selectSpace', id: null }) : undefined });
  if (selection.mode === 'findings') crumbs.push({ label: 'Findings' });
  if (selection.mode === 'underground') crumbs.push({ label: 'Underground' });

  // Labels: selection and hover; the explored level's spaces; findings, utilities and tools.
  const labels: SceneLabel[] = [];
  if (selection.mode === 'area' || selection.mode === 'building') {
    if (feature) labels.push({ id: feature.id, text: feature.name, kind: 'selected' });
    if (feature && selection.mode === 'area' && register?.parcelIdentifiers[0]) labels.push({ id: 'parcel', text: register.parcelIdentifiers[0].value, kind: 'code' });
    const hover = hovered && hovered !== feature?.id ? buildings.find((b) => b.id === hovered) : null;
    if (hover) labels.push({ id: hover.id, text: hover.name, kind: 'hover' });
  }
  if (selection.mode === 'level' && model) {
    for (const s of model.spaces) {
      if (s.levelId !== selection.levelId || !s.polygons.length || s.parentId) continue;
      const small = s.use === 'stair' || s.use === 'lift';
      labels.push({ id: s.id, text: small ? s.name.split(' ').pop()! : s.shortName, kind: s.id === space?.id ? 'space-selected' : 'space' });
    }
  }
  if (selection.mode === 'findings' && finding && model) {
    if (findingInput?.polygons.length && typeof finding.volumeM3 === 'number') {
      labels.push({ id: 'finding', text: `${finding.volumeM3.toFixed(1)} m³ ${finding.code === 'partition_void' ? 'void' : 'overlap'}`, kind: 'critical' });
    }
    for (const id of finding.featureIds) { const s = model.spaceById.get(id); if (s) labels.push({ id: s.id, text: s.name, kind: 'hover' }); }
  }
  if (selection.mode === 'underground') {
    for (const u of utilities) labels.push({ id: `utility:${u.id}`, text: u.name, kind: 'hover' });
    if (trench?.ring) {
      labels.push({ id: 'trench', text: `Trench · ${trench.lengthM?.toFixed(0)} m`, kind: 'selected' });
      for (let d = 0; d <= 20; d += 5) labels.push({ id: `depth:${d}`, text: `${d} m`, kind: 'tick' });
    }
    if (!utilities.length) labels.push({ id: 'no-survey', text: 'No survey', kind: 'hover' });
  }
  if (tool === 'measure' && typeof measurement?.distanceM === 'number') labels.push({ id: 'measure-mid', text: `${measurement.distanceM.toFixed(2)} m`, kind: 'selected' });
  if (tool === 'section' && sectionM !== null) labels.push({ id: 'section', text: `Cut at ${sectionM.toFixed(1)} m`, kind: 'selected' });

  // Legend: only the active Colour by, plus the evidence key on a floor.
  const legend: LegendSection[] = [];
  if (selection.mode === 'level' && model && colour === 'rights') {
    const onLevel = model.spaces.filter((s) => s.levelId === selection.levelId && s.polygons.length);
    const count = (r: string) => onLevel.filter((s) => (ledgerSpace(ledger, s.id)?.rights ?? 'unknown') === r).length;
    legend.push({ title: 'Rights', items: (['exclusive', 'shared', 'public', 'unknown'] as const).map((r) => ({ label: RIGHTS_LABEL[r], count: count(r), color: `var(${RIGHTS_TOKEN[r]})`, hatch: r === 'unknown' })) });
  }
  if (selection.mode === 'level') {
    legend.push({ title: 'Evidence', items: [
      { label: 'Measured or documented', color: 'var(--ui-map-building)' },
      { label: 'Estimated', color: 'var(--ui-map-building)', hatch: true },
    ] });
  }
  if (selection.mode === 'underground' && colour !== 'none') {
    legend.push({ title: 'Utilities', items: [
      ...utilities.map((u) => {
        const network = String((u.utilityProfile as Record<string, unknown> | undefined)?.network ?? '');
        return { label: u.name, color: `var(${network === 'metro' ? '--ui-rights-public' : `--ui-utility-${network || 'water'}`})` };
      }),
      { label: 'No survey', color: 'var(--ui-readiness-unknown)', hatch: true },
    ] });
  }
  if (selection.mode === 'findings' && findings.length) {
    const blocking = findings.filter((f) => f.category === 'blocking').length;
    legend.push({ title: 'Findings', items: [
      { label: 'Blocking', count: blocking, color: 'var(--ui-mark-critical)', hatch: true },
      { label: 'Needs review', count: findings.length - blocking, color: 'var(--ui-mark-warning)' },
    ] });
  }

  const showRail = (selection.mode === 'building' || selection.mode === 'level') && Boolean(model?.levels.length);
  const noFloors = selection.mode === 'building' && register && !model?.levels.length;
  const namespaces = [...new Set(context.features.map((f) => f.datasetNamespace))].filter((ns) => ATTRIBUTION[ns]);
  const readout = [reference?.sourceCrs, groundM !== null ? `${groundM.toFixed(2)} m` : null, ledger?.siteDatum].filter(Boolean).join(' · ');
  const readoutTitle = reference
    ? `Horizontal: ${reference.analysisCrs} (source ${reference.sourceCrs}). Heights: ${reference.verticalReference}.`
    : 'No reference system: this area stays in its source’s local frame.';
  const hint = selection.mode === 'underground' && !trench?.ring ? (trench?.points.length === 1 ? 'Click the other end of the trench' : 'Click two points on the ground to draw a trench')
    : tool === 'measure' ? (measurement?.points.length === 1 ? 'Click the second point' : 'Click two points to measure')
    : selection.mode === 'area' && !feature ? 'Select a building'
      : selection.mode === 'building' && model?.levels.length ? 'Select a floor'
        : selection.mode === 'level' && !space ? 'Select a unit' : null;

  let inspector;
  if (selection.mode === 'underground' && feature) inspector = <UndergroundInspector utilities={utilities} trench={trench} onClear={() => engine?.clearTrench()} />;
  else if (selection.mode === 'findings' && feature) {
    inspector = <FindingsInspector register={register} ledger={ledger} findingId={finding?.id ?? null} buildingId={feature.id} crumbs={crumbs}
      onOpenSpace={(id) => { const s = model?.spaceById.get(id); if (s?.levelId) dispatch({ type: 'pickSpace', id, levelId: s.levelId }); }} />;
  } else if (selection.mode === 'level' && space && model && register && feature) {
    inspector = (
      <SpaceInspector space={space} level={level} model={model} register={register} ledger={ledger} buildingId={feature.id} crumbs={crumbs}
        datum={ledger?.siteDatum ?? null} onSelectSpace={(id) => dispatch({ type: 'selectSpace', id })}
        onAssign={() => setDialog('assign')} onCard={() => setDialog('card')} onFinding={(id) => dispatch({ type: 'openFindings', findingId: id })} />
    );
  } else if (feature) {
    inspector = (
      <BuildingInspector feature={feature} register={register} model={model} ledger={ledger} registerPending={registerQuery.isPending} crumbs={crumbs}
        exploring={selection.mode === 'level'}
        onExplore={() => { const f = typicalFloor(); if (f) dispatch({ type: 'selectLevel', id: f.id }); }}
        onFindings={(findingId) => dispatch({ type: 'openFindings', findingId: findingId ?? null })} />
    );
  } else inspector = <AreaInspector area={context.area} buildings={buildings} onSelect={(id) => dispatch({ type: 'selectBuilding', id })} />;

  const tray = packageId ? <ImportTray packageId={packageId} /> : selection.mode === 'findings' && findings.length ? (
    <div className={`ul-panel ${styles.findingTray}`} role="listbox" aria-label="Findings">
      {findings.map((f) => (
        <button key={f.id} type="button" role="option" aria-selected={f.id === finding?.id} onClick={() => dispatch({ type: 'openFindings', findingId: f.id })}>
          <SeverityBadge severity={f.category === 'blocking' ? 'blocking' : 'needs-review'} />
          <span>{f.message}</span>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <EvidenceProvider snapshot={snapshot}>
      <div className={styles.workspace}>
        <MapSidebar
          tool={tool} underground={selection.mode === 'underground'} canSection={Boolean(feature)} canUnderground={Boolean(feature)}
          onTool={chooseTool} onUnderground={toggleUnderground} onReset={() => engine?.resetCamera()}
          section={tool === 'section' && feature && sectionM !== null ? { value: sectionM, max: engine?.buildingTopM(feature.id) ?? 30, onChange: setSectionM } : null}
          measurement={measurement} onClearMeasure={() => engine?.clearMeasure()}
          colour={colour} onColour={chooseColour}
          colourOptions={[
            { value: 'none', label: 'None' },
            { value: 'rights', label: 'Rights', disabled: !model?.levels.length },
            { value: 'utilities', label: 'Utilities', disabled: !utilities.length || !feature },
          ]}
          floor={selection.mode === 'level' && level ? level.label : null}
          spaces={selection.mode === 'level' && model ? model.spaces.filter((s) => s.levelId === selection.levelId && !s.parentId) : []}
          rightsColour={(id) => (colour === 'rights' ? `var(${RIGHTS_TOKEN[ledgerSpace(ledger, id)?.rights ?? 'unknown']})` : null)}
          selectedSpaceId={selection.spaceId}
          onSelectSpace={(s) => s.levelId && dispatch({ type: 'pickSpace', id: s.id, levelId: s.levelId })}
        />

        <section className={`${styles.canvasColumn} ${tray ? styles.withTray : ''}`} aria-label="Map">
          <div className={styles.canvasWrap}>
            <SceneView
              className={styles.canvas}
              base={base}
              buildings={footprints}
              detail={detail}
              state={sceneState}
              onPick={onPick}
              onHover={(pick) => setHovered(pick.kind === 'ground' ? null : pick.id)}
              onView={onView}
              onMeasure={setMeasurement}
              onTrench={setTrench}
              onReady={setEngine}
              label={`3D map of ${context.area.name}. The inspector lists the same buildings and spaces.`}
            />
            {!reference ? (
              <div className={styles.banner}>
                <Banner tone="info">This area stays in its source’s local frame: the source states no coordinate reference system, so it is not placed on the map.</Banner>
              </div>
            ) : null}
            {showRail && model ? (
              <div className={styles.rail}>
                <LevelRail
                  levels={model.levels.map((l) => ({ id: l.id, label: l.label, lower: l.lower, estimated: l.estimated, belowGround: l.belowGround }))}
                  reference={ledger?.siteDatum ?? reference?.verticalReference ?? null}
                  ground={groundM}
                  selected={selection.levelId}
                  onSelect={(id) => dispatch({ type: 'selectLevel', id })}
                />
              </div>
            ) : null}
            {noFloors ? (
              <div className={styles.emptyOverlay}>
                <div className={`ul-float ${styles.emptyCard}`}>
                  <span>No floors recorded for this building. Add a plan or level schedule.</span>
                  <Link to={`/studio/add-files?feature=${feature!.id}`} className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>
                </div>
              </div>
            ) : null}
            <SceneLabels engine={engine} labels={labels} tick={tick} />
            {legend.length ? <div className={styles.legend}><Legend sections={legend} /></div> : null}
            {hint ? <div className={styles.hint} key={hint}>{hint}</div> : null}
            <div className={styles.readout}><ScaleAndNorth engine={engine} tick={tick} title={readoutTitle} prefix={readout} /></div>
            {namespaces.length ? <p className={styles.attribution}>{namespaces.map((ns) => ATTRIBUTION[ns]).join(' · ')}</p> : null}
          </div>
          {tray ? <div className={styles.tray}>{tray}</div> : null}
        </section>

        <div className={styles.inspectorColumn}>{inspector}</div>
      </div>

      {dialog === 'assign' && space && register ? (
        <AssignDialog space={space} register={register} onClose={() => setDialog(null)} onAssigned={(code) => { setDialog(null); setToast(code); }} />
      ) : null}
      {dialog === 'card' && space && spaceWorkflow.data?.code && feature ? (
        <CardDialog workflow={spaceWorkflow.data} space={space} level={level} buildingName={feature.name} onClose={() => setDialog(null)} />
      ) : null}
      {toast ? (
        <Toast onDone={() => setToast(null)}>
          <Badge tone="primary">Assigned</Badge>
          <span className="ul-id">{toast.slice(0, 7)}…{toast.slice(-3)}</span>
          <button type="button" className="ul-btn ul-btn--soft" onClick={() => { setToast(null); setDialog('card'); }}>Make Property Card</button>
        </Toast>
      ) : null}
    </EvidenceProvider>
  );
}
