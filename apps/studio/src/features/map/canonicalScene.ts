import { useMemo } from 'react';
import { toSceneInputs, type NormalizedArea, type NormalizedBuilding } from '@ulpin/contracts/canonical-scene';
import type { FootprintInput } from '@ulpin/scene';
import { isDemoId } from '../../api/demo-import';
import { useAreaCanonical, useBuildingCanonical, type AreaFeature } from '../../api/queries';
import { toFootprints } from './footprints';

export interface CanonicalFootprints {
  footprints: FootprintInput[];
  /** Buildings of the area record that have no usable footprint and so are not drawn. */
  undrawn: number;
}

const NONE: CanonicalFootprints = { footprints: [], undrawn: 0 };

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
  return { footprints, undrawn: area.buildings.length - footprints.length };
}

export function undrawnBuildingsNote(count: number): string | null {
  if (!count) return null;
  const subject = count === 1 ? '1 building has' : `${count} buildings have`;
  return `${subject} no usable footprint in the area record and ${count === 1 ? 'is' : 'are'} not drawn.`;
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
  return { ...(uploaded ? { footprints: uploaded, undrawn: 0 } : canonical), error: area.error };
}
