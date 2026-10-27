import type { BaseFeatureInput, FootprintInput, LocalXY, MultiPolygon, StoreyInput } from '@ulpin/scene';
import type { AreaFeature } from '../../api/queries';
import type { BuildingModel } from '../../model/building';

const footprintCache = new WeakMap<AreaFeature, FootprintInput | null>();
const baseCache = new WeakMap<AreaFeature, BaseFeatureInput | null>();
const unnamedCache = new WeakMap<BaseFeatureInput, BaseFeatureInput>();

/**
 * Area context features → scene building inputs. A building with recorded storeys (its register is
 * loaded) is drawn storey by storey; others are one prism with a line at each recorded floor.
 */
export function toFootprints(features: AreaFeature[], storeys?: Map<string, StoreyInput[]>): FootprintInput[] {
  const out: FootprintInput[] = [];
  for (const feature of features) {
    if (feature.kind !== 'building') continue;
    const input = footprintFor(feature);
    if (!input) continue;
    const levels = storeys?.get(feature.id);
    out.push(levels ? { ...input, storeys: levels } : input);
  }
  return out;
}

function footprintFor(feature: AreaFeature): FootprintInput | null {
  if (footprintCache.has(feature)) return footprintCache.get(feature)!;
  const polygons = polygonsOf(feature.geometry);
  let input: FootprintInput | null = null;
  if (polygons.length) {
    const heightM = feature.height.value ?? null;
    const floorCount = feature.semantics?.floorCount;
    const slabsM = heightM && floorCount && floorCount > 1
      ? Array.from({ length: floorCount - 1 }, (_, i) => ((i + 1) * heightM) / floorCount)
      : undefined;
    input = { id: feature.id, polygons, heightM, heightState: feature.height.state, slabsM };
  }
  footprintCache.set(feature, input);
  return input;
}

/** Parcels, roads, public land, water and utilities: the flat base map and underground envelopes. */
/** Source surface subtypes the renderer draws distinctly; others fall back to the feature kind. */
const SURFACES: Record<string, string> = { roadbed: 'roadbed', sidewalk: 'sidewalk', court: 'court', parks: 'park', park: 'park', greenstreet: 'greenstreet' };

export function toBase(features: AreaFeature[], previous?: BaseFeatureInput[]): BaseFeatureInput[] {
  const out: BaseFeatureInput[] = [];
  for (const feature of features) {
    if (feature.kind === 'building') continue;
    const input = baseFor(feature);
    if (input) out.push(input);
  }
  const named = dedupeNames(out);
  if (previous?.length === named.length && named.every((input, index) => input === previous[index])) return previous;
  return named;
}

function baseFor(feature: AreaFeature): BaseFeatureInput | null {
  if (baseCache.has(feature)) return baseCache.get(feature)!;
  const input = convertBase(feature);
  baseCache.set(feature, input);
  return input;
}

function convertBase(feature: AreaFeature): BaseFeatureInput | null {
  if (feature.kind === 'building' || !feature.geometry) return null;
  const polygons = polygonsOf(feature.geometry);
  const g = feature.geometry as { type: string; coordinates?: unknown };
  let lines: LocalXY[][] | undefined;
  let pins: LocalXY[] | undefined;
  if (g.type === 'LineString') lines = [g.coordinates as LocalXY[]];
  if (g.type === 'MultiLineString') lines = g.coordinates as LocalXY[][];
  if (g.type === 'Point') pins = [g.coordinates as LocalXY];
  if (g.type === 'MultiPoint') pins = g.coordinates as LocalXY[];
  if (!polygons.length && !lines?.length && !pins?.length) return null;
  const geometry = { polygons, ...(lines ? { lines } : {}), ...(pins ? { pins } : {}) };
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  if (feature.kind === 'utility') {
    const extent = feature.verticalExtent;
    const profile = (feature.utilityProfile ?? {}) as Record<string, unknown>;
    return {
      id: feature.id, kind: 'utility', ...geometry, lowerM: extent?.lower, upperM: extent?.upper,
      network: typeof profile.network === 'string' ? profile.network : undefined,
    };
  }
  const named = (feature.kind === 'road' || feature.kind === 'public_land') && feature.name
    ? { name: feature.name } : {};
  const surface = SURFACES[String(props.sourceSubtype ?? '').toLowerCase()];
  return {
    id: feature.id, kind: feature.kind === 'public_land' && props.land_cover === 'water' ? 'water' : feature.kind,
    ...geometry, ...named, ...(surface ? { surface } : {}),
  };
}

/**
 * One label per place: features sharing a name (case-insensitive) keep it only on the largest piece and on
 * pieces more than 150 m from every kept piece (a name used across the area, such as a street-tree strip,
 * stays on each separate place). Names are never changed, only not repeated.
 */
