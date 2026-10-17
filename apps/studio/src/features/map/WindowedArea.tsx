import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { X } from '@phosphor-icons/react';
import { SceneView } from '@ulpin/scene/react';
import type { Pick, SceneEngine, SceneState } from '@ulpin/scene';
import { Banner, DescriptionList, Icon } from '@ulpin/ui';
import { useAreas, type AreaWindowFeature } from '../../api/queries';
import { useSelection } from '../../state/useSelection';
import { CopyableId } from '../identity/CopyableId';
import { WINDOW_EMPTY, useAreaWindow } from './areaWindow';
import { InspectorShell } from './inspector/InspectorShell';
import { ScaleAndNorth } from './ScaleAndNorth';
import { useMapView } from './useMapView';
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
  const [tick, setTick] = useState(0);
  const { selection, dispatch } = useSelection();
  const [mapView] = useMapView();
  const windowed = useAreaWindow(areaId, engine, true);
  const selected = windowed.features.find((feature) => feature.id === selection.buildingId) ?? null;
  const sceneState = useMemo<SceneState>(() => ({
    mode: 'area', buildingId: selected?.id ?? null, levelId: null, spaceId: null, tool: 'select', finding: null,
  }), [selected]);
  const { onView: readView } = windowed;
  const onView = useCallback(() => { setTick((t) => (t + 1) % 1_000_000); readView(); }, [readView]);
  const readoutTitle = reference
    ? `Horizontal: ${reference.analysisCrs} (source ${reference.sourceCrs}). Heights: ${reference.verticalReference}.`
    : '';
  const onPick = useCallback((pick: Pick) => {
    if (pick.kind === 'building') dispatch({ type: 'pickBuilding', id: pick.id, levelId: pick.levelId });
    else dispatch({ type: 'pickGround' });
  }, [dispatch]);

  return (
    <div className={styles.workspace}>
      <section className={styles.canvasColumn} aria-label="Map">
        <div className={styles.canvasWrap}>
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
            label={`3D map of ${name}, drawn by the part in view.`}
          />
          {windowed.error ? (
            <div className={styles.banner}>
              <Banner tone="danger">The buildings in view could not be read. {windowed.error.message}</Banner>
            </div>
          ) : null}
          {windowed.empty ? <WindowEmpty /> : null}
          {windowed.line ? (
            <div className={styles.leftStack}>
              <span />
              <p className={styles.viewNote} role="status">{windowed.line}</p>
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
              <ScaleAndNorth engine={engine} tick={tick} title={readoutTitle} prefix={reference?.sourceCrs} />
            </div>
          )}
        </div>
      </section>
    </div>
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

/** A picked footprint: the identifier and kind the window states, and a building's register by its id. */
export function WindowedInspector({ feature, areaName, onClose }: {
  feature: AreaWindowFeature; areaName: string; onClose: () => void;
}) {
  const register = feature.kind === 'building'
    ? <Link to={`/studio/properties/${feature.id}/register`} className="ul-btn ul-btn--primary">Open register</Link>
    : undefined;
  return (
    <InspectorShell title={KIND_LABEL[feature.kind] ?? feature.kind} rekey={feature.id}
      crumbs={[{ label: areaName, onSelect: onClose }]} actions={register}>
      <DescriptionList items={[
        { label: 'Identifier', value: <CopyableId id={feature.identifier} name="identifier" /> },
      ]} />
      <p>This area is drawn by the part in view, so only the identifier and kind are shown here.</p>
    </InspectorShell>
  );
}
