import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { keep, safe, save, serving } from './audit.mjs';

// REH10's product-only readback and contract/hash checks, now preserving the failed card carry explicitly.
const intake = await import(pathToFileURL(`${serving}/packages/contracts/src/usp/intake.ts`).href);
const caseId = '704a2c5e-669a-42a2-ac4c-99099217685c';
const judgeCase = 'a8287433-2963-49de-aad1-9da46678a79c';
const scratch = 'E:/BhuAayam-data/task-data/reh11';
const root = `/ingestion/cases/${caseId}`;
const checks = [];

async function get(path, schema) {
  const response = await fetch(`http://127.0.0.1:21026/api/v1${path}`);
  assert.equal(response.status, 200, path);
  const body = await response.json();
  const value = body.data ?? body;
  if (schema) schema.parse(value);
  checks.push({ path, status: response.status, schema: schema ? 'passed' : 'not requested' });
  return value;
}

function hashes(detail, expected) {
  return detail.sources.map(source => ({ name: source.name, status: source.status, profile: source.profile,
    revision: source.revision, sha256: source.sha256,
    matchesOriginal: source.sha256 === expected.find(file => [file.path].flat().join('').endsWith(source.name))
      ?.sha256 }));
}

function items(manifest) {
  return manifest.items.map(({ itemId, sourceId, name, state, placement, partsDone, partsPlanned, limitReason }) => ({
    itemId, sourceId, name, state, placement, partsDone, partsPlanned, limitReason,
  }));
}

const manifest = await get(`${root}/intake`, intake.IntakeManifestSchema);
const evidence = await get(`${root}/intake/evidence`, intake.IntakeEvidencePageSchema);
const confirmation = await get(`${root}/confirmations/d7e97d41-cd9f-4c98-8511-2222ef3db13a`,
  intake.IntakeConfirmationSchema);
const detail = await get(`/cases/${caseId}`);
writeFileSync(`${scratch}/final-case-act1.json`, JSON.stringify(detail));
const expected = JSON.parse(readFileSync(new URL('./act1-files.json', import.meta.url), 'utf8')).files;
const originalHashes = hashes(detail, expected);
assert(originalHashes.every(source => source.matchesOriginal), 'An original hash differs');
assert.equal(evidence.confirmations.length, 1);
assert.equal(confirmation.progress[0].readiness, 'stopped');
assert.deepEqual(confirmation.progress[0].blockedBy, ['REGISTRY_SOURCE_UNAVAILABLE']);
assert.equal(confirmation.progress[0].artefacts.card, undefined);

const parts = [];
for (const item of manifest.items.filter(item => ['raster', 'point_cloud'].includes(item.family))) {
  const page = await get(`${root}/intake/items/${item.itemId}/parts`, intake.IntakeSurfacePartPageSchema);
  const published = page.parts.filter(part => part.state === 'published');
  const first = published[0];
  if (first) await get(`${root}/intake/items/${item.itemId}/parts/${first.partIndex}/display`,
    intake.IntakeSurfaceDisplaySchema);
  parts.push({ itemId: item.itemId, name: item.name, partsPlanned: page.partsPlanned,
    next: page.next, plannedOnPage: page.parts.filter(part => part.state === 'planned').length,
    states: page.parts.filter(part => part.state !== 'planned')
      .map(({ partIndex, state, jobId, issueCode }) => ({ partIndex, state, jobId, issueCode })) });
}
const judges = await get(`/ingestion/cases/${judgeCase}/intake`, intake.IntakeManifestSchema);
const judgeDetail = await get(`/cases/${judgeCase}`);
writeFileSync(`${scratch}/final-case-act2.json`, JSON.stringify(judgeDetail));
const act2Inputs = JSON.parse(readFileSync(new URL('./act2-inputs.json', import.meta.url), 'utf8'));
const judgeHashes = hashes(judgeDetail, [...act2Inputs.files,
  ...act2Inputs.members.map(member => ({ ...member, path: member.name }))]);
assert(judgeHashes.every(source => source.matchesOriginal), 'A ZIP member or original hash differs');
const short = await get('/cases/3b0d10c9-80b2-4137-a2d6-d9bcb6cece1f');
const shortHashes = hashes(short, act2Inputs.files);
assert(shortHashes.every(source => source.matchesOriginal), 'Short CSV original hash differs');
for (const source of [...originalHashes, ...judgeHashes, ...shortHashes]) keep(source.sha256);
const receipt = { at: new Date().toISOString(), checks, originalHashes, judgeHashes, shortHashes,
  caseId, manifest: items(manifest), confirmation,
  evidence: { counts: evidence.counts, coverage: evidence.sources.map(({ coverage }) => coverage),
    confirmations: evidence.confirmations }, parts, judges: items(judges),
  short: { jobs: short.jobs.map(({ operation, status, error }) => ({ operation, status, error })) } };
save('readback.json', JSON.parse(safe(JSON.stringify(receipt))));
console.log(`${checks.length} product reads: schemas and hashes passed; stopped carry preserved, no card claimed.`);
