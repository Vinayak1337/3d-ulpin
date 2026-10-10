import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { AreaReference, RetainedImagery, SpatialMlComponent, SpatialMlItem } from '@ulpin/contracts';
import { AppError } from '../../infrastructure/errors';

type Chip = RetainedImagery['chips'][number];
const affineSchema = z.tuple([
  z.number().finite(), z.number().finite(), z.number().finite(),
  z.number().finite(), z.number().finite(), z.number().finite(),
]);

function affinePoint(transform: Chip['affine'], point: number[]): [number, number] {
  return [transform[0] * point[0] + transform[1] * point[1] + transform[2],
    transform[3] * point[0] + transform[4] * point[1] + transform[5]];
}

/** Pixel-edge -> original TIFF grid -> declared WGS84. No fabricated controls or similarity approximation. */
export function geographicMlComponent(item: SpatialMlItem, chip: Chip, component: SpatialMlComponent): SpatialMlComponent {
  const transform = item.result?.receipt.rasterTransform as Record<string, unknown> | undefined;
  if (!item.result || item.task !== 'building' || item.sourceRevisionId !== chip.sourceId
    || item.sourceSha256 !== chip.sourceSha256 || transform?.coordinateConvention !== 'pixel-edge'
    || transform.sourceWidth !== chip.width || transform.sourceHeight !== chip.height) {
    throw new AppError(422, 'ML_GEOREFERENCE', 'The model raster differs from the exact retained image grid.');
  }
  const pixelToSource = affineSchema.parse(transform.pixelToSource);
  const ring = (points: number[][]) => points.map(point => {
    const source = affinePoint(pixelToSource, point);
    if (source[0] < 0 || source[1] < 0 || source[0] > chip.width || source[1] > chip.height) {
      throw new AppError(422, 'ML_GEOREFERENCE_GRID', 'A pixel proposal leaves the retained source image.');
    }
    return affinePoint(chip.affine, source);
  });
  const geometry = component.geometry.type === 'Polygon'
    ? { type: 'Polygon' as const, coordinates: component.geometry.coordinates.map(ring) }
    : { type: 'MultiPolygon' as const, coordinates: component.geometry.coordinates.map(polygon => polygon.map(ring)) };
  return { ...component, geometry };
}

/** Use the existing area projection; metres are display derivatives, not a cadastral qualification. */
export async function projectedGeographicComponents(
  client: PoolClient, components: SpatialMlComponent[], reference: AreaReference,
): Promise<SpatialMlComponent[]> {
  const results: SpatialMlComponent[] = [];
  for (const component of components) {
    const projected = (await client.query<{ geometry: SpatialMlComponent['geometry'] }>(
      `SELECT ST_AsGeoJSON(ST_Translate(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1),4326),$2),
        -$3,-$4),15)::jsonb geometry`,
      [JSON.stringify(component.geometry), Number(reference.analysisCrs.slice(5)), ...reference.origin],
    )).rows[0].geometry;
    results.push({ ...component, geometry: projected });
  }
  return results;
}
