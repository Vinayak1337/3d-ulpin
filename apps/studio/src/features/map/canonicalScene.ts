import { useMemo } from 'react';
import { toSceneInputs, type NormalizedArea, type NormalizedBuilding } from '@ulpin/contracts/canonical-scene';
import type { FootprintInput } from '@ulpin/scene';
import { isDemoId } from '../../api/demo-import';
import { useAreaCanonical, useBuildingCanonical, type AreaFeature } from '../../api/queries';
import { toFootprints } from './footprints';

/** A building of the area record with no usable footprint: it is listed, never drawn or placed. */
export interface UndrawnBuilding {
  id: string;
  name: string;
  state: NormalizedBuilding['recordState'];
}

export interface CanonicalFootprints {
  footprints: FootprintInput[];
  undrawn: UndrawnBuilding[];
}

const NONE: CanonicalFootprints = { footprints: [], undrawn: [] };

/**
 * The area record with the explored building's summary taken from that building's own record, so the scene draws
 * it storey by storey from the record it was read from. A building the area does not list, or one read in another
 * frame, is not used.
 */
export function withExploredBuilding(area: NormalizedArea, building: NormalizedBuilding | undefined): NormalizedArea {
  if (!building || JSON.stringify(building.frame) !== JSON.stringify(area.frame)) return area;
  if (!area.buildings.some((summary) => summary.buildingId === building.buildingId)) return area;
  const { buildingId, revisionId, recordState, name, footprint, heightM, heightState } = building;
  const own = { buildingId, revisionId, recordState, name, footprint, heightM, heightState };
  return {
    ...area,
    buildings: area.buildings.map((summary) => (summary.buildingId === buildingId ? own : summary)),
  };
}

/** Scene footprints through the contracts adapter; a candidate stays a candidate in the scene. */
export function canonicalFootprints(area: NormalizedArea, building?: NormalizedBuilding): CanonicalFootprints {
  const explored = withExploredBuilding(area, building);
  const inputs = toSceneInputs(explored, explored === area ? [] : [building!]);
  const footprints = inputs.footprints.map((footprint) => ({
    ...footprint,
    candidate: inputs.styles[footprint.id]?.candidate === true,
  }));
  return { footprints, undrawn: undrawnBuildings(explored, footprints) };
}

/** The recorded name, or the building's id when the record has none. */
export function undrawnBuildings(area: NormalizedArea, footprints: FootprintInput[]): UndrawnBuilding[] {
  const drawnIds = new Set(footprints.map((footprint) => footprint.id));
  return area.buildings
    .filter((building) => !drawnIds.has(building.buildingId))
    .map((building) => ({
      id: building.buildingId,
      name: building.name.value?.trim() || building.buildingId,
      state: building.recordState,
    }));
}

/**
 * What the map draws: the canonical records of the area and of the explored building. Areas uploaded in the
 * browser (demo import) have no canonical record and keep drawing their context features. The area record is
 * returned too, for the imagery it lists.
 */
export function useCanonicalFootprints(
  areaId: string | undefined,
  buildingId: string | null | undefined,
  features: AreaFeature[],
  live = false,
) {
  const area = useAreaCanonical(areaId, live);
  const building = useBuildingCanonical(buildingId);
  const canonical = useMemo(
    () => (area.data ? canonicalFootprints(area.data, building.data) : NONE),
    [area.data, building.data],
  );
  const uploaded = useMemo(() => (isDemoId(areaId) ? toFootprints(features) : null), [areaId, features]);
  const drawn = uploaded ? { footprints: uploaded, undrawn: [] } : canonical;
  return { ...drawn, area: area.data, pending: area.isLoading, error: area.error };
}
