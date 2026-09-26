import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FilePlus } from '@phosphor-icons/react';
import { SceneView } from '@ulpin/scene/react';
import type { BuildingDetailInput, Pick, SceneEngine, SceneState } from '@ulpin/scene';
import { Banner, Badge, Icon, Legend, LevelRail, Toast, type LegendSection } from '@ulpin/ui';
import { useBuildingRegister, type AreaContext } from '../../api/queries';
import { buildingModel } from '../../model/building';
import { useSelection } from '../../state/useSelection';
import { EvidenceProvider } from '../evidence/EvidenceContext';
import { AssignDialog } from '../identity/AssignDialog';
import { CardDialog } from '../identity/CardDialog';
import { useSpaceWorkflow } from '../workflow/useWorkflow';
import { toFootprints } from './footprints';
import { LayersPanel } from './LayersPanel';
import { MapToolbar } from './MapToolbar';
import { ScaleAndNorth } from './ScaleAndNorth';
import { SceneLabels } from './SceneLabels';
import type { SceneLabel } from './labels';
import { AreaInspector } from './inspector/AreaInspector';
import { BuildingInspector } from './inspector/BuildingInspector';
import { FindingsInspector } from './inspector/FindingsInspector';
import { LevelInspector } from './inspector/LevelInspector';
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
 * one inspector and one set of floating tools. The URL holds the selection.
 */
