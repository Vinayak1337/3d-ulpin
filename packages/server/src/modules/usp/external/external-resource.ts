import type { ExternalRoofScene } from './external-scene';

/** Exact retained-source display projection. This never represents recorded interiors. */
export type ExternalSceneResource = {
  areaId: string;
  featureId: string;
  featureRevision: number;
  source: { id: string; revision: number; sha256: string; bytes: number };
  scene: ExternalRoofScene;
};