function dedupeNames(features: BaseFeatureInput[]): BaseFeatureInput[] {
  const groups = new Map<string, { f: BaseFeatureInput; x: number; y: number; area: number }[]>();
  for (const f of features) {
    if (!f.name) continue;
    const ring = f.polygons[0]?.[0] ?? [];
    if (!ring.length) continue;
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) area += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
    const x = ring.reduce((s, p) => s + p[0], 0) / ring.length, y = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const key = f.name.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), { f, x, y, area: Math.abs(area) / 2 }]);
  }
  const drop = new Set<string>();
  for (const members of groups.values()) {
    members.sort((a, b) => b.area - a.area);
    const kept: typeof members = [];
    for (const m of members) {
      if (kept.some((k) => Math.hypot(k.x - m.x, k.y - m.y) < 150)) drop.add(m.f.id);
      else kept.push(m);
    }
  }
  return drop.size ? features.map((f) => (drop.has(f.id) ? withoutName(f) : f)) : features;
}

function withoutName(input: BaseFeatureInput): BaseFeatureInput {
  let unnamed = unnamedCache.get(input);
  if (!unnamed) {
    unnamed = { ...input, name: undefined };
    unnamedCache.set(input, unnamed);
  }
  return unnamed;
}

/**
 * Storeys of a building from its register levels. Elevations are in the site datum; the scene works in
 * metres above ground, so `groundM` (from the building ledger) is subtracted. Without a ground elevation
 * or with unknown limits no storeys are drawn and the building stays one prism.
 */
export function storeysFrom(model: BuildingModel, groundM: number | null, polygons: MultiPolygon): StoreyInput[] | undefined {
  if (groundM === null || !model.levels.length) return undefined;
  const out: StoreyInput[] = [];
  for (const level of model.levels) {
    if (level.lower === null || level.upper === null) return undefined;
    const use = level.record.use?.toLowerCase() ?? '';
    const ring = level.record.footprint.length >= 4 ? level.record.footprint : null;
    out.push({
      levelId: level.id,
      lowerM: level.lower - groundM,
      upperM: level.upper - groundM,
      open: use.includes('stilt'),
      roof: use === 'roof' || level.label.toLowerCase() === 'roof',
      belowGround: level.belowGround,
      estimated: level.estimated,
      polygons: level.belowGround && ring ? [[ring.map(([x, y]) => [x!, y!] as [number, number])]] : undefined,
    });
  }
  void polygons;
  return out;
}

export function polygonsOf(geometry: AreaFeature['geometry']): MultiPolygon {
  if (!geometry) return [];
  const g = geometry as { type: string; coordinates?: unknown };
  if (g.type === 'Polygon') return [g.coordinates as MultiPolygon[number]];
  if (g.type === 'MultiPolygon') return g.coordinates as MultiPolygon;
  return [];
}

/** Ids of the features a package proposed: the map frames them after that package's import. */
export function packageFeatureIds(features: AreaFeature[], packageId: string | null): ReadonlySet<string> {
  if (!packageId) return new Set();
  return new Set(features.filter((feature) => feature.proposalPackageId === packageId).map((feature) => feature.id));
}

/**
 * How many of the area's recorded features the map draws, from the real counts, so a feature that is not drawn is
 * always counted. A proposal not yet recorded is not counted.
 */
export function drawnCountNote(features: AreaFeature[], drawnIds: ReadonlySet<string>): string | null {
  const recorded = features.filter((feature) => feature.revision > 0);
  if (!recorded.length) return null;
  const drawn = recorded.filter((feature) => drawnIds.has(feature.id)).length;
  const total = recorded.length.toLocaleString('en-IN');
  if (drawn === recorded.length) return `${total} features drawn`;
  return `${drawn.toLocaleString('en-IN')} of ${total} features drawn`;
}

/** The package's features received so far, until its first footprint reaches a frame. */
export function drawingCountNote(name: string | null, features: readonly AreaFeature[],
  hasDrawn: boolean): string | null {
  if (hasDrawn) return null;
  return `Drawing${name ? ` ${name}` : ''}: ${features.length.toLocaleString('en-IN')} features so far`;
}

/**
 * Count the features the map leaves out: no geometry, a geometry it does not draw, or a building without a polygon.
 * Buildings without geometry are listed by name instead.
 */
export function undrawnNote(features: AreaFeature[]): string | null {
  const counts = new Map<string, number>();
  for (const feature of features) {
    if (feature.kind === 'building' && !feature.geometry) continue;
    if (feature.kind === 'building' ? polygonsOf(feature.geometry).length : baseFor(feature)) continue;
    counts.set(feature.kind, (counts.get(feature.kind) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const parts = [...counts].map(([kind, count]) => `${count} ${kind.replace('_', ' ')} ${count === 1 ? 'feature' : 'features'}`);
  return `Not drawn: ${parts.join(', ')}`;
}
