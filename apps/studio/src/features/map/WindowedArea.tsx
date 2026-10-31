import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router';
import { X } from '@phosphor-icons/react';
import { SceneView } from '@ulpin/scene/react';
import type { Pick, SceneEngine, SceneState } from '@ulpin/scene';
import { Banner, DescriptionList, Icon, Legend } from '@ulpin/ui';
import { useAreas, type AreaWindowFeature } from '../../api/queries';
import { useSelection } from '../../state/useSelection';
import { CopyableId } from '../identity/CopyableId';
import { WINDOW_EMPTY, useAreaWindow } from './areaWindow';
import { BuildingCard } from './inspector/BuildingCard';
import { InspectorShell } from './inspector/InspectorShell';
import { RecordState } from './RecordState';
import { ScaleAndNorth } from './ScaleAndNorth';
import { createViewFrames } from './viewFrames';
import { useMapView } from './useMapView';
import { SurfaceKey } from './surface/SurfaceKey';
import { useSurfaceLayer } from './surface/useSurfaceLayer';
import { PreviewKey } from './preview/PreviewKey';
import { useReadPreview } from './preview/useReadPreview';
import styles from './MapWorkspace.module.css';

const KIND_LABEL: Record<string, string> = {
  building: 'Building', parcel: 'Parcel', road: 'Road', public_land: 'Public land', utility: 'Utility',
};

/**
 * An area with more features than one display read carries: the map draws the features of the camera's view,
 * read by window. A selected footprint shows the identifier and kind the window states; a building links to its
 * register.
 */
