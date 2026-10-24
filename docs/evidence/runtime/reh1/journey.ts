import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { SourceBuildingImportSchema, NormalizedBuildingSchema } from '../../../../packages/contracts/src/index';
import { SourceSpaceRequestSchema } from '../../../../packages/contracts/src/canonical/source-spaces';
import { UspPropertyCardVerificationSchema } from '../../../../packages/contracts/src/usp/property-card';
import {
  assignSubject, captureBody, reviewBody, answeredReview, assignBody,
} from '../../../../apps/studio/src/features/identity/assignment';
import { generateBody } from '../../../../apps/studio/src/features/identity/issue';
import { prepareFirstCard } from '../../../../apps/studio/src/features/identity/prepare';
import { save, safe } from './audit.mjs';
import { base, scratch, compact, retain, send, capturedFetch, installCapture, exchanges } from './http.mjs';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const raw = read('E:/BhuAayam-data/task-data/k2/tower3-import-input.json');
const truth = read('docs/evidence/usp/finale/GF-DATA/storey-truth/demo/haryana-2831-tower3.json');
const areaRecipe = read('docs/evidence/runtime/r5b/area-step.json');
const reason = 'REH1 local rehearsal replay of the cited R2 boxed label UNIT-3B on 2ND FLOOR PLAN. '
  + 'Label evidence only: no boundary, area, use, geometry or rights. Not a field officer decision.';
const outcome: Record<string, any> = { part: 'B', status: 'started', cardIssued: false };

function originals() {
  const inputs = raw.documents.map((document: any) => {
    const source = truth.sources.find((item: any) => item.sha256 === document.sourceSha256);
    assert(source && !/heldout|holdout|evaluator|provisional|acquisitions/i.test(source.externalPath));
    const bytes = readFileSync(source.externalPath);
    assert.equal(hash(bytes), document.sourceSha256);
    return { ...document, path: source.externalPath, bytes };
  });
  const roads = areaRecipe.originals.find((item: any) => item.id === 'roads');
  const roadBytes = readFileSync(roads.path);
  assert.equal(hash(roadBytes), roads.sha256);
  save('input-integrity.json', compact({ pdfs: inputs.map(({ bytes, ...pin }: any) => ({
    ...pin, bytes: bytes.length, hashMatches: true,
  })), roads: { path: roads.path, sha256: roads.sha256, bytes: roadBytes.length, hashMatches: true } }));
  return { inputs, roadBytes };
}

