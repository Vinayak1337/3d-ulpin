/** A position in local metres: east, north. The backend owns CRS and datum; the scene never reprojects. */
export type LocalXY = [number, number];
export type Ring = LocalXY[];
/** Polygons with outer ring first, then holes. */
export type MultiPolygon = Ring[][];

export type HeightState = 'unknown' | 'unresolved' | 'estimated' | 'source_supported' | 'reviewed';

/** One footprint-with-height record, drawn as an envelope. `id` is the canonical record ID. */
export interface FootprintInput {
  id: string;
  polygons: MultiPolygon;
  /** Height above the building's own base, metres. Null or unknown state: drawn flat, never extruded to a guess. */
  heightM: number | null;
  heightState: HeightState;
  /** Base height in the scene's vertical frame; 0 when bases are building-relative. */
  baseM?: number;
}

export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type CameraPreset = 'oblique' | 'plan';

export interface SceneStats {
  /** Mean CPU time per rendered frame over the last 60 frames, ms. */
  frameMs: number;
  frames: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  /** JS heap in MB where the browser exposes it (Chromium), else null. */
  heapMB: number | null;
}

export interface ScenePalette {
  ground: string;
  building: string;
  buildingEdge: string;
  selected: string;
  hover: string;
  halo: string;
  unknownHatch: string;
}
