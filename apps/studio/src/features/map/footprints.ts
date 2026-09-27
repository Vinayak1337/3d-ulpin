import type { BaseFeatureInput, FootprintInput, MultiPolygon, StoreyInput } from '@ulpin/scene';
import type { AreaFeature } from '../../api/queries';
import type { BuildingModel } from '../../model/building';

/**
 * Area context features → scene building inputs. A building with recorded storeys (its register is
 * loaded) is drawn storey by storey; others are one prism with a line at each recorded floor.
 */
export function toFootprints(features: AreaFeature[], storeys?: Map<string, StoreyInput[]>): FootprintInput[] {
  const out: FootprintInput[] = [];
  for (const feature of features) {
    if (feature.kind !== 'building') continue;
    const polygons = polygonsOf(feature.geometry);
    if (!polygons.length) continue;
    const heightM = feature.height.value ?? null;
    const floorCount = feature.semantics?.floorCount;
    const slabsM = heightM && floorCount && floorCount > 1
      ? Array.from({ length: floorCount - 1 }, (_, i) => ((i + 1) * heightM) / floorCount)
      : undefined;
    out.push({ id: feature.id, polygons, heightM, heightState: feature.height.state, slabsM, storeys: storeys?.get(feature.id) });
  }
  return out;
}

/** Parcels, roads, public land, water and utilities: the flat base map and underground envelopes. */
/** Source surface subtypes the renderer draws distinctly; others fall back to the feature kind. */
const SURFACES: Record<string, string> = { roadbed: 'roadbed', sidewalk: 'sidewalk', court: 'court', parks: 'park', park: 'park', greenstreet: 'greenstreet' };

export function toBase(features: AreaFeature[]): BaseFeatureInput[] {
  const out: BaseFeatureInput[] = [];
  for (const feature of features) {
    if (feature.kind === 'building') continue;
    const polygons = polygonsOf(feature.geometry);
    if (!polygons.length) continue;
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    if (feature.kind === 'utility') {
      const extent = feature.verticalExtent;
      const profile = (feature.utilityProfile ?? {}) as Record<string, unknown>;
      // Depths are recorded as metres below ground; the scene's ground is 0.
      out.push({ id: feature.id, kind: 'utility', polygons, lowerM: extent ? extent.lower : undefined, upperM: extent ? extent.upper : undefined, network: typeof profile.network === 'string' ? profile.network : undefined });
    } else {
      const named = (feature.kind === 'road' || feature.kind === 'public_land') && feature.name ? { name: feature.name } : {};
      const surface = SURFACES[String(props.sourceSubtype ?? '').toLowerCase()];
      out.push({ id: feature.id, kind: feature.kind === 'public_land' && props.land_cover === 'water' ? 'water' : feature.kind, polygons, ...named, ...(surface ? { surface } : {}) });
    }
  }
  return dedupeNames(out);
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
  return drop.size ? features.map((f) => (drop.has(f.id) ? { ...f, name: undefined } : f)) : features;
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
  const g = geometry as { type: string; coordinates?: unknown };
  if (g.type === 'Polygon') return [g.coordinates as MultiPolygon[number]];
  if (g.type === 'MultiPolygon') return g.coordinates as MultiPolygon;
  return [];
}
