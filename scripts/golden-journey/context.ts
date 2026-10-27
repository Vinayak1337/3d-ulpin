import { NormalizedAreaSchema, NormalizedBuildingSchema } from '../../packages/contracts/src/canonical/building';
import assert from 'node:assert/strict';
import type { IntakeManifestSchema, IntakeEvidencePage, IntakeTarget } from '../../packages/contracts/src/usp/intake';
import { Reader, UnavailableRead, object, ok, type Read } from './read';

export type Building = ReturnType<typeof NormalizedBuildingSchema.parse>;
export type Area = ReturnType<typeof NormalizedAreaSchema.parse>;
export type Context = { reader: Reader; servedCommit: string | null; roofVerified: boolean; recordedVerified: boolean };
export type Manifest = ReturnType<typeof IntakeManifestSchema.parse>;
export type BatchContext = {
  reader: Reader;
  caseId?: string;
  manifest?: Manifest;
  evidence?: IntakeEvidencePage;
  target?: IntakeTarget;
  card?: { cardId: string; revision: number; recordRevision: number; usable: boolean };
};

export function batchData(read: Read): unknown {
  const route = '/' + read.route.join('/');
  if (read.status === 0 || read.status === 404) {
    throw new UnavailableRead(`${route}: nothing readable (${read.code ?? read.status}).`, 'skipped');
  }
  if ([401, 403, 409, 503].includes(read.status)) {
    throw new UnavailableRead(`${route}: read refused (${read.code ?? read.status}).`, 'undecidable');
  }
  assert.equal(read.status, 200, `${route}: HTTP ${read.status} ${read.code ?? ''}`);
  return read.body;
}

export function requireManifest(context: BatchContext): Manifest {
  if (!context.manifest) {
    throw new UnavailableRead('No batch manifest was readable; dependent read skipped.', 'skipped');
  }
  return context.manifest;
}
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
