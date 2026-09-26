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
      out.push({ id: feature.id, kind: feature.kind === 'public_land' && props.land_cover === 'water' ? 'water' : feature.kind, polygons });
    }
  }
  return out;
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
