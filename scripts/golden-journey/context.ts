import { NormalizedAreaSchema, NormalizedBuildingSchema } from '../../packages/contracts/src/canonical/building';
import { Reader, object, ok } from './read';

export type Building = ReturnType<typeof NormalizedBuildingSchema.parse>;
export type Area = ReturnType<typeof NormalizedAreaSchema.parse>;
export type Context = { reader: Reader; servedCommit: string | null; roofVerified: boolean; recordedVerified: boolean };
export async function building(context: Context, buildingId: string): Promise<Building> {
  return NormalizedBuildingSchema.parse(ok(await context.reader.get('/api/v1/buildings/{buildingId}/canonical',
    { buildingId })));
}
export async function area(context: Context, areaId: string): Promise<Area> {
  return NormalizedAreaSchema.parse(ok(await context.reader.get('/api/v1/areas/{areaId}/canonical', { areaId })));
}
export async function site(context: Context, siteId: string): Promise<Record<string, unknown>> {
  return object(ok(await context.reader.get('/api/v1/sites/{siteId}', { siteId })));
}