export function WindowedArea({ areaId }: { areaId: string }) {
  const area = useAreas().data?.find((item) => item.id === areaId);
  const name = area?.name ?? 'This area';
  const reference = area?.reference;
  const [engine, setEngine] = useState<SceneEngine | null>(null);
  const [frames] = useState(createViewFrames);
  const { selection, dispatch } = useSelection();
  const [mapView] = useMapView();
  const [params] = useSearchParams();
  const packageId = params.get('package');
  const windowed = useAreaWindow(areaId, engine, true, packageId);
  const packageIds = useMemo(() => new Set(windowed.features
    .filter(feature => feature.packageId === packageId).map(feature => feature.id)), [windowed.features, packageId]);
  const drawnSnapshot = useCallback(() => {
    const drawn = engine?.drawnBuildings();
    return [...packageIds].some(id => drawn?.has(id));
  }, [engine, packageIds]);
  const packageDrawn = useSyncExternalStore(frames.subscribe, drawnSnapshot, drawnSnapshot);
  useEffect(() => { engine?.setImportFocus(packageId, packageIds); }, [engine, packageId, packageIds]);
  const surface = useSurfaceLayer(area, engine, params.get('case'));
  const preview = useReadPreview(surface.items, engine, reference);
  const selected = windowed.features.find((feature) => feature.id === selection.buildingId) ?? null;
  const sceneState = useMemo<SceneState>(() => ({
    mode: 'area', buildingId: selected?.id ?? null, levelId: null, spaceId: null, tool: 'select', finding: null,
  }), [selected]);
  const { onView: readView } = windowed;
  const onView = useCallback(() => { frames.emit(); readView(); }, [frames, readView]);
  const readoutTitle = reference
    ? `Horizontal: ${reference.analysisCrs} (source ${reference.sourceCrs}). Heights: ${reference.verticalReference}.`
    : undefined;
  const onPick = useCallback((pick: Pick) => {
    if (pick.kind === 'building') dispatch({ type: 'pickBuilding', id: pick.id, levelId: pick.levelId });
    else dispatch({ type: 'pickGround' });
  }, [dispatch]);

  return (
    <div className={styles.workspace}>
      <section className={styles.canvasColumn} aria-label="Map">
        <div className={styles.canvasWrap} data-drawn-packages={packageDrawn ? packageId : undefined}
          data-drawn-items={surface.drawn || undefined}>
          <SceneView
            className={styles.canvas}
            base={windowed.base}
            buildings={windowed.footprints}
            detail={null}
            state={sceneState}
            onPick={onPick}
            onView={onView}
            onReady={setEngine}
            look={mapView.look}
            flat={false}
            layers={mapView.layers}
            label={`3D map of ${name}`}
          />
          {windowed.error ? (
            <div className={styles.banner}>
              <Banner tone="danger">The buildings in view could not be read. {windowed.error.message}</Banner>
            </div>
          ) : null}
          {windowed.empty ? <WindowEmpty /> : null}
          {windowed.line || surface.lines.length || preview.length ? (
            <div className={styles.leftStack}>
              {windowed.line ? <WindowKey /> : null}
              <SurfaceKey className={styles.mapTools} lines={surface.lines} onShow={surface.show} />
              <PreviewKey className={styles.mapTools} lines={preview} />
              {windowed.line ? <p className={styles.viewNote} role="status">{windowed.line}</p> : null}
            </div>
          ) : null}
          {selected ? (
            <div className={styles.inspectorColumn} key={selected.id}>
              <button type="button" className={styles.closeInspector} aria-label="Close feature details"
                onClick={() => dispatch({ type: 'selectBuilding', id: null })}><Icon icon={X} size={20} /></button>
              <WindowedInspector feature={selected} areaName={name}
                onClose={() => dispatch({ type: 'selectBuilding', id: null })} />
            </div>
          ) : null}
          {windowed.empty ? null : (
            <div className={styles.readout}>
              <ScaleAndNorth engine={engine} frames={frames} title={readoutTitle} prefix={reference?.sourceCrs} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** What the two ways of drawing a building mean, in a disclosure the keyboard reaches. */
export function WindowKey() {
  return (
    <details className={styles.mapTools} open>
      <summary>Key</summary>
      <Legend sections={[{ title: 'Buildings', items: [
        { label: 'Recorded', color: 'var(--ui-map-building)' },
        { label: 'Candidate', color: 'color-mix(in srgb, var(--ui-map-building-edge) 18%, transparent)' },
      ] }]} />
    </details>
  );
}

/** Where the map would be: the area's summary holds nothing to draw. */
export function WindowEmpty() {
  return (
    <div className={styles.noGeometry}>
      <div className={`ul-float ${styles.emptyCard}`}><span>{WINDOW_EMPTY}</span></div>
    </div>
  );
}

/** A picked footprint: the identifier and kind the window states, and a building's register by its id. A proposal
 * is a candidate and links the batch of the case the window names for it, where its one officer confirmation is made.
 * A building an intake target names gets its property card section;
 * a proposal's target is read in the package the window names, a recorded building's in the packages that
 * recorded it. */
export function WindowedInspector({ feature, areaName, onClose }: {
  feature: AreaWindowFeature; areaName: string; onClose: () => void;
}) {
  const proposal = feature.displayState === 'unrecorded_proposal';
  const register = feature.kind === 'building'
    ? <Link to={`/studio/properties/${feature.id}/register`} className="ul-btn ul-btn--primary">Open register</Link>
    : null;
  const batch = proposal && feature.caseId
    ? <Link to={`/studio/work/cases/${feature.caseId}/intake`} className="ul-btn">Open batch to confirm</Link> : null;
  return (
    <InspectorShell title={KIND_LABEL[feature.kind] ?? feature.kind} rekey={feature.id}
      status={proposal ? <RecordState state="candidate" /> : undefined}
      crumbs={[{ label: areaName, onSelect: onClose }]} actions={register || batch ? <>{register}{batch}</> : undefined}>
      <DescriptionList items={[
        { label: 'Identifier', value: <CopyableId id={feature.identifier} name="identifier" /> },
      ]} />
      {feature.kind === 'building' ? <BuildingCard featureId={feature.id} packageId={feature.packageId}
        name={feature.identifier} /> : null}
    </InspectorShell>
  );
}
