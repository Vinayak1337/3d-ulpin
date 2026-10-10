import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SourceBuildingImportSchema } from '../../../../packages/contracts/src/index';
import {
  UspPropertyCardListSchema, UspPropertyCardVerificationSchema,
} from '../../../../packages/contracts/src/usp/property-card';
import { issueTarget, issueFailure, generateBody } from '../../../../apps/studio/src/features/identity/issue';
import { prepareRevision } from '../../../../apps/studio/src/features/identity/prepare';
import { save, safe } from './audit.mjs';
import { scratch, compact, retain, send, setSession, installCapture, exchanges } from './http.mjs';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const prior = read(`${scratch}/part-b-outcome.json`);
const card = read(`${scratch}/issued-card.json`);
const part = process.argv[4];
const outcome: Record<string, any> = { part, done: false, attempts: 1 };

async function revision() {
  const buildingId = prior.tower.buildingId;
  const snapshots = await send(`/api/v1/buildings/${buildingId}/snapshots`);
  const listed = UspPropertyCardListSchema.parse((await send('/api/v1/usp/property-cards/list', {
    scope: card.scope, target: card.target.ref, limit: 50,
  })).data);
  outcome.before = { snapshots: snapshots.items.map((item: any) => ({
    manifestId: item.scope.manifestId, createdAt: item.createdAt, capturedAt: item.capturedAt,
  })), cards: listed.items.map(({ cardId, revision, integrity, superseded }) => ({
    cardId, revision, integrity, superseded,
  })) };
  const route = `/api/v1/usp/property-cards/${card.cardId}/revisions/${card.revision}/verification`;
  const verification = UspPropertyCardVerificationSchema.parse((await send(route)).data);
  outcome.verification = { result: verification.result, checks: verification.checks,
    snapshot: verification.snapshot, signature: verification.signature };
  const target = issueTarget(listed.items);
  assert.equal(target.mode, 'update');
  if (target.mode !== 'update') throw new Error('No revisable card');
  const expiresAt = new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString();
  save('c1-recorded-change.json', { change: 'Request one hour less card validity; no property fact is changed',
    previousExpiresAt: card.expiresAt, requestedExpiresAt: expiresAt, target,
    scope: 'Card policy only. No unit-record correction is invented from an unchanged source.' });
  const prepared = await prepareRevision(target, expiresAt);
  retain('c1-prepared', prepared);
  await appendAndList(prepared);
}

async function appendAndList(prepared: any) {
  const revised = (await send('/api/v1/usp/property-cards/generate',
    generateBody(prepared.request, randomUUID()))).data;
  const listed = UspPropertyCardListSchema.parse((await send('/api/v1/usp/property-cards/list', {
    scope: revised.scope, target: revised.target.ref, limit: 50,
  })).data);
  outcome.after = { cards: listed.items.map(({ cardId, revision, integrity, superseded }) => ({
    cardId, revision, integrity, superseded,
  })) };
  outcome.done = true;
}

async function referenceArea() {
  const areaId = prior.area.areaId;
  const area = (await send(`/api/v1/areas/${areaId}/context`)).area;
  const recipe = read('E:/BhuAayam-data/task-data/k2/gmda-context-input.json');
  const original = 'E:/BhuAayam-data/task-data/ulpin-data-09/gmda-sectors-59-63a.json';
  const bytes = readFileSync(original);
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sourceSha256, recipe.documents[0].sourceSha256);
  const input = SourceBuildingImportSchema.parse({ ...recipe, areaId, expectedAreaRevision: area.revision,
    requestKey: randomUUID() });
  save('c2-input.json', compact({ original, sourceSha256, bytes: bytes.length,
    provenance: 'Retained K2 gmda-context-input.json; only returned area pin and requestKey rebound',
    requestKey: input.requestKey, expectedAreaRevision: input.expectedAreaRevision }));
  const form = new FormData();
  form.set('format', input.format);
  form.set('metadata', JSON.stringify(input));
  form.set('sectors', new File([bytes], input.documents[0].filename, { type: 'application/json' }));
  let pkg = await send('/api/v1/import-packages', form);
  const route = `/api/v1/import-packages/${pkg.id}`;
  pkg = await send(`${route}/prepare`, { expectedRevision: pkg.revision });
  const acknowledgement = 'Reviewed native GMDA names and boundary provenance for local administrative context only. '
    + 'Not parcels, public-land, property rights, measured terrain or analytically qualified geometry.';
  pkg = await send(`${route}/commit`, { expectedRevision: pkg.revision, acknowledgement });
  const canonical = await send(`/api/v1/areas/${areaId}/canonical`);
  assert.equal(pkg.features.length, 0);
  assert.equal(createHash('sha256').update(readFileSync(original)).digest('hex'), sourceSha256);
  outcome.done = true;
  outcome.result = { state: pkg.state, packageId: pkg.id, sourceId: pkg.sourceRevisionIds[0], areaId,
    administrativeUnits: pkg.administrativeContext.units.map((unit: any) => ({ id: unit.id, name: unit.name })),
    physicalFeaturesCreated: pkg.features.length, contextRows: canonical.administrativeContext?.length ?? 0,
    sourceUnchanged: true };
}

async function main() {
  assert.deepEqual(process.argv.slice(2, 4), ['--runtime', 'ulpin-reh-01']);
  assert(prior.cardIssued, 'Part C requires an issued card');
  assert(['c1', 'c2'].includes(part));
  setSession(part);
  installCapture();
  if (part === 'c1') await revision();
  else await referenceArea();
}

main().catch(error => {
  outcome.reason = part === 'c1' ? issueFailure(error).text : error.message;
  outcome.stopped = true;
  process.exitCode = 1;
}).finally(() => {
  retain(`${part}-outcome`, outcome);
  save(`${part}-result.json`, compact(JSON.parse(safe(JSON.stringify({ ...outcome, exchanges })))));
});
