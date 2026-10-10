/** Intercepted UI protocol controls from real development bytes; no runtime, DB or provider writes. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContractValidator } from '../src/local/contract';
import { inspectTabularSource, readTabularSource }
  from '../../../packages/server/src/modules/usp/ingestion/tabular-source';
import { TabularChunkMapper } from '../../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import type { TabularChunkDraft } from '../../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { options } from '../../../scripts/agent/control-runtime';

const out = resolve('docs/evidence/gf-agent/ui/f2b');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const caseId = randomUUID();
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
const mapper = new TabularChunkMapper();
const validate = createContractValidator(JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')));

function checked(schema: string, value: unknown) {
  assert.deepEqual(validate(schema, value), [], schema);
  return value;
}

function slot(records: number, payload: unknown) {
  const sha256 = hash(payload);
  return { chunkIndex: 0, status: 'ready' as const, published: true,
    firstFeatureIndex: 0, lastFeatureIndex: records - 1, records,
    bytes: Buffer.byteLength(JSON.stringify(payload)),
    ref: { key: 'intercepted-ui-control', sha256, bytes: Buffer.byteLength(JSON.stringify(payload)) },
    issueCode: null, resultSha256: sha256, attempt: 1, fence: 1 };
}

function mappingPayload(
  draft: TabularChunkDraft, profile: ReturnType<typeof makeProfile>, rawJobId: string, sourceRows: number[],
) {
  return { version: 'chunk-mapping/1', jobId: draft.metrics.jobId, rawJobId,
    sourceId: profile.source.sourceId, sourceRevision: 1, sourceSha256: profile.source.sourceSha256,
    chunkIndex: 0, rawResultSha256: hash(rawJobId), schemaFingerprint: profile.source.schemaFingerprint,
    recipeRevision: null, tabular: profile.tabular,
    mapping: { profile: draft.profile, plan: draft.proposal.plan, fieldSources: draft.proposal.fieldSources,
      questions: draft.questions, metrics: draft.metrics, sourceRows,
      rows: draft.dryRun.rows },
    converterSha256: hash('intercepted-control-not-a-runtime-pin'), records: [] };
}

function makeProfile(name: string) {
  const bytes = readFileSync(resolve('fixtures/usp/D8-messy-india/dev/d1b', name));
  const inventory = inspectTabularSource(bytes, selection);
  const sourceId = randomUUID();
  return { version: 'manual-tabular/1' as const, caseId, workspaceRevision: 1,
    workspaceFingerprint: hash({ caseId, sourceId }),
    source: { sourceId, familyId: sourceId, sourceRevision: 1,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'), schemaFingerprint: inventory.schemaFingerprint },
    tabular: inventory.tabular, headers: inventory.headers, records: inventory.records,
    profile: inventory.profile, limitations: inventory.limitations };
}

function rawStatus(profile: ReturnType<typeof makeProfile>, rawJobId: string) {
  const rawSlot = { ...slot(profile.records, profile.headers), accepted: profile.records, quarantined: 0 };
  return { version: 'geojson-stream/2', jobId: rawJobId, caseId, sourceId: profile.source.sourceId,
    sourceRevision: 1, sourceSha256: profile.source.sourceSha256, status: 'completed', nextPublishIndex: 1,
    sealedChunks: 1, records: profile.records, accepted: profile.records, quarantined: 0,
    issueCode: null, unknownRemainder: false,
    reference: { sourceCrs: null, evidence: null, globalPlacement: 'not_qualified' },
    slots: [rawSlot], framing: 'tabular', tabular: profile.tabular };
}

function mappingStatus(profile: ReturnType<typeof makeProfile>, payload: ReturnType<typeof mappingPayload>) {
  const mappedSlot = { ...slot(profile.records, payload), rawResultSha256: payload.rawResultSha256,
    schemaFingerprint: profile.source.schemaFingerprint, schemaDrift: false,
    normalized: 0, quarantined: 0, unresolved: profile.records };
  const status = { version: 'chunk-mapping/1', jobId: payload.jobId, rawJobId: payload.rawJobId,
    caseId, sourceId: profile.source.sourceId, sourceRevision: 1, sourceSha256: profile.source.sourceSha256,
    status: 'needs_input', route: 'proposal_only', recipeId: null, recipeRevision: null,
    schemaFingerprint: profile.source.schemaFingerprint, converterSha256: payload.converterSha256,
    sourceCrs: null, referenceEvidence: null, globalPlacement: 'not_qualified', nextPublishIndex: 1,
    sealedChunks: 1, records: profile.records, normalized: 0, quarantined: 0, unresolved: profile.records,
    duplicateKeys: 0, schemaDriftChunks: 0, issueCode: null, unknownRemainder: false,
    sourceComplete: true, identityComplete: false, proposal: null, proposalTrainingEligible: false,
    tabular: profile.tabular, slots: [mappedSlot] };
  const chunk = { slot: mappedSlot, payload, sourceComplete: true, identityComplete: false, unknownRemainder: false };
  return { status, chunk };
}

async function fileControl(name: string) {
  const profile = makeProfile(name);
  const bytes = readFileSync(resolve('fixtures/usp/D8-messy-india/dev/d1b', name));
  const table = readTabularSource(bytes, selection);
  const rawJobId = randomUUID();
  const draft = await mapper.map({ jobId: randomUUID(), chunkIndex: 0, headers: table.headers, rows: table.rows,
    sourceRef: `source:${profile.source.sourceId}` }, {
    ...options(), learnerModelPath: 'E:/BhuAayam-data/task-data/a4/learner/v43',
    learnerPython: 'python', dataPolicy: { dataClass: 'public', split: 'development' },
  });
  const payload = mappingPayload(draft, profile, rawJobId, table.sourceRows);
  const mapped = mappingStatus(profile, payload);
  const raw = rawStatus(profile, rawJobId);
  checked('POST_ingestion_cases_caseId_sources_Response_201_application_json', profile);
  checked('POST_ingestion_cases_caseId_sources_sourceId_streaming_vector_Response_202_application_json', raw);
  checked('POST_ingestion_cases_caseId_sources_sourceId_chunk_mapping_Response_202_application_json', mapped.status);
  const chunkSchema = 'GET_ingestion_cases_caseId_sources_sourceId_chunk_mapping_jobs_jobId_chunks_chunkIndex_' +
    'Response_200_application_json';
  checked(chunkSchema, mapped.chunk);
  return { name, profile, raw, mapping: mapped.status, chunk: mapped.chunk };
}

function sourceCase(files: Awaited<ReturnType<typeof fileControl>>[]) {
  const now = new Date().toISOString();
  const record = { id: caseId, siteId: null, archived: false, name: 'Intercepted table workflow control',
    description: 'No live case or property record', frame: { id: caseId, horizontalUnit: 'm', verticalUnit: 'm',
      benchmark: 'Unassigned source workspace' }, revision: 1, createdAt: now, updatedAt: now };
  const sources = files.map((file) => ({ id: file.profile.source.sourceId, caseId,
    familyId: file.profile.source.familyId, revision: 1, name: file.name, profile: 'tabular-manual-v1',
    mimeType: 'text/csv', bytes: file.profile.tabular.sourceBytes, sha256: file.profile.source.sourceSha256,
    status: 'needs_input', createdAt: now, inspection: null }));
  return { case: record, identity: { rootId: caseId, status: 'prototype', scope: 'property-workspace',
    floors: [], spaces: [] }, sources, units: [], model: null, jobs: [], context: [], history: [] };
}

async function main() {
  const files = [await fileControl('mi-d10-02.csv'), await fileControl('mi-d10-03.csv')];
  const detail = sourceCase(files);
  checked('GET_cases_caseId_Response_200_application_json', detail);
  assert.equal(files[0]!.chunk.payload.mapping.metrics.layout, 'new');
  assert.equal(files[1]!.chunk.payload.mapping.metrics.layout, 'memory');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'responses.json'), JSON.stringify({ caseId, detail, files }));
  writeFileSync(resolve(out, 'contract-check.json'), JSON.stringify({ schemas: 9, exit: 0,
    source: 'Real D8 dev bytes; offline student and job-local reuse; no teacher, learning or runtime writes' }));
}

await main();
