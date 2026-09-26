import type { FootprintInput, MultiPolygon } from '@ulpin/scene';
import type { AreaFeature } from '../../api/queries';

/** Area context features → scene inputs. Only building footprints with polygon geometry are drawn. */
export function toFootprints(features: AreaFeature[]): FootprintInput[] {
  const out: FootprintInput[] = [];
  for (const feature of features) {
    if (feature.kind !== 'building') continue;
    const polygons = polygonsOf(feature.geometry);
    if (!polygons.length) continue;
    out.push({
      id: feature.id,
      polygons,
      heightM: feature.height.value ?? null,
      heightState: feature.height.state,
    });
  }
  return out;
}

function polygonsOf(geometry: AreaFeature['geometry']): MultiPolygon {
  const g = geometry as { type: string; coordinates?: unknown };
  if (g.type === 'Polygon') return [g.coordinates as MultiPolygon[number]];
  if (g.type === 'MultiPolygon') return g.coordinates as MultiPolygon;
  return [];
}