export function MapWorkspace({ context }: { context: AreaContext }) {
  const { selection, dispatch, patch } = useSelection();
  const [engine, setEngine] = useState<SceneEngine | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<'assign' | 'card' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const buildings = useMemo(() => context.features.filter((f) => f.kind === 'building'), [context.features]);
  const footprints = useMemo(() => toFootprints(context.features), [context.features]);
  const feature = selection.buildingId ? buildings.find((b) => b.id === selection.buildingId) ?? null : null;
  const registerQuery = useBuildingRegister(feature?.id);
  const register = registerQuery.data;
  const model = useMemo(() => (register ? buildingModel(register) : null), [register]);
  const level = model?.levels.find((l) => l.id === selection.levelId) ?? null;
  const space = selection.spaceId ? model?.spaceById.get(selection.spaceId) ?? null : null;
  const spaceWorkflow = useSpaceWorkflow(space?.id ?? null);
  const verticalReference = context.area.reference?.verticalReference ?? null;

  const detail = useMemo<BuildingDetailInput | null>(() => {
    if (!model || !feature) return null;
    const fill = selection.colourBy === 'rights' ? { color: undefined, hatch: true } : {};
    return {
      buildingId: feature.id,
      levels: model.levels.map((l) => ({
        id: l.id, order: l.order, lowerM: l.lower, upperM: l.upper,
        spaces: model.spaces.filter((s) => s.levelId === l.id && s.polygons.length).map((s) => ({ id: s.id, polygons: s.polygons, lowerM: s.lower, upperM: s.upper, fill })),
      })),
    };
  }, [model, feature, selection.colourBy]);

  const sceneState = useMemo<SceneState>(() => ({
    mode: selection.mode, buildingId: selection.buildingId, levelId: selection.levelId, spaceId: selection.spaceId,
    render: selection.render, view: selection.view, participants: register?.findings.flatMap((f) => f.featureIds) ?? [],
  }), [selection, register]);

  const onPick = useCallback((pick: Pick) => {
    if (pick.kind === 'building') dispatch({ type: 'pickBuilding', id: pick.id });
    else if (pick.kind === 'space') {
      const target = model?.spaceById.get(pick.id);
      dispatch({ type: 'pickSpace', id: target?.id ?? pick.id, levelId: pick.levelId });
    } else dispatch({ type: 'pickGround' });
  }, [dispatch, model]);

  // Escape unwinds one step (dialogs catch their own Escape first).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dialog) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT') return;
      dispatch({ type: 'escape' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, dialog]);

  useEffect(() => {
    if (!import.meta.env.DEV || !engine) return;
    const target = window as unknown as { __ulpinSceneStats?: () => unknown; __ulpinScene?: SceneEngine };
    target.__ulpinSceneStats = () => engine.stats();
    target.__ulpinScene = engine;
    return () => { delete target.__ulpinSceneStats; delete target.__ulpinScene; };
  }, [engine]);

  const onView = useCallback(() => setTick((t) => (t + 1) % 1_000_000), []);
  const snapshot = useCallback(() => engine?.snapshot() ?? null, [engine]);

  // Crumbs of the selection path (they replace the scope strip's crumbs, GOAL override 1).
  const crumbs: Crumb[] = [{ label: 'Area', onSelect: () => dispatch({ type: 'selectBuilding', id: null }) }];
  if (feature) crumbs.push({ label: feature.name, onSelect: selection.mode === 'area' ? undefined : () => dispatch({ type: 'exploreBuilding' }) });
  if (selection.mode === 'level' && level) crumbs.push({ label: level.label, onSelect: space ? () => dispatch({ type: 'selectSpace', id: null }) : undefined });
  if (selection.mode === 'findings') crumbs.push({ label: 'Findings' });
  if (selection.mode === 'underground') crumbs.push({ label: 'Underground' });

  const labels: SceneLabel[] = [];
  if (selection.mode === 'area' || selection.mode === 'building') {
    if (feature) labels.push({ id: feature.id, text: feature.name, kind: 'selected' });
    const hover = hovered && hovered !== feature?.id ? buildings.find((b) => b.id === hovered) : null;
    if (hover) labels.push({ id: hover.id, text: hover.name, kind: 'hover' });
  }
  if (selection.mode === 'level' && model) {
    for (const s of model.spaces) {
      if (s.levelId !== selection.levelId || !s.polygons.length) continue;
      const selectedHere = s.id === space?.id || s.parentId === space?.id;
      labels.push({ id: s.id, text: s.shortName, kind: s.id === space?.id ? 'space-selected' : selectedHere ? 'space-selected' : 'space' });
    }
  }
  if (selection.mode === 'underground') labels.push({ id: 'no-survey', text: 'No survey', kind: 'note' });

  const legend: LegendSection[] = [];
  if (selection.mode === 'level' && selection.colourBy === 'rights' && model) {
    const count = model.spaces.filter((s) => s.levelId === selection.levelId && s.polygons.length).length;
    legend.push({ title: 'Rights', items: [{ label: 'Unknown', count, hatch: true, color: 'var(--ui-readiness-unknown)' }] });
  }
  if (selection.mode === 'level') legend.push({ title: 'Evidence', items: [{ label: 'Height unknown: drawn flat', hatch: true, color: 'var(--ui-map-building)' }] });
  if (selection.mode === 'underground') legend.push({ title: 'Utilities', items: [{ label: 'No survey', hatch: true, color: 'var(--ui-readiness-unknown)' }] });

  const showRail = (selection.mode === 'building' || selection.mode === 'level') && Boolean(model?.levels.length);
  const noFloors = selection.mode === 'building' && register && !model?.levels.length;
  const namespaces = [...new Set(context.features.map((f) => f.datasetNamespace))];
  const reference = context.area.reference;
  const readoutTitle = reference
    ? `Horizontal: ${reference.analysisCrs} (source ${reference.sourceCrs}). Heights: ${reference.verticalReference}.`
    : 'No reference system: this area stays in its source’s local frame.';

  let inspector;
  if (selection.mode === 'underground' && feature) inspector = <UndergroundInspector />;
  else if (selection.mode === 'findings' && feature) inspector = <FindingsInspector register={register} crumbs={crumbs} />;
  else if (selection.mode === 'level' && space && model && register && feature) {
    inspector = (
      <SpaceInspector space={space} level={level} model={model} register={register} buildingId={feature.id} crumbs={crumbs}
        areaUnitStated={Boolean(reference)} onSelectSpace={(id) => dispatch({ type: 'selectSpace', id })}
        onAssign={() => setDialog('assign')} onCard={() => setDialog('card')} />
    );
  } else if (selection.mode === 'level' && level && model) {
    inspector = <LevelInspector level={level} model={model} crumbs={crumbs} verticalReference={verticalReference} onSelectSpace={(id) => dispatch({ type: 'selectSpace', id })} />;
  } else if (feature) {
    inspector = (
      <BuildingInspector feature={feature} register={register} model={model} registerPending={registerQuery.isPending} crumbs={crumbs}
        onExplore={() => {
          const first = model?.levels[0];
          if (first) dispatch({ type: 'selectLevel', id: first.id });
        }}
        onFindings={() => dispatch({ type: 'openFindings' })} />
    );
  } else inspector = <AreaInspector area={context.area} buildings={buildings} onSelect={(id) => dispatch({ type: 'selectBuilding', id })} />;

  return (
    <EvidenceProvider snapshot={snapshot}>
      <div className={`${styles.workspace} ${selection.panel ? styles.withPanel : ''}`}>
        {selection.panel === 'layers' ? (
          <LayersPanel
            colourBy={selection.colourBy}
            onColourBy={(colourBy) => patch({ colourBy })}
            onClose={() => patch({ panel: null })}
            baseLayers={[`${buildings.length} building footprints`]}
            canColourRights={selection.mode === 'level'}
          />
        ) : null}

        <section className={styles.canvasColumn} aria-label="Map">
          <div className={styles.canvasWrap}>
            <SceneView
              className={styles.canvas}
              buildings={footprints}
              detail={detail}
              state={sceneState}
              onPick={onPick}
              onHover={(pick) => setHovered(pick.kind === 'ground' ? null : pick.id)}
              onView={onView}
              onReady={setEngine}
              label={`3D map of ${context.area.name}. The inspector lists the same buildings and spaces.`}
            />
            <MapToolbar
              selection={selection}
              onLayers={() => patch({ panel: selection.panel ? null : 'layers' })}
              onSelectTool={() => { if (selection.mode === 'underground') dispatch({ type: 'leaveMode' }); }}
              onUnderground={() => dispatch(selection.mode === 'underground' ? { type: 'leaveMode' } : { type: 'openUnderground' })}
              onView={(view) => patch({ view })}
              onRender={(render) => patch({ render })}
              onReset={() => engine?.resetCamera()}
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
                  reference={verticalReference}
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
            <div className={styles.readout}><ScaleAndNorth engine={engine} tick={tick} title={readoutTitle} /></div>
            <p className={styles.attribution}>{namespaces.map((ns) => ATTRIBUTION[ns] ?? ns).join(' · ')}</p>
          </div>
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
