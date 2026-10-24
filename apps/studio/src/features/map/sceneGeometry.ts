import type { BuildingDetailInput, FootprintInput } from '@ulpin/scene';

/** The scene inputs that can show one building: the footprints drawn and the explored building's detail. */
export interface BuildingSceneInputs {
  footprints: readonly FootprintInput[];
  detail: BuildingDetailInput | null;
}

/**
 * Whether the scene inputs hold anything to draw for one building: a footprint of its own, or the outline of at
 * least one of its spaces. A level without a space outline is two heights and draws nothing by itself.
 */
export function hasGeometry(buildingId: string, { footprints, detail }: BuildingSceneInputs): boolean {
  if (footprints.some((footprint) => footprint.id === buildingId && footprint.polygons.length > 0)) return true;
  return detail?.buildingId === buildingId && detail.levels.some((level) => level.spaces.length > 0);
}

const GEOMETRY_GAP = /geometry|footprint|placement/i;

/** The canonical record's own gap lines that concern geometry or placement, as returned and in its order. */
export function geometryGaps(gaps: readonly string[]): string[] {
  return gaps.filter((gap) => GEOMETRY_GAP.test(gap));
}
