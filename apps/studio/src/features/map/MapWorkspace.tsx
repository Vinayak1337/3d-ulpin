import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { FilePlus, SlidersHorizontal, Trash, X } from '@phosphor-icons/react';
import { SceneView } from '@ulpin/scene/react';
import type { OverlayInput, FindingInput, Pick, SceneEngine, SceneState, Trench } from '@ulpin/scene';
import { Banner, Button, Icon, LevelRail, SeverityBadge, Toast, type LegendSection } from '@ulpin/ui';
import { useBuildingCanonical, useBuildingImport, useBuildingLedger, useBuildingRegister, type AreaContext } from '../../api/queries';
import { buildingModel } from '../../model/building';
import { effectiveColour } from '../../state/selection';
import { useSelection } from '../../state/useSelection';
import { EvidenceProvider } from '../evidence/EvidenceContext';
import { AssignDialog } from '../identity/AssignDialog';
import { DRAFT_ON_THIS_DEVICE } from '../identity/draft';
import { AddFilesDialog } from '../intake/AddFilesDialog';
import { DeleteDialog } from '../manage/DeleteDialog';
import { UnitCardDialog } from '../identity/UnitCardDialog';
import { useSpaceWorkflow } from '../workflow/useWorkflow';
import { polygonsOf, undrawnNote } from './footprints';
import { useCanonicalFootprints } from './canonicalScene';
import { findingVolume, useBuildingScene } from './useBuildingScene';
import { PlanCheck, type MapPlanCheck } from './PlanCheck';
import { isDemoId } from '../../api/demo-import';
import { isServed } from '../../local/routes';
import { MapSidebar, type ViewKey } from './MapSidebar';
import { BuildingImportTray, ImportTray } from './ImportTray';
import { ScaleAndNorth } from './ScaleAndNorth';
import { UndrawnBuildings } from './UndrawnBuildings';
import { BuildingSearch } from './BuildingSearch';
import { CandidateBanner } from '../review/candidates/CandidateBanner';
import { imageryVisibility, useMapView } from './useMapView';
import {
  imageryAttribution, imageryFailureNote, listedImages, useOverlays, useRetainedImagery,
  type AreaReference, type SupplementalDataset, type LoadedOverlay, type RetainedImages,
} from './overlays';
import { noFloorsState } from './floorState';
import { HEIGHT_BANDS, heightCounts } from './heightBands';
import { SceneLabels } from './SceneLabels';
import type { SceneLabel } from './labels';
import { RIGHTS_LABEL, RIGHTS_TOKEN, ledgerSpace } from './ledger';
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
const shownQuarantine = new Set<string>();
const WIDE_WINDOW = '(min-width: 1000px)';

/**
 * S4–S6, S8: one canvas whose modes (area, building, level, findings, underground) share one selection,
 * one inspector and one left navigation. The URL holds the selection.
 */
const NO_LOADED_OVERLAYS: LoadedOverlay[] = [];
const NO_IMAGES: RetainedImages['overlays'] = [];
const canDeleteBuilding = isServed('DELETE', '/api/v1/buildings/:buildingId');
const canDeleteArea = isServed('DELETE', '/api/v1/areas/:areaId');

