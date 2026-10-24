import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { SourceBuildingImport, SourceBuildingPackage } from '@ulpin/contracts';
import { AppError } from '../../../infrastructure/errors';
import type { DocumentPins } from './source-building-values';

type AdministrativeContext = NonNullable<SourceBuildingPackage['administrativeContext']>;
const point = z.tuple([z.number().finite(), z.number().finite()]);
const ring = z.array(point).min(4).max(10000).refine(points => (
  points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]
));
const sourceSchema = z.object({
  geometryType: z.literal('esriGeometryPolygon'),
  spatialReference: z.object({ wkid: z.number().int().positive().max(999999) }),
  features: z.array(z.object({
    attributes: z.record(z.string(), z.unknown()), geometry: z.object({ rings: z.array(ring).min(1).max(100) }),
  })).min(1).max(100),
});

export function sourceAdministrativeContext(
  input: SourceBuildingImport, bytes: Uint8Array, pins: DocumentPins,
): AdministrativeContext {
  const source = sourceSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  const mapping = input.administrativeContext!;
  const keys = new Set<string>();
  const units = source.features.map(feature => {
    const rawKey = feature.attributes[mapping.idField];
    const name = feature.attributes[mapping.nameField];
    if (!['string', 'number'].includes(typeof rawKey) || typeof name !== 'string' || !name.trim()) {
      throw new AppError(422, 'ADMINISTRATIVE_SOURCE_FIELDS',
        'Choose documented complete source identifiers and names.');
    }
    const sourceKey = String(rawKey);
    if (keys.has(sourceKey)) throw new AppError(422, 'ADMINISTRATIVE_SOURCE_ID', 'Source identifiers must be unique.');
    keys.add(sourceKey);
    return { id: randomUUID(), sourceKey, kind: mapping.kind, name, rings: feature.geometry.rings };
  });
  const pin = pins.get(input.documents[0].key)!;
  return { sourceId: pin.sourceId, sourceCrs: `EPSG:${source.spatialReference.wkid}`, units };
}

export async function recordAdministrativeContextTx(client: PoolClient, pkg: SourceBuildingPackage): Promise<void> {
  const context = pkg.administrativeContext;
  if (!context) return;
  for (const unit of context.units) {
    const source = JSON.stringify({ sourceId: context.sourceId, sourceCrs: context.sourceCrs,
      featureId: unit.sourceKey, role: 'administrative_context', packageId: pkg.id });
    await client.query(
      'INSERT INTO administrative_units(id,kind,name,code,authority,source) VALUES($1,$2,$3,$4,$5,$6)',
      [unit.id, unit.kind, unit.name, null, pkg.sourceMetadata[0].issuer, source],
    );
    await client.query('INSERT INTO area_memberships(area_id,unit_id) VALUES($1,$2)', [pkg.areaId, unit.id]);
  }
}
