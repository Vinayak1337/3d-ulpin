/** A position in local metres: east, north. The backend owns CRS and datum; the scene never reprojects. */
export type LocalXY = [number, number];
export type Ring = LocalXY[];
/** Polygons with outer ring first, then holes. */
export type MultiPolygon = Ring[][];

export type HeightState = 'unknown' | 'unresolved' | 'estimated' | 'source_supported' | 'reviewed';

/** One storey of a building drawn storey by storey (heights above the building's ground, metres). */
export interface StoreyInput {
  levelId: string;
  lowerM: number;
  upperM: number;
  /** Open storey (stilt parking): drawn as columns under a slab. */
  open?: boolean;
  /** Roof: drawn as a parapet. */
  roof?: boolean;
  belowGround?: boolean;
  /** Estimated limits: hatched. */
  estimated?: boolean;
  /** Footprint of this storey when it differs from the building's (basements). */
  polygons?: MultiPolygon;
}

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
  /** Recorded storeys: when present the building is drawn storey by storey and picks name the level. */
  storeys?: StoreyInput[];
}

/** Flat base-map features and underground envelopes, drawn under the massing. */
export interface BaseFeatureInput {
  id: string;
  kind: 'parcel' | 'road' | 'public_land' | 'water' | 'utility';
  polygons: MultiPolygon;
  /** Utilities: depth band below ground (negative metres). */
  lowerM?: number;
  upperM?: number;
  /** Utilities: network key for the colour ('water', 'metro', …). */
  network?: string;
  /** Recorded name (roads, parks), for map labels. */
  name?: string;
}

/** Base-map layers the viewer can switch off. Buildings and the selection always stay. */
export interface SceneLayers {
  parcels: boolean;
  roads: boolean;
  publicLand: boolean;
  /** Illustrative trees in public land (enhanced view). */
  trees: boolean;
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
  /** Lower and upper limits above the building's ground; null = unknown, drawn flat at the level base. */
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

/** A finding drawn in findings mode: its volume and the records taking part. */
export interface FindingInput {
  id: string;
  polygons: MultiPolygon;
  lowerM: number;
  upperM: number;
  participants: string[];
}

/** Deviation check: the observed-only volume (drawn on the right half of a split view only). */
export interface DeviationInput {
  polygons: MultiPolygon;
  lowerM: number;
  upperM: number;
}

export type SceneMode = 'area' | 'building' | 'level' | 'findings' | 'underground' | 'deviation';
export type SceneTool = 'select' | 'measure' | 'section';

export interface SceneState {
  mode: SceneMode;
  buildingId: string | null;
  levelId: string | null;
  spaceId: string | null;
  tool: SceneTool;
  /** Section tool: cut height above ground, metres. */
  sectionM?: number | null;
  /** Findings mode: the open finding's volume and participants. */
  finding?: FindingInput | null;
  /** Deviation mode: sanctioned on the left half, observed (with this volume) on the right. */
  deviation?: DeviationInput | null;
}

/** What a click hit. */
export type Pick =
  | { kind: 'building'; id: string; levelId?: string }
  | { kind: 'space'; id: string; levelId: string }
  | { kind: 'ground'; point?: [number, number, number] };

/** A trench drawn in underground mode: two ground points and its footprint (local east, north). */
export interface Trench {
  points: [number, number][];
  lengthM: number | null;
  /** Footprint ring (2 m wide along the drawn line); null until both points are placed. */
  ring: [number, number][] | null;
}

/** A measurement between two picked points (scene metres). */
export interface Measurement {
  points: [number, number, number][];
  distanceM: number | null;
  horizontalM: number | null;
  verticalM: number | null;
}

export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

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
  road: string;
  publicLand: string;
  water: string;
  parcelLine: string;
  building: string;
  buildingEdge: string;
  selected: string;
  halo: string;
  ink: string;
  readinessUnknown: string;
  soilTop: string;
  soilDeep: string;
  critical: string;
  utilities: Record<string, string>;
}
