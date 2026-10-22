import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { save, serving } from './audit.mjs';

// Run from the serving checkout with node --import tsx. Reads only the rehearsal's product routes.
const intake = await import(pathToFileURL(`${serving}/packages/contracts/src/usp/intake.ts`).href);
const cards = await import(pathToFileURL(`${serving}/packages/contracts/src/usp/property-card.ts`).href);
const caseId = '76f1cdb3-1407-40b4-b9a2-20cea1c53380';
const oldCase = '077acb5d-bf9f-4cec-93f3-44ed5a3cd3f0';
const cardId = '2614548e-a54b-40d5-bff2-84614f55ec7b';
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

function itemsOf(manifest) {
  return manifest.items.map(({ itemId, name, state, placement, partsDone, partsPlanned, limitReason }) => ({
    itemId, name, state, placement, partsDone, partsPlanned, limitReason,
  }));
}

function sourceHashes(detail, expected) {
  return detail.sources.map(source => ({
    name: source.name,
    matchesVerifiedOriginal: source.sha256 === expected.files.find(file => file.path.endsWith(source.name))?.sha256,
  }));
}

const manifest = await get(`${root}/intake`, intake.IntakeManifestSchema);
const evidence = await get(`${root}/intake/evidence`, intake.IntakeEvidencePageSchema);
const confirmation = await get(`${root}/confirmations/f2f0bf55-7c01-48dc-8af4-81db2f9ed98e`,
  intake.IntakeConfirmationSchema);
const verification = await get(`/usp/property-cards/${cardId}/revisions/1/verification`,
  cards.UspPropertyCardVerificationSchema);
const old = await get(`/ingestion/cases/${oldCase}/intake`, intake.IntakeManifestSchema);
const parts = [];
for (const item of manifest.items.filter(item => ['raster', 'point_cloud'].includes(item.family))) {
  parts.push(await get(`${root}/intake/items/${item.itemId}/parts`, intake.IntakeSurfacePartPageSchema));
}
const detail = await get(`/cases/${caseId}`);
const act2 = await get('/cases/559a6358-5f16-471b-b0cd-7f1105bdf3c0');
const expected = JSON.parse(readFileSync(new URL('./act1-files.json', import.meta.url), 'utf8'));
const hashes = sourceHashes(detail, expected);
assert(hashes.every(source => source.matchesVerifiedOriginal), 'Retained original hashes differ');
assert.equal(confirmation.progress[0].readiness, 'carded');
assert.equal(evidence.confirmations.length, 0, 'A refused evidence confirmation must not be stored');

save('readback.json', {
  at: new Date().toISOString(), checks, originalHashes: hashes,
  oldCase: { caseId: oldCase, items: itemsOf(old) },
  resumedCase: { caseId, items: itemsOf(manifest),
    jobs: detail.jobs.map(({ operation, status, error }) => ({ operation, status, error })) },
  evidence: { profiles: evidence.profiles.map(({ profileId, input }) => ({ profileId, input })),
    coverage: evidence.sources.map(({ itemId, coverage }) => ({ itemId, coverage })),
    counts: evidence.counts, storedConfirmations: evidence.confirmations.length },
  parts: parts.map(({ itemId, operation, partsPlanned, parts }) => ({ itemId, operation, partsPlanned,
    parts: parts.map(({ partIndex, state, jobId, issueCode }) => ({ partIndex, state, jobId, issueCode })) })),
  card: { confirmationId: confirmation.confirmationId, acknowledgement: confirmation.acknowledgement,
    counts: confirmation.counts, target: confirmation.progress[0].locator,
    record: confirmation.progress[0].artefacts.record, card: confirmation.progress[0].artefacts.card,
    verification },
  act2: { caseId: act2.case.id, name: act2.case.name,
    jobs: act2.jobs.map(({ operation, status, error }) => ({ operation, status, error })) },
});
console.log(`${checks.length} product reads passed; schemas and retained source hashes agree.`);
