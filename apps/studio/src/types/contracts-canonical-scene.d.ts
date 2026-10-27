/**
 * Type surface the Studio uses from @ulpin/contracts/canonical-scene (backend-owned source, compiled with looser
 * settings than the Studio's). The records are the published OpenAPI responses; at runtime Vite resolves the
 * package export to packages/contracts/src/canonical/building-scene.ts. Keep the scene types in sync with it.
 */
import type { GetResponse } from '@ulpin/api-client';
import type { BaseFeatureInput, BuildingDetailInput, FootprintInput, OverlayInput } from '@ulpin/scene';

export type NormalizedArea = GetResponse<'/api/v1/areas/{areaId}/canonical'>;
export type NormalizedBuilding = GetResponse<'/api/v1/buildings/{buildingId}/canonical'>;

export interface BuildingSceneStyle {
  candidate: boolean;
  hatch: boolean;
}
export interface BuildingSceneInputs {
  footprints: FootprintInput[];
  details: BuildingDetailInput[];
  baseFeatures: BaseFeatureInput[];
  overlays: OverlayInput[];
  styles: Record<string, BuildingSceneStyle>;
  gaps: string[];
}
export declare function toSceneInputs(
  area: NormalizedArea,
  buildings: readonly NormalizedBuilding[],
  images?: Readonly<Record<string, HTMLCanvasElement>>,
): BuildingSceneInputs;