async function createArea(roadBytes: Uint8Array) {
  const recipe = areaRecipe.requests.find((item: any) => item.id === 'A2');
  const form = new FormData();
  form.set('file', new File([roadBytes], recipe.fields['file name'].value));
  for (const field of ['format', 'namespace', 'name', 'mapping', 'sourceCrs', 'worldStatus']) {
    const value = recipe.fields[field].value;
    form.set(field, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const imported = await send('/api/v1/import-packages', form);
  outcome.area = { areaId: imported.areaId, packageId: imported.id, state: imported.state };
  return (await send(`/api/v1/areas/${imported.areaId}/context`)).area;
}

async function importTower(area: any, inputs: any[]) {
  const declarations = { ...raw, requestKey: randomUUID(), areaId: area.id, expectedAreaRevision: area.revision,
    buildings: raw.buildings.map((building: any) => ({ ...building, claims: building.claims.map((claim: any) => ({
      ...claim, transcription: { by: 'agent', agent: 'REH1-worker' },
    })) })),
  };
  const metadata = SourceBuildingImportSchema.parse(declarations);
  const form = new FormData();
  form.set('format', metadata.format);
  form.set('metadata', JSON.stringify(metadata));
  for (const input of inputs) form.set(input.key, new File([input.bytes], input.filename, { type: 'application/pdf' }));
  const imported = await send('/api/v1/import-packages', form);
  const plan = imported.documentPins.find((pin: any) => pin.sourceSha256 === inputs[1].sourceSha256);
  assert(plan);
  outcome.tower = { packageId: imported.id, buildingId: imported.features[0].id, planSourceId: plan.sourceId };
  const cases = await send('/api/v1/cases');
  const sourceCase = cases.find((item: any) => item.name === imported.name && item.siteId === imported.areaId);
  assert(sourceCase);
  const detail = await send(`/api/v1/cases/${sourceCase.id}`);
  outcome.tower.caseId = sourceCase.id;
  const job = detail.jobs.find((item: any) => item.sourceId === plan.sourceId
    && item.operation === 'document-extraction');
  assert(job, 'Import must queue its own document reader');
  const prefix = `/api/v1/ingestion/cases/${sourceCase.id}/sources/${plan.sourceId}/documents`;
  const status = await send(`${prefix}/jobs/${job.id}`);
  outcome.reader = { status: status.status, native: status.native?.status, ocr: status.ocr?.toolStatus ?? null };
  const query = `revision=${plan.sourceRevision}&sha256=${plan.sourceSha256}&offset=0&limit=1`;
  outcome.pages = await send(`/api/v1/sources/${plan.sourceId}/pages?${query}`);
  return { imported, plan };
}

async function recordTower(imported: any, plan: any) {
  const route = `/api/v1/import-packages/${imported.id}`;
  const review = await send(`${route}/prepare`, { expectedRevision: imported.revision });
  const acknowledgement = 'Local development source review only. Unknown footprint, placement, height, rights and '
    + 'approved/as-built revision remain unknown. Conflicting G+41/G+42 source literals are not selected.';
  const committed = await send(`${route}/commit`, { expectedRevision: review.revision, acknowledgement });
  outcome.tower.state = committed.state;
  const buildingId = imported.features[0].id;
  const canonical = await send(`/api/v1/buildings/${buildingId}/canonical`);
  const draft = read('docs/evidence/gf1/k4c/source-space-request.json');
  const evidence = (pin: any) => ({ ...pin, sourceId: plan.sourceId, sourceRevision: plan.sourceRevision });
  const request = SourceSpaceRequestSchema.parse({ ...draft, requestKey: randomUUID(), reason,
    expectedCanonicalRevision: canonical.revisionId,
    level: { ...draft.level, evidence: evidence(draft.level.evidence) },
    space: { ...draft.space, evidence: evidence(draft.space.evidence) },
  });
  const receipt = await send(`/api/v1/buildings/${buildingId}/source-spaces`, request,
    { 'Idempotency-Key': request.requestKey });
  outcome.recorded = receipt;
  return { buildingId, unitId: receipt.spaceId };
}

async function subjectFor(buildingId: string, unitId: string) {
  const canonical = NormalizedBuildingSchema.parse(await send(`/api/v1/buildings/${buildingId}/canonical`));
  const register = await send(`/api/v1/buildings/${buildingId}/register?format=json`);
  const subject = assignSubject(canonical, register, unitId);
  assert(typeof subject !== 'string', typeof subject === 'string' ? subject : 'Subject available');
  return subject;
}

async function identity(buildingId: string, unitId: string) {
  const subject = await subjectFor(buildingId, unitId);
  const reviews = await send(`/api/v1/usp/identity/records/${unitId}/reviews`);
  assert.equal(reviews.items.length, 0);
  const snapshot = (await send('/api/v1/usp/snapshots', captureBody(subject))).data;
  const request = reviewBody(snapshot.scope, subject, reason);
  const review = (await send('/api/v1/usp/identity/reviews', request)).data;
  const reviewed = answeredReview(request, review, unitId);
  const assignment = await send('/api/v1/usp/identity/assign', assignBody(reviewed, unitId, randomUUID()));
  outcome.identity = { reviewId: review.reviewId, code: assignment.data.outcome.codes[unitId] };
}

async function issue(buildingId: string, unitId: string) {
  const subject = await subjectFor(buildingId, unitId);
  const typed = { expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(), inclusionReason: reason };
  const prepared = await prepareFirstCard(subject, typed, { captured: null }, answered => retain(
    `prepare-${Object.keys(answered)[0]}`, answered));
  assert(typeof prepared !== 'string', typeof prepared === 'string' ? prepared : 'Prepared');
  const card = (await send('/api/v1/usp/property-cards/generate', generateBody(prepared.request, randomUUID()))).data;
  outcome.cardIssued = true;
  outcome.card = { cardId: card.cardId, revision: card.revision, expiresAt: card.expiresAt };
  retain('issued-card', card);
  const route = `/api/v1/usp/property-cards/${card.cardId}/revisions/${card.revision}`;
  const response = await capturedFetch(base + route);
  assert(response.ok);
  writeFileSync(`${scratch}/card-revision-1.pdf`, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
  const view = (await send('/api/v1/usp/property-cards/read', outcome.card)).data;
  const snapshots = await send(`/api/v1/buildings/${buildingId}/snapshots`);
  const listed = (await send('/api/v1/usp/property-cards/list', {
    scope: card.scope, target: { namespace: 'registry_record', id: unitId }, limit: 50,
  })).data;
  const verified = UspPropertyCardVerificationSchema.parse((await send(`${route}/verification`)).data);
  assert.equal(verified.result, 'consistent');
  outcome.judge = { facts: view.card.facts, cards: listed.items.map((row: any) => ({
    cardId: row.cardId, revision: row.revision, integrity: row.integrity,
  })), snapshots: snapshots.items.length, verification: verified.result };
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ['--runtime', 'ulpin-reh-01']);
  assert(read('docs/evidence/runtime/reh1/plan-b.json').beforeFirstRequest);
  installCapture();
  const { inputs, roadBytes } = originals();
  const health = await send('/api/v1/health');
  assert.equal(health.databaseReadiness.data.sourceCount, 0);
  outcome.emptyStorage = health.databaseReadiness.data;
  const area = await createArea(roadBytes);
  const { imported, plan } = await importTower(area, inputs);
  const { buildingId, unitId } = await recordTower(imported, plan);
  await identity(buildingId, unitId);
  await issue(buildingId, unitId);
  assert(inputs.every((input: any) => hash(readFileSync(input.path)) === input.sourceSha256));
  outcome.originalsUnchanged = true;
  outcome.status = 'done';
}

main().catch(error => {
  outcome.status = 'stopped';
  outcome.reason = error.message;
  process.exitCode = 1;
}).finally(() => {
  retain('part-b-outcome', outcome);
  save('part-b.json', compact(JSON.parse(safe(JSON.stringify({ ...outcome, exchanges })))));
});
