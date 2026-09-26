import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams, useSearchParams, Link } from 'react-router';
import { ArrowsOut, Cube, Cursor, FilePlus, MapTrifold, Square, WarningCircle } from '@phosphor-icons/react';
import { SceneView } from '@ulpin/scene/react';
import type { SceneEngine } from '@ulpin/scene';
import { Button, EmptyState, Icon } from '@ulpin/ui';
import { useAreaContext, useAreas, type AreaContext } from '../../api/queries';
import { readLastArea } from '../../app/lastArea';
import { toFootprints } from './footprints';
import { Inspector } from './Inspector';
import { ScaleAndNorth } from './ScaleAndNorth';
import styles from './MapPage.module.css';

/** /studio/map: open the last area, else the first area, else an honest Empty state. */
export function MapIndexRedirect() {
  const areas = useAreas();
  if (areas.isPending) return <div className={styles.loading} aria-busy="true">Loading areas</div>;
  if (areas.error) {
    return (
      <EmptyState icon={WarningCircle} title="Areas could not be loaded" action={<Button onClick={() => void areas.refetch()}>Try again</Button>}>
        {areas.error.message}
      </EmptyState>
    );
  }
  const last = readLastArea();
  const target = areas.data.find((area) => area.id === last) ?? areas.data[0];
  if (!target) {
    return (
      <div className={styles.emptyPage}>
        <EmptyState icon={MapTrifold} title="No areas yet" action={<Link to="/studio/add-files" className="ul-btn ul-btn--primary"><Icon icon={FilePlus} />Add files</Link>}>
          An area appears here once a GIS layer or survey is imported and committed.
        </EmptyState>
      </div>
    );
  }
  return <Navigate to={`/studio/areas/${target.id}`} replace />;
}

/** S4 Area map (GOAL overrides 2–4): canvas first, slim tools, one inspector. */
export function MapPage() {
  const { areaId } = useParams();
  const context = useAreaContext(areaId);

  if (context.isPending) return <div className={styles.loading} aria-busy="true">Loading area</div>;
  if (context.error || !context.data) {
    return (
      <div className={styles.emptyPage}>
        <EmptyState icon={WarningCircle} title="This area could not be opened" action={<Link to="/studio/work">Back to Batches</Link>}>
          {context.error?.message ?? 'The area was not found.'}
        </EmptyState>
      </div>
    );
  }
  return <AreaMap key={areaId} context={context.data} />;
}

function AreaMap({ context }: { context: AreaContext }) {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('feature');
  const [engine, setEngine] = useState<SceneEngine | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [preset, setPreset] = useState<'oblique' | 'plan'>('oblique');
  const [viewTick, setViewTick] = useState(0);
  const framed = useRef(false);

  const footprints = useMemo(() => toFootprints(context.features), [context.features]);
  const featuresById = useMemo(() => new Map(context.features.map((feature) => [feature.id, feature])), [context.features]);
  const selected = selectedId ? featuresById.get(selectedId) ?? null : null;

  const select = useCallback((id: string | null) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set('feature', id); else next.delete('feature');
      return next;
    }, { replace: false });
  }, [setParams]);

  // Frame the area once when it first opens (a user action), never when content streams in later.
  useEffect(() => {
    if (!engine || framed.current || !footprints.length) return;
    framed.current = true;
    engine.frame(selectedId ? [selectedId] : undefined);
  }, [engine, footprints, selectedId]);

  // Development measurement hook for frame time and memory (PLAN M3); not in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV || !engine) return;
    const target = window as unknown as { __ulpinSceneStats?: () => unknown };
    target.__ulpinSceneStats = () => engine.stats();
    return () => { delete target.__ulpinSceneStats; };
  }, [engine]);

  const onView = useCallback(() => setViewTick((tick) => (tick + 1) % 1_000_000), []);

  const reference = context.area.reference;
  const frameTitle = reference
    ? `Horizontal: ${reference.analysisCrs} (source ${reference.sourceCrs}). Heights: ${reference.verticalReference}.`
    : 'Reference system not recorded for this area.';

  return (
    <div className={styles.workspace}>
      <section className={styles.canvasWrap} aria-label="Map">
        <SceneView
          className={styles.canvas}
          footprints={footprints}
          selectedId={selectedId}
          onPick={select}
          onHover={setHoveredId}
          onView={onView}
          onReady={setEngine}
          label={`3D map of ${context.area.name}, ${footprints.length} buildings. Use the building list in the inspector as the non-visual alternative.`}
        />

        <div className={styles.toolbar}>
          <div className="ul-maptools" role="toolbar" aria-label="Map tools">
            <button type="button" className="ul-tool" aria-pressed="true" aria-label="Select" title="Select">
              <Icon icon={Cursor} />
            </button>
          </div>
          <div className="ul-maptools" role="toolbar" aria-label="View">
            <button
              type="button"
              className="ul-tool"
              aria-pressed={preset === 'oblique'}
              aria-label="3D view"
              title="3D view"
              onClick={() => { setPreset('oblique'); engine?.setPreset('oblique'); }}
            >
              <Icon icon={Cube} />
            </button>
            <button
              type="button"
              className="ul-tool"
              aria-pressed={preset === 'plan'}
              aria-label="Plan view"
              title="Plan view"
              onClick={() => { setPreset('plan'); engine?.setPreset('plan'); }}
            >
              <Icon icon={Square} />
            </button>
            <span className="ul-tool-sep" />
            <button type="button" className="ul-tool" aria-label="Frame the area" title="Frame the area" onClick={() => engine?.frame(undefined, preset)}>
              <Icon icon={ArrowsOut} />
            </button>
          </div>
        </div>

        <FeatureLabels engine={engine} ids={[selectedId, hoveredId]} featuresById={featuresById} tick={viewTick} />

        <div className={styles.readout}>
          <ScaleAndNorth engine={engine} tick={viewTick} title={frameTitle} />
        </div>
        <Attribution context={context} />
      </section>

      <Inspector
        area={context.area}
        feature={selected}
        buildings={context.features.filter((feature) => feature.kind === 'building')}
        onSelect={(id) => {
          select(id);
          if (id) engine?.frame([id], preset);
        }}
      />
    </div>
  );
}

/** Labels only for the selected and hovered buildings (GOAL override 3). */
function FeatureLabels({ engine, ids, featuresById, tick }: {
  engine: SceneEngine | null; ids: (string | null)[]; featuresById: Map<string, AreaContext['features'][number]>; tick: number;
}) {
  void tick;
  if (!engine) return null;
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  return (
    <>
      {unique.map((id) => {
        const position = engine.project(id);
        const feature = featuresById.get(id);
        if (!position?.visible || !feature) return null;
        return (
          <span key={id} className={styles.label} style={{ transform: `translate(${position.x}px, ${position.y}px)` }} aria-hidden="true">
            {feature.name}
          </span>
        );
      })}
    </>
  );
}

function Attribution({ context }: { context: AreaContext }) {
  const namespaces = [...new Set(context.features.map((feature) => feature.datasetNamespace))];
  const text = namespaces.map((ns) => ATTRIBUTION[ns] ?? ns).join(' · ');
  return <p className={styles.attribution}>{text}</p>;
}

/** Attribution lines for source datasets on screen; they never hide while the layer is visible. */
const ATTRIBUTION: Record<string, string> = {
  'nyc-building-footprints': 'City of New York Office of Technology and Innovation (OTI), BUILDING via NYC Open Data',
};
