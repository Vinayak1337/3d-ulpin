import type { BaseFeatureInput, BuildingDetailInput, FootprintInput, HeightState, OverlayInput, StoreyInput } from '../../../scene/src/types';
import type { BuildingValueState, NormalizedArea, NormalizedBuilding, Value } from './building';

/** Style sidecar: the current scene has no candidate flag or envelope hatch field. Never disguise these as reviewed. */
export interface BuildingSceneStyle { candidate: boolean; hatch: boolean }
export interface BuildingSceneInputs {
  footprints: FootprintInput[]; details: BuildingDetailInput[]; baseFeatures: BaseFeatureInput[];
  overlays: OverlayInput[]; styles: Record<string, BuildingSceneStyle>; gaps: string[];
}
const drawable = <T>(v: Value<T>): T | null => ['estimated', 'candidate', 'source_supported', 'reviewed'].includes(v.state) ? v.value : null;
const heightState = (state: BuildingValueState): HeightState =>
  state === 'estimated' || state === 'source_supported' || state === 'reviewed' ? state : state === 'candidate' ? 'unresolved' : 'unknown';
const style = (...values: Value<unknown>[]): BuildingSceneStyle => ({
  candidate: values.some(v => v.state === 'candidate'), hatch: values.some(v => v.state === 'estimated' || drawable(v) === null),
});
/** Pure adaptation only: geometry must already be backend-projected ENU metres. Browser image decoding is supplied, never fetched here. */
export function toSceneInputs(area: NormalizedArea, buildings: readonly NormalizedBuilding[],
  images: Readonly<Record<string, HTMLCanvasElement>> = {}): BuildingSceneInputs {
  const result: BuildingSceneInputs = { footprints: [], details: [], baseFeatures: [], overlays: [], styles: {}, gaps: [...area.gaps] };
  for (const summary of area.buildings) {
    const building = buildings.find(b => b.buildingId === summary.buildingId);
    if (building && (building.revisionId !== summary.revisionId || JSON.stringify(building.frame) !== JSON.stringify(area.frame)))
      throw new Error('Scene building revision/frame must match its area projection');
    const polygons = drawable(summary.footprint);
    result.styles[summary.buildingId] = style(summary.footprint, summary.heightM);
    if (!polygons) { result.gaps.push(`${summary.buildingId}: footprint unavailable`); continue; }
    const input: FootprintInput = { id: summary.buildingId, polygons, heightM: drawable(summary.heightM), heightState: heightState(summary.heightState) };
    if (building) {
      const base = drawable(building.baseM);
      // A zero scene base is a building-relative presentation convention, not an unknown measured elevation.
      if (base !== null) input.baseM = base;
      const storeys: StoreyInput[] = [];
      if (input.heightM !== null && input.heightState !== 'unknown' && input.heightState !== 'unresolved')
        for (const s of drawable(building.storeys) ?? []) {
          const lowerM = drawable(s.lowerM), upperM = drawable(s.upperM);
          if (lowerM === null || upperM === null || upperM <= lowerM || s.lowerM.state === 'candidate' || s.upperM.state === 'candidate') continue;
          const projected: StoreyInput = { levelId: s.levelId, lowerM, upperM, estimated: style(s.lowerM, s.upperM).hatch };
          for (const key of ['open', 'roof', 'belowGround'] as const) { const value = drawable(s[key]); if (value !== null) projected[key] = value; }
          const p = drawable(s.polygons); if (p) projected.polygons = p;
          storeys.push(projected);
        }
      if (storeys.length) input.storeys = storeys;
      result.details.push({ buildingId: building.buildingId, levels: building.levels.map(l => ({ id: l.levelId, order: l.order,
        lowerM: drawable(l.lowerM), upperM: drawable(l.upperM), spaces: l.spaces.flatMap(s => {
          const p = drawable(s.polygons); result.styles[s.spaceId] = style(s.polygons, s.lowerM, s.upperM);
          return p ? [{ id: s.spaceId, polygons: p, lowerM: drawable(s.lowerM), upperM: drawable(s.upperM),
            fill: { hatch: result.styles[s.spaceId].hatch } }] : [];
        }) })) });
    }
    result.footprints.push(input);
  }
  for (const f of area.baseFeatures) {
    const polygons = drawable(f.polygons); if (!polygons) continue;
    const input: BaseFeatureInput = { id: f.id, kind: f.kind, polygons };
    const name = drawable(f.name); if (name !== null) input.name = name;
    const lower = drawable(f.lowerM), upper = drawable(f.upperM);
    if (lower !== null && upper !== null && lower < upper) { input.lowerM = lower; input.upperM = upper; }
    const network = drawable(f.network); if (network !== null) input.network = network;
    result.baseFeatures.push(input);
  }
  for (const overlay of area.overlays) {
    if (overlay.kind === 'image') {
      if (images[overlay.id]) result.overlays.push({ id: overlay.id, kind: 'image', corners: overlay.corners, image: images[overlay.id] });
      else result.gaps.push(`${overlay.id}: original image must be decoded by the authorised caller`);
    } else if (overlay.kind === 'points') result.overlays.push({ ...overlay, positions: new Float32Array(overlay.positions), colors: new Float32Array(overlay.colors) });
    else result.overlays.push(overlay);
  }
  return result;
}