export function MapWorkspace({ context }: { context: AreaContext }) {
  context = { ...context, features: context.displayFeatures ?? context.features };
  const { selection, dispatch, patch } = useSelection();
  const [searchParams, setSearchParams] = useSearchParams();
  const packageId = searchParams.get('package');
  const buildingImportId = searchParams.get('building-import');
  const buildingImport = useBuildingImport(buildingImportId);
  const floorsLive = Boolean(buildingImportId) && buildingImport.data?.state !== 'done';
  const client = useQueryClient();
  // Polling stops when the import reports done; read the building once more so the last levels show.
  useEffect(() => {
    if (buildingImport.data?.state === 'done') void client.invalidateQueries({ queryKey: ['buildings', buildingImport.data.buildingId] });
  }, [buildingImport.data?.state, buildingImport.data?.buildingId, client]);
  const [engine, setEngine] = useState<SceneEngine | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<'assign' | 'card' | 'files' | 'delete-building' | 'delete-area' | null>(null);
  const navigate = useNavigate();
  const [toast, setToast] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trench, setTrench] = useState<Trench | null>(null);
  const [focusSearch, setFocusSearch] = useState(false);
  // An overlay just switched on is brought into view once the scene has it.
  const [focusOverlay, setFocusOverlay] = useState<string | null>(null);
  const [planResult, setPlanResult] = useState<MapPlanCheck | null>(null);
  const activePlan = planResult?.areaId === context.area.id ? planResult : null;

  useEffect(() => {
    const pkg = packageId ? context.packages.find((p) => p.id === packageId) : context.packages.find((p) => p.quarantine);
    if (!pkg?.quarantine) return;
    const key = `gis-quarantine:${pkg.id}:${pkg.quarantine.sourceSha256}`;
    if (shownQuarantine.has(key)) return;
    shownQuarantine.add(key);
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, 'shown');
    } catch { /* The in-memory guard still prevents repeated notices. */ }
    setNotice(pkg.quarantine.message);
  }, [context.packages, packageId]);

  const buildings = useMemo(() => context.features.filter((f) => f.kind === 'building'), [context.features]);
  const utilities = useMemo(() => context.features.filter((f) => f.kind === 'utility'), [context.features]);
  const feature = selection.buildingId ? buildings.find((b) => b.id === selection.buildingId) ?? null : null;
  const registerQuery = useBuildingRegister(feature?.id, floorsLive);
  const register = registerQuery.data;
  const ledger = useBuildingLedger(feature?.id, floorsLive).data;
  const canonical = useBuildingCanonical(feature?.id).data;
  const model = useMemo(() => (register ? buildingModel(register) : null), [register]);
  const level = model?.levels.find((l) => l.id === selection.levelId) ?? null;
  const space = selection.spaceId ? model?.spaceById.get(selection.spaceId) ?? null : null;
  const spaceWorkflow = useSpaceWorkflow(space?.id ?? null);
  const reference = context.area.reference;
  const groundM = ledger?.groundElevationM ?? null;
  const colour = effectiveColour(selection);
  const findings = register?.findings ?? [];
  const finding = selection.mode === 'findings' ? findings.find((f) => f.id === selection.findingId) ?? findings[0] ?? null : null;

  const drawn = useCanonicalFootprints(context.area.id, feature?.id, context.features, Boolean(packageId));
  const { base, footprints, detail } = useBuildingScene(context.features, feature, model, ledger, colour, drawn.footprints);
  const [mapView, setMapView] = useMapView();
  const drawnIds = useMemo(() => new Set(footprints.map((f) => f.id)), [footprints]);
  const baseKinds = useMemo(() => new Set(base.map((f) => f.kind)), [base]);
  const supplemental = (context as unknown as { supplementalDatasets?: SupplementalDataset[] }).supplementalDatasets;
  const overlayQuery = useOverlays(context.area.id, supplemental, context.area.reference as AreaReference | null);
  const loadedOverlays = overlayQuery.data?.overlays ?? NO_LOADED_OVERLAYS;
  // The pictures the area's canonical read lists: on until the viewer turns imagery off.
  const listedPictures = useMemo(() => listedImages(drawn.area), [drawn.area]);
  const retained = useRetainedImagery(context.area.id, listedPictures);
  const retainedImages = retained.data?.overlays ?? NO_IMAGES;
  const imagery = imageryVisibility(mapView.overlays.imagery, listedPictures.length > 0);
  const overlaysOn = { imagery: imagery.retained, lidar: mapView.overlays.lidar };
  const supplementalOn = { imagery: imagery.aerial, lidar: mapView.overlays.lidar };
  // Nothing to scale or fit: no footprint, base feature or overlay, and every read has settled.
  const nothingToDraw = !footprints.length && !base.length && !loadedOverlays.length && !retainedImages.length
    && !drawn.pending && !drawn.error && !overlayQuery.isLoading && !retained.isLoading && !packageId
    && !buildingImportId;
  // On a wide window the tools open on the list of buildings without geometry, so a record that is not drawn is
  // still seen; a narrow one keeps the canvas clear and names the list instead.
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    if (drawn.undrawn.length && window.matchMedia(WIDE_WINDOW).matches) setToolsOpen(true);
  }, [drawn.undrawn.length]);
  const showContextOverlays = (selection.mode === 'area' || selection.mode === 'building');
  const retainedShown = showContextOverlays && overlaysOn.imagery && retainedImages.length > 0;
  const overlayInputs = useMemo<OverlayInput[]>(() => [
    ...(retainedShown ? retainedImages : []),
    ...loadedOverlays.filter((o) => showContextOverlays && supplementalOn[o.layer]).map((o) => o.input),
    ...(activePlan && showContextOverlays ? [
      { id: 'simulated-area-plan', kind: 'comparison' as const, role: 'plan' as const, polygons: activePlan.plan, heightM: 0 },
      ...activePlan.findings.map(f => ({ id: `simulated-difference:${f.buildingId}`, kind: 'comparison' as const, role: 'conflict' as const, polygons: f.outside, heightM: f.heightM })),
    ] : []),
  ], [retainedShown, retainedImages, loadedOverlays, supplementalOn.imagery, supplementalOn.lidar,
    showContextOverlays, activePlan]);
  const visibleOverlays = loadedOverlays.filter((o) => showContextOverlays && supplementalOn[o.layer]);
  const overlayNotes = visibleOverlays.map((o) => o.note);
  const viewNotes = [
    mapView.look === 'enhanced' ? 'Enhanced view' : null,
    ...visibleOverlays.map((o) => o.caption),
    ...(retainedShown ? imageryAttribution(drawn.area?.imagery ?? []) : []),
    undrawnNote(context.features),
    ...(overlayQuery.data?.warnings ?? []),
  ].filter(Boolean);
  // A listed picture that did not load is named by count beside the switch, never silently missing.
  const picturesNotLoaded = (retained.data ? imageryFailureNote(retained.data) : null) ?? undefined;
  const layerSwitches = [
    { key: 'look', label: 'Enhanced view', checked: mapView.look === 'enhanced' },
    ...(baseKinds.has('road') ? [{ key: 'roads', label: 'Roads', checked: mapView.layers.roads }] : []),
    ...(baseKinds.has('public_land') || baseKinds.has('water') ? [{ key: 'publicLand', label: 'Public land', checked: mapView.layers.publicLand }] : []),
    ...(baseKinds.has('public_land') ? [{ key: 'trees', label: 'Trees', checked: mapView.layers.trees, disabled: mapView.look !== 'enhanced' || !mapView.layers.publicLand }] : []),
    ...(baseKinds.has('parcel') ? [{ key: 'parcels', label: 'Parcels', checked: mapView.layers.parcels }] : []),
    ...(base.some((f) => f.name) ? [{ key: 'labels', label: 'Names', checked: mapView.labels }] : []),
    ...loadedOverlays.map((o) => ({
      key: `overlay:${o.layer}`, label: o.label, checked: overlaysOn[o.layer],
      hint: o.layer === 'imagery' ? picturesNotLoaded : undefined,
    })),
    ...(listedPictures.length && !loadedOverlays.some((o) => o.layer === 'imagery') ? [{
      key: 'overlay:imagery', label: 'Imagery', checked: overlaysOn.imagery, hint: picturesNotLoaded,
    }] : []),
  ];
  useEffect(() => {
    if (!engine || !focusOverlay || !overlayInputs.some((o) => o.id === focusOverlay)) return;
    engine.focusOverlay(focusOverlay);
    setFocusOverlay(null);
  }, [engine, focusOverlay, overlayInputs]);
  const onLayer = (key: string, on: boolean) => {
    if (key === 'look') setMapView({ look: on ? 'enhanced' : 'plain' });
    else if (key === 'labels') setMapView({ labels: on });
    else if (key.startsWith('overlay:')) {
      setMapView({ overlays: { ...mapView.overlays, [key.slice(8)]: on } });
      if (on) setFocusOverlay(loadedOverlays.find((o) => o.layer === key.slice(8))?.input.id ?? null);
    }
    else setMapView({ layers: { ...mapView.layers, [key]: on } });
  };

  const findingInput = useMemo<FindingInput | null>(() => (finding ? findingVolume(finding, groundM) : null), [finding, groundM]);

  const sceneState = useMemo<SceneState>(() => ({
    mode: selection.mode, buildingId: selection.buildingId, levelId: selection.levelId, spaceId: selection.spaceId,
    tool: 'select', finding: findingInput,
  }), [selection, findingInput]);

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

  // Escape unwinds the selection one step (dialogs catch their own Escape).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dialog) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') return;
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

  // While an area import streams, the view pulls back to keep every arriving building in frame.
  const buildingCount = buildings.length;
  useEffect(() => {
    if (packageId && engine && buildingCount && selection.mode === 'area' && !selection.buildingId) engine.resetCamera();
  }, [packageId, engine, buildingCount, selection.mode, selection.buildingId]);

  const onView = useCallback(() => setTick((t) => (t + 1) % 1_000_000), []);
  const snapshot = useCallback(() => engine?.snapshot() ?? null, [engine]);
  const chooseColour = (c: Exclude<typeof colour, never>) => {
    patch({ colourBy: c });
    if (c === 'rights' && selection.mode !== 'level') { const f = typicalFloor(); if (f) dispatch({ type: 'selectLevel', id: f.id }); }
    if (c === 'utilities' && feature && selection.mode !== 'underground') dispatch({ type: 'openUnderground' });
  };
  const chooseView = (key: ViewKey) => {
    if (key === 'area') dispatch({ type: 'selectBuilding', id: null });
    else if (key === 'building') dispatch({ type: 'exploreBuilding' });
    else if (key === 'level') { const f = level ?? typicalFloor(); if (f) dispatch({ type: 'selectLevel', id: f.id }); }
    else if (key === 'findings') dispatch({ type: 'openFindings', findingId: null });
    else dispatch({ type: 'openUnderground' });
  };
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
    if (mapView.labels) {
      for (const f of base) {
        if (!f.name || (f.kind === 'road' && !mapView.layers.roads) || (f.kind !== 'road' && !mapView.layers.publicLand)) continue;
        labels.unshift({ id: `name:${f.id}`, text: f.name, kind: 'street' });
      }
    }
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

  // Legend: only the active Colour by, plus the evidence key on a floor.
  const legend: LegendSection[] = [];
  if (colour === 'height') {
    const { counts, unknown } = heightCounts(buildings.filter((b) => drawnIds.has(b.id)));
    legend.push({ title: 'Roof height', items: [
      ...HEIGHT_BANDS.map((b, i) => ({ label: b.label, count: counts[i], color: b.color })).filter((item) => item.count),
      ...(unknown ? [{ label: 'Unknown', count: unknown, color: 'var(--ui-map-building)', hatch: true }] : []),
    ] });
  }
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
  const noFloors = selection.mode === 'building' && register && !model?.levels.length
    ? noFloorsState(register, canonical) : null;
  const namespaces = [...new Set(context.features.map((f) => f.datasetNamespace))].filter((ns) => ATTRIBUTION[ns]);
  const readout = [reference?.sourceCrs, groundM !== null ? `${groundM.toFixed(2)} m` : null, ledger?.siteDatum].filter(Boolean).join(' · ');
  const readoutTitle = reference
    ? `Horizontal: ${reference.analysisCrs} (source ${reference.sourceCrs}). Heights: ${reference.verticalReference}.`
    : 'No reference system: this area stays in its source’s local frame.';
  const hint = selection.mode === 'underground' && !trench?.ring ? (trench?.points.length === 1 ? 'Click the other end of the trench' : 'Click two points on the ground to draw a trench')
    : selection.mode === 'area' && !feature ? null
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
      <BuildingInspector feature={feature} canonical={canonical} register={register} model={model} ledger={ledger} registerPending={registerQuery.isPending} crumbs={crumbs}
        exploring={selection.mode === 'level'} onAddFiles={() => setDialog('files')} onDelete={canDeleteBuilding ? () => setDialog('delete-building') : undefined}
        onExplore={() => { const f = typicalFloor(); if (f) dispatch({ type: 'selectLevel', id: f.id }); }}
        onFindings={(findingId) => dispatch({ type: 'openFindings', findingId: findingId ?? null })} />
    );
  } else inspector = null;

  const closeParam = (key: string) => setSearchParams((p) => { const n = new URLSearchParams(p); n.delete(key); return n; }, { replace: true });
  const tray = packageId ? <ImportTray packageId={packageId} onClose={() => closeParam('package')} />
    : buildingImportId ? <BuildingImportTray importId={buildingImportId} onClose={() => closeParam('building-import')} /> : selection.mode === 'findings' && findings.length ? (
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
        <section className={`${styles.canvasColumn} ${tray ? styles.withTray : ''}`} aria-label="Map">
          <div className={styles.canvasWrap}>
            <SceneView
              className={styles.canvas}
              base={base}
              buildings={footprints}
              detail={detail}
              state={sceneState}
              growNew={Boolean(packageId)}
              onPick={onPick}
              onHover={(pick) => setHovered(pick.kind === 'ground' ? null : pick.id)}
              onView={onView}
              onTrench={setTrench}
              onReady={setEngine}
              look={mapView.look}
              flat={false}
              layers={mapView.layers}
              overlays={overlayInputs}
              label={`3D map of ${context.area.name}. Search offers the same buildings; selected details open in the inspector.`}
            />
            {!reference ? (
              <div className={styles.banner}>
                <Banner tone="info">This area stays in its source’s local frame: the source states no coordinate reference system, so it is not placed on the map.</Banner>
              </div>
            ) : null}
            <CandidateBanner className={styles.banner} areaId={context.area.id} buildingId={feature?.id ?? null} />
            {drawn.error ? (
              <div className={styles.banner}>
                <Banner tone="danger">The canonical record of this area could not be read, so its buildings are not drawn. {drawn.error.message}</Banner>
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
            {nothingToDraw ? (
              <div className={styles.noGeometry}>
                <div className={`ul-float ${styles.emptyCard}`}>
                  <span>No geometry is recorded for this area yet</span>
                  {drawn.undrawn.length && !toolsOpen ? (
                    <span>Buildings recorded without geometry are listed under Tools.</span>
                  ) : null}
                </div>
              </div>
            ) : null}
            {noFloors ? (
              <div className={styles.emptyOverlay}>
                <div className={`ul-float ${styles.emptyCard}`}>
                  {noFloors.lines.map((line) => <span key={line}>{line}</span>)}
                  {noFloors.advise ? (
                    <Button variant="primary" icon={FilePlus} onClick={() => setDialog('files')}>Add files</Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <SceneLabels engine={engine} labels={labels} tick={tick} />
            <div className={styles.leftStack}>
              <details
                className={styles.mapTools}
                open={toolsOpen}
                onToggle={(event) => setToolsOpen(event.currentTarget.open)}
              >
                <summary><Icon icon={SlidersHorizontal} size={20} />Tools</summary>
                <MapSidebar
                  undrawn={<UndrawnBuildings buildings={drawn.undrawn} />}
                  planCheck={isDemoId(context.area.id) ? <PlanCheck key={context.area.id} areaId={context.area.id} result={activePlan} onResult={(result) => { setPlanResult(result); if (result) dispatch({ type: 'selectBuilding', id: null }); }} /> : undefined}
                  views={[
                    { key: 'area', label: 'Area' },
                    { key: 'building', label: 'Building', disabled: !feature },
                    { key: 'level', label: 'Floors', disabled: !model?.levels.length },
                    { key: 'findings', label: 'Findings', disabled: !feature, badge: findings.length ? <span className={`ul-badge ${findings.some((f) => f.category === 'blocking') ? 'ul-badge--danger' : 'ul-badge--warning'}`}>{findings.length}</span> : null },
                    { key: 'underground', label: 'Underground', detail: feature && !utilities.length ? 'No survey' : null, disabled: !feature },
                  ]}
                  active={selection.mode === 'area' ? (feature ? 'building' : 'area') : selection.mode}
                  onView={chooseView}
                  keySections={legend}
                  layers={layerSwitches} onLayer={onLayer}
                  layersNote={[mapView.look === 'enhanced' ? 'Illustrative styling. Geometry and records unchanged.' : null, ...overlayNotes].filter(Boolean).join(' ') || null}
                  colour={colour} onColour={chooseColour}
                  colourOptions={[
                    { value: 'none', label: 'None' },
                    { value: 'rights', label: 'Rights', disabled: !model?.levels.length },
                    { value: 'utilities', label: 'Utilities', disabled: !utilities.length || !feature },
                    { value: 'height', label: 'Height', disabled: !footprints.length },
                  ]}
                  floor={selection.mode === 'level' && level ? level.label : null}
                  spaces={selection.mode === 'level' && model ? model.spaces.filter((s) => s.levelId === selection.levelId && !s.parentId) : []}
                  rightsColour={(id) => (colour === 'rights' ? `var(${RIGHTS_TOKEN[ledgerSpace(ledger, id)?.rights ?? 'unknown']})` : null)}
                  selectedSpaceId={selection.spaceId}
                  onSelectSpace={(s) => s.levelId && dispatch({ type: 'pickSpace', id: s.id, levelId: s.levelId })}
                  viewFooter={<>
                    <p className={styles.gestures}>Drag to move. Two-finger swipe or right-drag to rotate. Pinch or scroll to zoom.</p>
                    {!feature && canDeleteArea ? <Button variant="ghost" icon={Trash} className={styles.deleteArea} onClick={() => setDialog('delete-area')}>Delete area</Button> : null}
                  </>}
                />
              </details>
              {viewNotes.length ? (
                <p className={styles.viewNote}>{viewNotes.map((note, i) => <span key={i}>{note}</span>)}</p>
              ) : null}
            </div>
            {feature ? (
              <div className={styles.inspectorColumn} key={feature.id}>
                <button type="button" className={styles.closeInspector} aria-label="Close building details" onClick={() => {
                  setFocusSearch(true); dispatch({ type: 'selectBuilding', id: null });
                }}><Icon icon={X} size={20} /></button>
                {inspector}
              </div>
            ) : (
              <div className={styles.searchPosition}>
                <BuildingSearch buildings={buildings} areaId={context.area.id} autoFocus={focusSearch} onSelect={(id, areaId) => {
                  setFocusSearch(false);
                  if (areaId === context.area.id) dispatch({ type: 'selectBuilding', id });
                  else navigate(`/studio/areas/${encodeURIComponent(areaId)}?feature=${encodeURIComponent(id)}`);
                }} />
              </div>
            )}
            {hint ? <div className={styles.hint} key={hint}>{hint}</div> : null}
            {nothingToDraw ? null : (
              <div className={styles.readout}>
                <ScaleAndNorth engine={engine} tick={tick} title={readoutTitle} prefix={readout} />
              </div>
            )}
            {namespaces.length ? <p className={styles.attribution}>{namespaces.map((ns) => ATTRIBUTION[ns]).join(' · ')}</p> : null}
          </div>
          {tray ? <div className={styles.tray}>{tray}</div> : null}
        </section>

      </div>

      {dialog === 'files' && feature ? <AddFilesDialog buildingId={feature.id} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete-building' && feature ? (
        <DeleteDialog target={{ kind: 'building', id: feature.id, name: feature.name, detail: `${feature.name} and its register (floors, units, findings and history) are deleted from ${context.area.name}.` }}
          onClose={() => setDialog(null)} onDeleted={() => { setDialog(null); dispatch({ type: 'selectBuilding', id: null }); setNotice(`${feature.name} deleted`); }} />
      ) : null}
      {dialog === 'delete-area' ? (
        <DeleteDialog target={{ kind: 'area', id: context.area.id, name: context.area.name, detail: `${context.area.name} and its ${buildings.length} buildings, parcels, roads and utilities are deleted, with every building register in it.` }}
          onClose={() => setDialog(null)} onDeleted={() => navigate('/studio/map', { replace: true })} />
      ) : null}
      {dialog === 'assign' && space && register ? (
        <AssignDialog space={space} register={register} onClose={() => setDialog(null)} onAssigned={(code) => { setDialog(null); setToast(code); }} />
      ) : null}
      {dialog === 'card' && space && feature ? (
        <UnitCardDialog buildingId={feature.id} workflow={spaceWorkflow.data} space={space} level={level}
          buildingName={feature.name} onClose={() => setDialog(null)} />
      ) : null}
      {toast ? (
        <Toast onDone={() => setToast(null)}>
          <span className="ul-body-sm">{DRAFT_ON_THIS_DEVICE}</span>
          <span className="ul-id">{toast.slice(0, 7)}…{toast.slice(-3)}</span>
          <button type="button" className="ul-btn ul-btn--soft" onClick={() => { setToast(null); setDialog('card'); }}>Make Property Card</button>
        </Toast>
      ) : null}
      {notice ? <Toast onDone={() => setNotice(null)}>{notice}</Toast> : null}
    </EvidenceProvider>
  );
}
