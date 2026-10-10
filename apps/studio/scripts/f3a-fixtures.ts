/**
 * Intercepted UI controls for the recorded floors and units panel. The K4b offline protocol doubles record the
 * K4c source labels in memory; no runtime, database or provider is touched and nothing here is a live record.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SourceSpaceRequestSchema } from '@ulpin/contracts';
import { createContractValidator } from '../src/local/contract';
import { commandSourceSpace } from '../../../packages/server/src/modules/officer/source-spaces';
import { retainedTower, SourceSpaceControl }
  from '../../../packages/server/src/modules/officer/source-spaces.test-fixture';
import { finishBuilding, projectSourceRecordedChildren }
  from '../../../packages/server/src/modules/registry/canonical-building';
import { readSourceProjectCodes } from '../../../packages/server/src/modules/registry/canonical-source-identity';
import { localRequestContext } from '../../../packages/server/src/modules/usp/principal';
import { assignProjectCode, prepareProjectIdentityReview }
  from '../../../packages/server/src/modules/usp/project-identity';
import { captureRegistrySnapshot } from '../../../packages/server/src/modules/usp/snapshots';
import { SourceIdentityControl } from '../../../packages/server/src/modules/usp/source-stated-identity.test-fixture';

const out = resolve('docs/evidence/gf1/ui/f3a');
const CANONICAL_SCHEMA = 'GET_buildings_buildingId_canonical_Response_200_application_json';
const validate = createContractValidator(JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')));
const k4cRequest = JSON.parse(readFileSync('docs/evidence/gf1/k4b/k4c-source-space-request.json', 'utf8'));
const globals = globalThis as unknown as { ulpinPool?: unknown };
// The K4b control locator: no anchor, unknown structure, level and space kinds.
const location = { anchorState: 'not_supplied' as const, parcels: [], locator: {
  structureKind: '?' as const, structureNumber: 1, levels: ['L?'], spaceKind: '?' as const, spaceNumber: 1 } };

type Recorded = Awaited<ReturnType<typeof commandSourceSpace>>;

function canonicalBody(db: SourceSpaceControl, codes?: Awaited<ReturnType<typeof readSourceProjectCodes>>) {
  const building = structuredClone(retainedTower);
  projectSourceRecordedChildren(building, db.rows.map((row) => ({ ...row.body, revision: row.revision })), codes);
  const body = finishBuilding(building);
  assert.deepEqual(validate(CANONICAL_SCHEMA, body), [], CANONICAL_SCHEMA);
  return body;
}

/** The existing review and assignment protocol, against the in-memory SQL double of the K4b test. */
async function assignCode(db: SourceSpaceControl, recorded: Recorded, request: { reason: string }) {
  const memory = new SourceIdentityControl(db);
  globals.ulpinPool = memory.pool;
  const context = localRequestContext(randomUUID());
  const space = db.rows.find((row) => row.id === recorded.spaceId);
  const snapshot = await captureRegistrySnapshot(context, retainedTower.areaId, { kind: 'targets', pins: [{
    ref: { namespace: 'registry_record', id: recorded.spaceId }, revision: space.revision }] });
  const review = { operation: 'assign' as const, scope: snapshot.scope, recordIds: [recorded.spaceId],
    expectedVersions: { [recorded.spaceId]: 1 }, reason: request.reason, location,
    evidence: [{ sourceId: space.body.sourceOnly.evidence.sourceId, revision: 1,
      locator: space.body.evidence[0].locator }] };
  const prepared = await prepareProjectIdentityReview(context, review as never);
  await assignProjectCode(context, { scope: snapshot.scope, expectedManifestId: snapshot.id,
    reviewId: prepared.reviewId, requestKey: randomUUID(), recordId: recorded.spaceId, expectedRecordVersion: 1 });
  const records = db.rows.map((row) => ({ ...row.body, revision: row.revision }));
  return readSourceProjectCodes(records, retainedTower.areaId);
}

async function main() {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'f3a-offline-protocol-control';
  const pool = globals.ulpinPool;
  const db = new SourceSpaceControl();
  // The K4c labels, pages and regions as written; the revision and key belong to this offline double.
  const request = SourceSpaceRequestSchema.parse({ ...k4cRequest, requestKey: randomUUID(),
    expectedCanonicalRevision: retainedTower.revisionId });
  try {
    const recorded = await commandSourceSpace(retainedTower.buildingId, request, db.deps);
    const withoutCode = canonicalBody(db);
    const withCode = canonicalBody(db, await assignCode(db, recorded, request));
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, 'responses.json'), JSON.stringify({
      note: 'Intercepted UI controls built by apps/studio/scripts/f3a-fixtures.ts from the K4b offline protocol '
        + 'doubles and the K4c request literals. Not live records. The code in withCode is a test value '
        + 'allocated in memory by the existing generator; it is not an issued identity.',
      buildingId: retainedTower.buildingId, withoutCode, withCode }));
  } finally {
    globals.ulpinPool = pool;
  }
}

await main();
