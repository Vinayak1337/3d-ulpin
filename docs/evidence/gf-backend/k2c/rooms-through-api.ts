import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BuildingPlanCandidateRequestSchema, NormalizedBuildingSchema } from '../../../../packages/contracts/src/index';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k2c';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pkg = JSON.parse(readFileSync('docs/evidence/gf-backend/k2/magnolia-source-commit.json', 'utf8'));
const buildingId = pkg.features[0].id;
const rounded = JSON.parse(readFileSync(
  'docs/evidence/gf-ai/plans/vector/20261010-p1-panels/bihar/candidates.json', 'utf8',
));
type VectorRoom = {
  taskVersion: string; outputRef: string; floorLabel: string; panelId: string; limitations: string[];
  sourceParts: { bbox: [number, number, number, number] }[];
  output: { polygonMetres: { coordinates: number[][][] }; label: string | null;
    metricFrame: { originPdf: [number, number]; metresPerPdfPoint: number } };
};
const bytes = readFileSync(rounded.fullPrecisionRef.path);
assert.equal(digest(bytes), rounded.fullPrecisionRef.sha256);
const full = JSON.parse(bytes.toString('utf8'));
const source = pkg.documentPins.find((pin: { sourceSha256: string }) => pin.sourceSha256 === full.inputManifest.sha256);
assert(source);

function save(name: string, value: unknown): void {
  writeFileSync(`${root}/${name}.json`, JSON.stringify(value) + '\n', { flag: 'wx' });
}

async function main(): Promise<void> {
  assert(!existsSync(`${root}/rooms-receipt.json`), 'Room retention already recorded; do not submit twice.');
  const response = await fetch(`${base}/buildings/${buildingId}/canonical`);
  const before = NormalizedBuildingSchema.parse(await response.json());
  assert.equal(before.levels.length, 0);
  save('magnolia-before-rooms', before);
  const candidates = full.pages['2'].candidates.map((candidate: VectorRoom) => {
    const [x0, y0, x1, y1] = candidate.sourceParts[0].bbox;
    const frame = candidate.output.metricFrame;
    return { candidateId: `vector-plan:${full.parameterHash}:${candidate.outputRef}`,
      task: 'plan_rooms', taskVersion: candidate.taskVersion, inputManifest: `sha256:${full.inputManifest.sha256}`,
      outputRef: candidate.outputRef, state: 'candidate', kind: 'room', method: full.method,
      confidence: null, confidenceCalibration: 'not_applicable', limitations: candidate.limitations,
      citations: [{ sourceId: source.sourceId, sourceSha256: source.sourceSha256,
        locator: { kind: 'region', page: 2, x: x0, y: y0, width: x1 - x0, height: y1 - y0, unit: 'pt' } }],
      polygons: [candidate.output.polygonMetres.coordinates],
      coordinateFrame: `plan-local:${source.sourceId}:page2:${candidate.panelId}`, levelId: null,
      labelLiteral: candidate.output.label ?? undefined, levelLabelLiteral: candidate.floorLabel,
      planFrame: { originPdf: frame.originPdf, metresPerPdfPoint: frame.metresPerPdfPoint, unit: 'm',
        axes: ['page_right', 'page_up'], placement: 'unknown', scaleState: 'candidate' } };
  });
  await retain(before.revisionId, candidates);
}

async function retain(expectedCanonicalRevision: string, candidates: unknown[]): Promise<void> {
  const input = BuildingPlanCandidateRequestSchema.parse({ action: 'retain_rooms', requestKey: randomUUID(),
    expectedCanonicalRevision, derivativeSha256: digest(bytes), candidates });
  save('rooms-request', input);
  const response = await fetch(`${base}/buildings/${buildingId}/candidates`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': input.requestKey },
    body: JSON.stringify(input) });
  const receipt = await response.json();
  assert.equal(response.status, 201, JSON.stringify(receipt));
  save('rooms-receipt', receipt);
  const after = NormalizedBuildingSchema.parse(await (await fetch(`${base}/buildings/${buildingId}/canonical`)).json());
  assert.equal(after.candidates.length, 18);
  assert(after.candidates.every(candidate => candidate.levelId === null && candidate.state === 'candidate'));
  assert.equal(after.levels.length, 0);
  assert.equal(after.footprint.value, null);
  save('magnolia-after-rooms', after);
  console.log('Retained 18 full-precision page-2 room candidates, unknown levels and plan-local placement.');
}

await main();
