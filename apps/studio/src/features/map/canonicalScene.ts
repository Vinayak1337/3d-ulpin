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

/** The explored building's own record, only while it is the revision the area record lists. */
function matchingBuildings(area: NormalizedArea, building: NormalizedBuilding | undefined): NormalizedBuilding[] {
  const summary = area.buildings.find((candidate) => candidate.buildingId === building?.buildingId);
  return building && summary?.revisionId === building.revisionId ? [building] : [];
}

/** Scene footprints through the contracts adapter; a candidate stays a candidate in the scene. */
export function canonicalFootprints(area: NormalizedArea, building?: NormalizedBuilding): CanonicalFootprints {
  const inputs = toSceneInputs(area, matchingBuildings(area, building));
  const footprints = inputs.footprints.map((footprint) => ({
    ...footprint,
    candidate: inputs.styles[footprint.id]?.candidate === true,
  }));
  return { footprints, undrawn: undrawnBuildings(area, footprints) };
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
 * browser (demo import) have no canonical record and keep drawing their context features.
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
  return { ...drawn, pending: area.isLoading, error: area.error };
}
