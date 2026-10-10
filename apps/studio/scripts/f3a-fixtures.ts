/**
 * Intercepted UI controls for F3a; no runtime, database or provider is touched and nothing here is a live record.
 * Recorded floors and units: the K4b offline protocol doubles record the K4c source labels in memory.
 * Table import: the F2b offline controls with the result freshness the published contract now requires.
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
const TABLE_ROUTE = 'ingestion_cases_caseId_sources_sourceId';
const RAW_SCHEMA = `POST_${TABLE_ROUTE}_streaming_vector_Response_202_application_json`;
const MAPPING_SCHEMA = `POST_${TABLE_ROUTE}_chunk_mapping_Response_202_application_json`;
const CHUNK_SCHEMA = `GET_${TABLE_ROUTE}_chunk_mapping_jobs_jobId_chunks_chunkIndex_Response_200_application_json`;
const FRESH = { current: true, reasons: [] };
const STALE = { current: false, reasons: ['case_advanced'] };
const validate = createContractValidator(JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')));
const k4cRequest = JSON.parse(readFileSync('docs/evidence/gf1/k4b/k4c-source-space-request.json', 'utf8'));
const globals = globalThis as unknown as { ulpinPool?: unknown };
// The K4b control locator: no anchor, unknown structure, level and space kinds.
const location = { anchorState: 'not_supplied' as const, parcels: [], locator: {
  structureKind: '?' as const, structureNumber: 1, levels: ['L?'], spaceKind: '?' as const, spaceNumber: 1 } };

type Recorded = Awaited<ReturnType<typeof commandSourceSpace>>;
type TableFile = Record<'raw' | 'mapping' | 'chunk', object>;

function checked<T>(schema: string, value: T): T {
  assert.deepEqual(validate(schema, value), [], schema);
  return value;
}

function withFreshness(file: TableFile, freshness: typeof FRESH) {
  return { ...file, raw: checked(RAW_SCHEMA, { ...file.raw, ...freshness }),
    mapping: checked(MAPPING_SCHEMA, { ...file.mapping, ...freshness }),
    chunk: checked(CHUNK_SCHEMA, { ...file.chunk, ...freshness }) };
}

/** The F2b job and chunk responses as current results, and the second file once more as an earlier case state. */
function tableControls() {
  const f2b = JSON.parse(readFileSync('docs/evidence/gf-agent/ui/f2b/responses.json', 'utf8'));
  return { note: 'The F2b intercepted table controls with the published result freshness added; stale is the '
      + 'second file marked as a result from an earlier state of the case. Not live records.',
    ...f2b, files: f2b.files.map((file: TableFile) => withFreshness(file, FRESH)),
    stale: withFreshness(f2b.files[1], STALE) };
}

function canonicalBody(db: SourceSpaceControl, codes?: Awaited<ReturnType<typeof readSourceProjectCodes>>) {
  const building = structuredClone(retainedTower);
  projectSourceRecordedChildren(building, db.rows.map((row) => ({ ...row.body, revision: row.revision })), codes);
  return checked(CANONICAL_SCHEMA, finishBuilding(building));
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
    writeFileSync(resolve(out, 'table-responses.json'), JSON.stringify(tableControls()));
  } finally {
    globals.ulpinPool = pool;
  }
}

await main();
