import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const repo = fileURLToPath(new URL('../../', import.meta.url));
export function committed<T>(path: string): T {
  return JSON.parse(readFileSync(join(repo, path), 'utf8')) as T;
}

type DocumentPin = { sourceId: string; sourceRevision?: number; sourceSha256: string };
// R1/R2 are pins and expectations, never substitutes for observations from this run.
export const r1 = committed<{
  api: string;
  step2: { caseId: string; import: { sourceId: string; asset: string } };
  step3: { case: { id: string }; sourceId: string; mappingJobId: string;
    asset: { id: string; derivativeOf: { originalSha256: string } } };
}>('docs/evidence/runtime/r1/result.json');
export const r2 = committed<{
  inputs: { buildingId: string; siteId: string; sourceId: string; sourceRevision: number; sourceSha256: string };
  step1: { after: { api: { entry: string } } };
  step2: { record: { floorId: string; spaceId: string };
    readBack: { floorLabel: string; spaceLabel: string } };
  step3: { citations: { literal: string; page: number; regionPt: number[] }[] };
}>('docs/evidence/runtime/r2/result.json');
// R3 step3 is the expected live identity/card receipt, not a substitute for this run's reads.
export const live = committed<{
  step3: { target: { spaceId: string; buildingId: string }; resolve: { recordVersion: number };
    assign: { code: string };
    card: { cardId: string; revision: number; expiresAt: string } };
}>('docs/evidence/runtime/r3/result.json').step3;
// R1/R2 do not contain Magnolia/RAMP area ids; use the original committed installation receipts.
export const installed = committed<{
  canonical: { tower: { areaId: string }; magnolia: { areaId: string; buildingId: string } };
  difficultInput: { alternatives: string[] };
}>('docs/evidence/gf-backend/k2/result.json');
export const ramp = committed<{ imagery: { areaId: string } }>('docs/evidence/gf-backend/k2c/result.json');
export const schedule = committed<{ magnolia: { literalLabels: string[] } }>('docs/evidence/gf-t16/k3b/result.json');
export const buildings = [r2.inputs.buildingId, installed.canonical.magnolia.buildingId];
export const areas = [installed.canonical.tower.areaId, installed.canonical.magnolia.areaId, ramp.imagery.areaId];
export const demoCheckout = r2.step1.after.api.entry.split('/apps/api/')[0];
export const sourceRoute = '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}';
export const mappingRoute = sourceRoute + '/chunk-mapping/jobs/{jobId}';
export const mappingPins = { caseId: r1.step3.case.id, sourceId: r1.step3.sourceId, jobId: r1.step3.mappingJobId };

export function originalPins(): DocumentPin[] {
  const tower = committed<{ documentPins: DocumentPin[] }>('docs/evidence/gf-backend/k2/tower3-source-import.json');
  const magnolia = committed<{ documentPins: DocumentPin[] }>(
    'docs/evidence/gf-backend/k2/magnolia-source-import.json');
  const imagery = committed<{ imagery: { chips: { sourceId: string; sourceSha256: string }[] } }>(
    'docs/evidence/gf-backend/k2c/imagery-import.json');
  return [...tower.documentPins, ...magnolia.documentPins,
    ...imagery.imagery.chips];
}
