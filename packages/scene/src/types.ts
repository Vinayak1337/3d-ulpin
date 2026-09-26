/** A position in local metres: east, north. The backend owns CRS and datum; the scene never reprojects. */
export type LocalXY = [number, number];
export type Ring = LocalXY[];
/** Polygons with outer ring first, then holes. */
export type MultiPolygon = Ring[][];

export type HeightState = 'unknown' | 'unresolved' | 'estimated' | 'source_supported' | 'reviewed';

/** One building envelope in the area. `id` is the canonical record ID. */
export interface FootprintInput {
  id: string;
  polygons: MultiPolygon;
  /** Height above the building's own base, metres. Null or unknown state: drawn flat, never extruded to a guess. */
  heightM: number | null;
  heightState: HeightState;
  /** Base height in the scene's vertical frame; 0 when bases are building-relative. */
  baseM?: number;
  /** Known slab elevations (relative to base) drawn as lines on the massing. Only recorded levels. */
  slabsM?: number[];
}

/** Fill of a space in level mode, decided by the active Colour by. */
export interface SpaceFill {
  color?: string;
  /** 45° hatch: unknown or estimated. */
  hatch?: boolean;
}

export interface SpaceInput {
  id: string;
  polygons: MultiPolygon;
  /** Lower and upper limits in the building's frame; null = unknown, drawn flat at the level base. */
  lowerM: number | null;
  upperM: number | null;
  fill: SpaceFill;
}

export interface LevelInput {
  id: string;
  /** Source order, top to bottom as the rail lists it; the scene uses it for ghosting above/below. */
  order: number;
  lowerM: number | null;
  upperM: number | null;
  spaces: SpaceInput[];
}

/** Detail of the one building being explored (levels and spaces from its register). */
export interface BuildingDetailInput {
  buildingId: string;
  levels: LevelInput[];
}

export type SceneMode = 'area' | 'building' | 'level' | 'findings' | 'underground';
export type RenderStyle = 'model' | 'volumes';
export type ViewMode = '3d' | '2d';

export interface SceneState {
  mode: SceneMode;
  buildingId: string | null;
  levelId: string | null;
  spaceId: string | null;
  render: RenderStyle;
  view: ViewMode;
  /** Findings mode: records that take part in the open finding (ink outline, not ghosted). */
  participants?: string[];
}

/** What a click hit. */
export type Pick =
  | { kind: 'building'; id: string }
  | { kind: 'space'; id: string; levelId: string }
  | { kind: 'ground' };

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
  halo: string;
  ink: string;
  unknownHatch: string;
  readinessUnknown: string;
  soilTop: string;
  soilDeep: string;
  critical: string;
}
