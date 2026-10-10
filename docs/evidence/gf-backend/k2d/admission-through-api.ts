import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ImportPackage } from '../../../../packages/contracts/src/index';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k2d';
const retained = JSON.parse(readFileSync('docs/evidence/gf-backend/k2c/roofprint-draft.json', 'utf8'));
const packageId: string = retained.package.id;
const buildingId: string = retained.package.features[0].id;

function save(name: string, value: unknown): void {
  writeFileSync(`${root}/${name}.json`, JSON.stringify(value) + '\n', { flag: 'wx' });
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, path);
  return response.json() as Promise<T>;
}

async function command(path: string, input: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  return { status: response.status, body: await response.json() };
}

async function main(): Promise<void> {
  assert(!existsSync(`${root}/admission-result.json`), 'Admission observation already saved; no repeat command.');
  const before = await get<unknown>(`/buildings/${buildingId}/canonical`);
  const pkg = await get<ImportPackage>(`/import-packages/${packageId}`);
  assert.equal(pkg.features[0].revision, 0);
  save('roofprint-before', before);
  const review = await command(`/import-packages/${packageId}/review`, { expectedRevision: pkg.revision });
  save('review-observation', review);
  const commit = await command(`/import-packages/${packageId}/commit`, { expectedRevision: pkg.revision,
    acknowledgement: 'Model roofprint candidate only; non-analytic, no rights, parcels, height or level claim' });
  save('commit-observation', commit);
  assert.equal(review.status, 422);
  assert.equal(commit.status, 409);
  const after = await get<unknown>(`/buildings/${buildingId}/canonical`);
  assert.deepEqual(after, before);
  assert.deepEqual(await get<ImportPackage>(`/import-packages/${packageId}`), pkg);
  save('roofprint-after', after);
  save('admission-result', { packageId, buildingId, review, commit, unchangedCanonical: true,
    unchangedPackage: true, admitted: false, qualificationExecuted: false,
    lifecycleComplete: false, furtherCandidateReview: 'Stopped at the ordinary admission prerequisite' });
  console.log('Ordinary review 422, commit 409; unchanged candidate and package. Qualification not attempted.');
}

await main();
