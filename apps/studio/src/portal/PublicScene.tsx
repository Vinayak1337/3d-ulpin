import { useMemo } from 'react';
import { SceneView } from '@ulpin/scene/react';
import type { BuildingDetailInput, MultiPolygon, Pick, SceneEngine, SceneState, StoreyInput } from '@ulpin/scene';
import type { PublicBuilding, PublicMap } from '@ulpin/api-client/draft';
import type { AreaFeature } from '../api/queries';
import { toBase, toFootprints } from '../features/map/footprints';
import { RIGHTS_TOKEN, tokenColour } from '../features/map/ledger';

/**
 * The public 3D view: base map and massing from the public map, the chosen building storey by storey,
 * released units filled. View only: nothing here edits a record.
 */
export function PublicScene({ map, building, levelId, spaceId, onPick, onReady, onView, className, label }: {
  map: PublicMap; building: PublicBuilding | null; levelId: string | null; spaceId: string | null;
  onPick?: (pick: Pick) => void; onReady?: (engine: SceneEngine | null) => void; onView?: () => void; className?: string; label: string;
}) {
  const features = map.features as unknown as AreaFeature[];
  const base = useMemo(() => toBase(features), [features]);
  const storeys = useMemo(() => {
    const out = new Map<string, StoreyInput[]>();
    if (!building || building.groundM === null) return out;
    const g = building.groundM;
    if (building.storeys.some((s) => s.lowerM === null || s.upperM === null)) return out;
    out.set(building.id, building.storeys.map((s) => ({
      levelId: s.id, lowerM: s.lowerM! - g, upperM: s.upperM! - g, belowGround: s.belowGround, estimated: s.estimated,
      open: Boolean(s.use?.toLowerCase().includes('stilt')), roof: s.label.toLowerCase() === 'roof',
    })));
    return out;
  }, [building]);
  const footprints = useMemo(() => toFootprints(features, storeys), [features, storeys]);
  const detail = useMemo<BuildingDetailInput | null>(() => {
    if (!building) return null;
    const g = building.groundM ?? 0;
    const rel = (v: number | null) => (v === null ? null : v - g);
    const exclusive = tokenColour(RIGHTS_TOKEN.exclusive), shared = tokenColour(RIGHTS_TOKEN.shared);
    return {
      buildingId: building.id,
      levels: building.storeys.map((s, order) => ({
        id: s.id, order, lowerM: rel(s.lowerM), upperM: rel(s.upperM),
        spaces: s.spaces.map((sp) => ({
          id: sp.id, polygons: [sp.polygon.coordinates as MultiPolygon[number]], lowerM: rel(sp.lowerM), upperM: rel(sp.upperM),
          fill: sp.released ? { color: exclusive } : sp.shared ? { color: shared } : { hatch: true },
        })),
      })),
    };
  }, [building]);
  const state = useMemo<SceneState>(() => ({
    mode: levelId ? 'level' : building ? 'building' : 'area', buildingId: building?.id ?? null, levelId, spaceId, tool: 'select',
  }), [building, levelId, spaceId]);
  return (
    <SceneView className={className} base={base} buildings={footprints} detail={detail} state={state}
      onPick={onPick} onReady={onReady} onView={onView} label={label} />
  );
}
