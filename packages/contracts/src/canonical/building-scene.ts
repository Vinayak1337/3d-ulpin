import type {
  BaseFeatureInput,
  BuildingDetailInput,
  FootprintInput,
  HeightState,
  LevelInput,
  OverlayInput,
  SpaceInput,
  StoreyInput,
} from '../../../scene/src/types';
import type { BuildingValueState, NormalizedArea, NormalizedBuilding, Value } from './building';

/** Style sidecar: the current scene has no candidate flag or envelope hatch field. Never disguise these as reviewed. */
export interface BuildingSceneStyle { candidate: boolean; hatch: boolean }
export interface BuildingSceneInputs {
  footprints: FootprintInput[];
  details: BuildingDetailInput[];
  baseFeatures: BaseFeatureInput[];
  overlays: OverlayInput[];
  styles: Record<string, BuildingSceneStyle>;
  gaps: string[];
}

const DRAWABLE_STATES = ['estimated', 'candidate', 'source_supported', 'reviewed'];

const drawable = <T>(v: Value<T>): T | null => (DRAWABLE_STATES.includes(v.state) ? v.value : null);

function heightState(state: BuildingValueState): HeightState {
  if (state === 'estimated' || state === 'source_supported' || state === 'reviewed') return state;
  return state === 'candidate' ? 'unresolved' : 'unknown';
}

function style(...values: Value<unknown>[]): BuildingSceneStyle {
  return {
    candidate: values.some(v => v.state === 'candidate'),
    hatch: values.some(v => v.state === 'estimated' || drawable(v) === null),
  };
}

type NormalizedStorey = NonNullable<NormalizedBuilding['storeys']['value']>[number];

function adaptStorey(storey: NormalizedStorey): StoreyInput | null {
  const lowerM = drawable(storey.lowerM);
  const upperM = drawable(storey.upperM);
  if (lowerM === null || upperM === null || upperM <= lowerM) return null;
  if (storey.lowerM.state === 'candidate' || storey.upperM.state === 'candidate') return null;
  const projected: StoreyInput = {
    levelId: storey.levelId,
    lowerM,
    upperM,
    estimated: style(storey.lowerM, storey.upperM).hatch,
  };
  for (const key of ['open', 'roof', 'belowGround'] as const) {
    const value = drawable(storey[key]);
    if (value !== null) projected[key] = value;
  }
  const polygons = drawable(storey.polygons);
  if (polygons) projected.polygons = polygons;
  return projected;
}

function adaptStoreys(building: NormalizedBuilding, footprint: FootprintInput): StoreyInput[] {
  const heightKnown = footprint.heightM !== null
    && footprint.heightState !== 'unknown'
    && footprint.heightState !== 'unresolved';
  if (!heightKnown) return [];
  const storeys: StoreyInput[] = [];
  for (const storey of drawable(building.storeys) ?? []) {
    const projected = adaptStorey(storey);
    if (projected) storeys.push(projected);
  }
  return storeys;
}

function adaptSpaces(
  level: NormalizedBuilding['levels'][number],
  styles: BuildingSceneInputs['styles'],
): SpaceInput[] {
  return level.spaces.flatMap(space => {
    const polygons = drawable(space.polygons);
    styles[space.spaceId] = style(space.polygons, space.lowerM, space.upperM);
    if (!polygons) return [];
    return [{
      id: space.spaceId,
      polygons,
      lowerM: drawable(space.lowerM),
      upperM: drawable(space.upperM),
      fill: { hatch: styles[space.spaceId].hatch },
    }];
  });
}

function adaptLevels(building: NormalizedBuilding, styles: BuildingSceneInputs['styles']): LevelInput[] {
  return building.levels.map(level => ({
    id: level.levelId,
    order: level.order,
    lowerM: drawable(level.lowerM),
    upperM: drawable(level.upperM),
    spaces: adaptSpaces(level, styles),
  }));
}

/** Footprint input plus, when the full building is supplied, its storeys and level detail. */
function adaptBuilding(
  summary: NormalizedArea['buildings'][number],
  polygons: FootprintInput['polygons'],
  building: NormalizedBuilding | undefined,
  result: BuildingSceneInputs,
): FootprintInput {
  const input: FootprintInput = {
    id: summary.buildingId,
    polygons,
    heightM: drawable(summary.heightM),
    heightState: heightState(summary.heightState),
  };
  if (!building) return input;
  const base = drawable(building.baseM);
  // A zero scene base is a building-relative presentation convention, not an unknown measured elevation.
  if (base !== null) input.baseM = base;
  const storeys = adaptStoreys(building, input);
  if (storeys.length) input.storeys = storeys;
  result.details.push({ buildingId: building.buildingId, levels: adaptLevels(building, result.styles) });
  return input;
}

function adaptBaseFeature(feature: NormalizedArea['baseFeatures'][number]): BaseFeatureInput | null {
  const polygons = drawable(feature.polygons);
  if (!polygons) return null;
  const input: BaseFeatureInput = { id: feature.id, kind: feature.kind, polygons };
  const name = drawable(feature.name);
  if (name !== null) input.name = name;
  const lower = drawable(feature.lowerM);
  const upper = drawable(feature.upperM);
  if (lower !== null && upper !== null && lower < upper) {
    input.lowerM = lower;
    input.upperM = upper;
  }
  const network = drawable(feature.network);
  if (network !== null) input.network = network;
  return input;
}

function adaptOverlay(
  overlay: NormalizedArea['overlays'][number],
  images: Readonly<Record<string, HTMLCanvasElement>>,
  result: BuildingSceneInputs,
): void {
  if (overlay.kind === 'image') {
    if (images[overlay.id]) {
      result.overlays.push({ id: overlay.id, kind: 'image', corners: overlay.corners, image: images[overlay.id] });
    } else {
      result.gaps.push(`${overlay.id}: original image must be decoded by the authorised caller`);
    }
  } else if (overlay.kind === 'points') {
    result.overlays.push({
      ...overlay,
      positions: new Float32Array(overlay.positions),
      colors: new Float32Array(overlay.colors),
    });
  } else {
    result.overlays.push(overlay);
  }
}

/**
 * Pure adaptation only: geometry must already be backend-projected ENU metres.
 * Browser image decoding is supplied, never fetched here.
 */
export function toSceneInputs(
  area: NormalizedArea,
  buildings: readonly NormalizedBuilding[],
  images: Readonly<Record<string, HTMLCanvasElement>> = {},
): BuildingSceneInputs {
  const result: BuildingSceneInputs = {
    footprints: [],
    details: [],
    baseFeatures: [],
    overlays: [],
    styles: {},
    gaps: [...area.gaps],
  };
  for (const summary of area.buildings) {
    const building = buildings.find(candidate => candidate.buildingId === summary.buildingId);
    if (building && (building.revisionId !== summary.revisionId
      || JSON.stringify(building.frame) !== JSON.stringify(area.frame))) {
      throw new Error('Scene building revision/frame must match its area projection');
    }
    const polygons = drawable(summary.footprint);
    result.styles[summary.buildingId] = style(summary.footprint, summary.heightM);
    if (!polygons) {
      result.gaps.push(`${summary.buildingId}: footprint unavailable`);
      continue;
    }
    result.footprints.push(adaptBuilding(summary, polygons, building, result));
  }
  for (const feature of area.baseFeatures) {
    const input = adaptBaseFeature(feature);
    if (input) result.baseFeatures.push(input);
  }
  for (const overlay of area.overlays) adaptOverlay(overlay, images, result);
  return result;
}
